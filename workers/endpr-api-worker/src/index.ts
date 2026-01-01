// workers/endpr-api-worker/src/index.ts
import * as aws4 from 'aws4';
import { D1Client } from './d1';
import type { Post } from './types';
import { Buffer } from 'node:buffer';

const GITHUB_API_BASE = 'https://api.github.com';

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
			return new Response(JSON.stringify({ success: false, message: e.message, stack: e.stack }), { 
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	},
};

async function githubAPI(path: string, method: string, token: string, body?: object) {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'endpr.dev-pbr-worker',
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`GitHub API Error on ${method} ${path}: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return response;
}

async function handlePublishRequest(request: Request, env: Env): Promise<Response> {
    const { postId, tenantId } = await request.json();
    if (!postId || !tenantId) {
        return new Response(JSON.stringify({ success: false, message: 'postId and tenantId are required' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
    }

	if (!env.GITHUB_TOKEN) {
		throw new Error("GITHUB_TOKEN secret is not set.");
	}

	const d1Client = new D1Client(env.DB, tenantId);

    let post: Post | null = null;
    let originalStatus: Post['status'] = 'DRAFT';
    let deploymentStatus: 'SUCCESS' | 'FAILURE' = 'FAILURE';
    let commitSha: string | null = null;

	try {
        post = await d1Client.getPostById(postId);
        if (!post) throw new Error('Post not found.');
		
		const tenant = await d1Client.getTenantById(tenantId);
        if (!tenant || !tenant.github_repo) throw new Error('Tenant or GitHub repository not found.');
		
        originalStatus = post.status;

        // Update post status to 'PUBLISHING' and get the updated post object back
        post = await d1Client.updatePost(postId, { status: 'PUBLISHING' }, post.version);

        const [owner, repo] = tenant.github_repo.split('/');
        if (!owner || !repo) throw new Error(`Invalid GitHub repository format: ${tenant.github_repo}`);

        const mdxContent = `---\n${post.frontmatter}\n---\n${post.content_md || ''}`;
        const filePath = `content/posts/${post.slug}.mdx`;
        const commitMessage = `Update post: ${post.title}`;
        const branch = 'main';

		// 1. Get file SHA using GitHub API
        let fileSha: string | undefined;
		const fileContentsResponse = await githubAPI(`/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`, 'GET', env.GITHUB_TOKEN);
		
		if (fileContentsResponse.status === 200) {
			const fileContents = await fileContentsResponse.json();
			fileSha = fileContents.sha;
		} else if (fileContentsResponse.status !== 404) {
			throw new Error(`Failed to get file contents: ${fileContentsResponse.statusText}`);
		}

		// 2. Create or update file using GitHub API
		const updateBody = {
			message: commitMessage,
			content: Buffer.from(mdxContent).toString('base64'),
			branch,
			sha: fileSha, // If sha is undefined, this is a new file
		};

		const fileUpdateResponse = await githubAPI(`/repos/${owner}/${repo}/contents/${filePath}`, 'PUT', env.GITHUB_TOKEN, updateBody);
		const fileUpdateResult = await fileUpdateResponse.json();

        if (fileUpdateResult?.commit?.sha) {
            commitSha = fileUpdateResult.commit.sha;
        } else {
			throw new Error('GitHub file update failed. No commit SHA returned.');
		}

        deploymentStatus = 'SUCCESS';
        // Final status update
        await d1Client.updatePost(postId, { status: 'PUBLISHED', last_published_at: Math.floor(Date.now() / 1000) }, post.version);

		return new Response(JSON.stringify({ success: true, message: `Post "${post.title}" published successfully.` }), { headers: { 'Content-Type': 'application/json' }});

	} catch (error: any) {
        console.error(`[Worker] Error publishing post ${postId}:`, error);
        if (post && originalStatus) {
            try {
                // Rollback to the original status using the last known version
                await d1Client.updatePost(post.id, { status: originalStatus }, post.version);
            } catch (rollbackError) {
                console.error(`[Worker] Failed to rollback post status for ${post.id}:`, rollbackError);
            }
        }
        throw error;
    } finally {
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
		bucketName: 'endpr-assets',
		key,
		method: 'PUT',
		expiresIn: 300,
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
        throw new Error('R2 secrets and/or Account ID are not configured for the worker.');
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

	return new URL(`httpshttps://${signedRequest.hostname}${signedRequest.path}`).toString();
}

interface Env {
	DB: D1Database;
	R2_ASSETS: R2Bucket;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	GITHUB_TOKEN: string;
}
