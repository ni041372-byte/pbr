// workers/endpr-api-worker/src/index.ts
import * as aws4 from 'aws4';
import { D1Client } from './d1';
import type { Post } from './types';
import { Buffer } from 'node:buffer';
// @ts-ignore
import { get_file_contents, create_or_update_file } from "github";


export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);

		try {
			if (request.method === 'POST' && pathname === '/upload/presigned') {
				return await handlePresignedUrlRequest(request, env);
			}
			if (request.method === 'POST' && pathname === '/publish') {
				return await handlePublishRequest(request, env);
			}
			return new Response('Not found', { status: 404 });
		} catch (e: any) {
			console.error("Error in worker:", e);
			return new Response(JSON.stringify({ success: false, message: e.message }), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	},
};

async function handlePublishRequest(request: Request, env: Env): Promise<Response> {
    const { postId, tenantId } = await request.json();
    if (!postId || !tenantId) {
        return new Response(JSON.stringify({ success: false, message: 'postId and tenantId are required' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
    }

	const d1Client = new D1Client(env.DB, tenantId);

    let post: Post | null = null;
    let originalStatus: Post['status'] = 'DRAFT';
    let deploymentStatus: 'SUCCESS' | 'FAILURE' = 'FAILURE';
    let commitSha: string | null = null;

	try {
		// 1. Fetch post and tenant details from D1
        post = await d1Client.getPostById(postId);
        if (!post) throw new Error('Post not found.');
		
		const tenant = await d1Client.getTenantById(tenantId);
        if (!tenant || !tenant.github_repo) throw new Error('Tenant or GitHub repository not found.');
		
        originalStatus = post.status;

		// 2. Update post status to 'PUBLISHING'
        await d1Client.updatePost(postId, { status: 'PUBLISHING' }, post.version);
        post = await d1Client.getPostById(postId); // Re-fetch for new version number
        if (!post) throw new Error("Post disappeared after status update.");

		// 3. Perform GitHub API call
        const [owner, repo] = tenant.github_repo.split('/');
        if (!owner || !repo) throw new Error(`Invalid GitHub repository format: ${tenant.github_repo}`);

        const mdxContent = `---\n${post.frontmatter}\n---\n${post.content_md || ''}`;
        const filePath = `content/posts/${post.slug}.mdx`;
        const commitMessage = `Update post: ${post.title}`;
        const branch = 'main';

        let fileSha: string | undefined;
        try {
            const fileContents = await get_file_contents({ owner, repo, path: filePath, branch });
            if (fileContents && 'sha' in fileContents) {
                fileSha = fileContents.sha;
            }
        } catch (error: any) {
            if (error.status !== 404) throw error;
        }

        const fileUpdateResult = await create_or_update_file({
            owner,
            repo,
            path: filePath,
            content: Buffer.from(mdxContent).toString('base64'),
            message: commitMessage,
            branch,
            sha: fileSha,
        });

        if (fileUpdateResult?.commit?.sha) {
            commitSha = fileUpdateResult.commit.sha;
        } else {
			throw new Error('GitHub file update failed. No commit SHA returned.');
		}

		// 4. Update post status to 'PUBLISHED'
        deploymentStatus = 'SUCCESS';
        await d1Client.updatePost(postId, { status: 'PUBLISHED', last_published_at: Math.floor(Date.now() / 1000) }, post.version);

		return new Response(JSON.stringify({ success: true, message: `Post "${post.title}" published successfully.` }), { headers: { 'Content-Type': 'application/json' }});

	} catch (error: any) {
        console.error(`[Worker] Error publishing post ${postId}:`, error);
        // Rollback post status
        if (post && originalStatus) {
            try {
                await d1Client.updatePost(post.id, { status: originalStatus }, post.version);
            } catch (rollbackError) {
                console.error(`[Worker] Failed to rollback post status for ${post.id}:`, rollbackError);
            }
        }
        // Re-throw the error to be caught by the main fetch handler
        throw error;
    } finally {
		// 5. Log deployment attempt
        try {
            await d1Client.createDeployment({
                tenant_id: tenantId,
                trigger_source: 'MANUAL_WORKER',
                github_commit_sha: commitSha,
                cf_deployment_id: null,
                status: deploymentStatus,
            });
        } catch (logError) {
            console.error(`[Worker] Failed to log deployment for post ${postId}:`, logError);
        }
	}
}


async function handlePresignedUrlRequest(request: Request, env: Env): Promise<Response> {
	// Mock tenantId for now, in a real app this would come from an auth system
	const tenantId = 'dev-tenant';

	const { filename, contentType } = await request.json();
	if (!filename || !contentType) {
		return new Response(JSON.stringify({ error: 'Filename and contentType are required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const key = `${tenantId}/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${crypto.randomUUID()}-${filename}`;

	const presignedUrl = await createPresignedUrl({
		bucketName: env.R2_ASSETS.bucket,
		key,
		method: 'PUT',
		expiresIn: 300, // 5 minutes
		env: env,
	});

	return new Response(JSON.stringify({ url: presignedUrl, key: key }), {
		headers: { 'Content-Type': 'application/json' },
	});
}

async function createPresignedUrl({ bucketName, key, method, expiresIn, env }: { bucketName: string, key: string, method: string, expiresIn: number, env: Env }): Promise<string> {
	const accessKeyId = env.R2_ACCESS_KEY_ID;
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;

    if (!accessKeyId || !secretAccessKey || !accountId) {
        throw new Error('R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID environment variables are required.');
    }

	const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`);

	const signedRequest = aws4.sign({
		host: url.host,
		path: url.pathname,
		service: 's3',
		region: 'auto',
		method: method,
		expiresIn: expiresIn,
	}, {
		accessKeyId: accessKeyId,
		secretAccessKey: secretAccessKey,
	});

	return new URL(`https://${signedRequest.hostname}${signedRequest.path}`).toString();
}

interface Env {
	DB: D1Database;
	R2_ASSETS: R2Bucket;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	CLOUDFLARE_ACCOUNT_ID: string;
}
