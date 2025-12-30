// src/actions/post.ts
'use server';

import { D1Database } from '@cloudflare/workers-types';
import { D1Client, getD1Binding } from '../lib/d1';
import { Post, Deployment } from '../types/db';


interface PublishPostResult {
    success: boolean;
    message: string;
    postId?: string;
}

export async function publishPost(postId: string, tenantId: string): Promise<PublishPostResult> {
    const db = getD1Binding();
    const d1Client = new D1Client(db, tenantId); // Initialize D1Client with tenantId

    let post: Post | null = null;
    let originalStatus: Post['status'] = 'DRAFT';
    let deploymentStatus: Deployment['status'] = 'FAILURE'; // Default to failure

    try {
        // 1. Fetch the post
        post = await d1Client.getPostById(postId);
        if (!post) {
            return { success: false, message: 'Post not found.' };
        }

        originalStatus = post.status; // Store original status for rollback

        // 2. Change post status to PUBLISHING
        await d1Client.updatePost(postId, { status: 'PUBLISHING' }, post.version);
        // Re-fetch post to get updated version for optimistic locking
        post = await d1Client.getPostById(postId);
        if (!post) {
             throw new Error("Post disappeared after status update.");
        }

        // 3. Perform GitHub API call
        console.log(`Attempting to publish post ${post.title} (ID: ${postId}) to GitHub for tenant ${tenantId}...`);

        const tenant = await d1Client.getTenantById(tenantId);
        if (!tenant || !tenant.github_repo) {
            throw new Error('Tenant or GitHub repository not found.');
        }

        const [owner, repo] = tenant.github_repo.split('/');
        if (!owner || !repo) {
            throw new Error(`Invalid GitHub repository format: ${tenant.github_repo}`);
        }

        const mdxContent = `---\n${post.frontmatter}\n---\n${post.content_md || ''}`;
        const filePath = `content/posts/${post.slug}.mdx`;
        const commitMessage = `Update post: ${post.title}`;
        const branch = 'main'; // Assuming 'main' branch for publishing

        // Check if file exists to get its SHA for update
        let fileSha: string | undefined;
        try {
            const { data: fileContents } = await get_file_contents({
                owner,
                repo,
                path: filePath,
                branch,
            });
            if (fileContents && 'sha' in fileContents) {
                fileSha = fileContents.sha;
            }
        } catch (error: any) {
            if (error.status !== 404) { // Ignore 404 error if file doesn't exist
                throw error;
            }
        }

        await create_or_update_file({
            owner,
            repo,
            path: filePath,
            content: Buffer.from(mdxContent).toString('base64'),
            message: commitMessage,
            branch,
            sha: fileSha,
        });

        // If GitHub API call is successful
        deploymentStatus = 'SUCCESS';
        await d1Client.updatePost(postId, { status: 'PUBLISHED', last_published_at: Math.floor(Date.now() / 1000) }, post.version);

        return { success: true, message: `Post "${post.title}" published successfully.`, postId };

    } catch (error: any) {
        console.error(`Error publishing post ${postId} for tenant ${tenantId}:`, error);
        // Rollback status to original DRAFT
        if (post && originalStatus) {
            try {
                // If the post exists and we have an original status, try to revert.
                // Note: This needs careful thought in a concurrent environment,
                // as another update might have happened between fetching and here.
                // For now, a simple rollback is implemented.
                await d1Client.updatePost(post.id, { status: originalStatus }, post.version);
            } catch (rollbackError) {
                console.error(`Failed to rollback post status for ${post.id}:`, rollbackError);
            }
        }
        return { success: false, message: `Failed to publish post: ${error.message}` };
    } finally {
        // 4. Log deployment regardless of success or failure
        const githubCommitSha = deploymentStatus === 'SUCCESS' ? 'mock-github-sha' : null; // Mock SHA
        try {
            await d1Client.createDeployment({
                tenant_id: tenantId,
                trigger_source: 'MANUAL',
                github_commit_sha: githubCommitSha,
                cf_deployment_id: null, // Not applicable for mock GitHub
                status: deploymentStatus,
            });
        } catch (logError) {
            console.error(`Failed to log deployment for post ${postId}:`, logError);
        }

        // Consideration for Cloudflare Queues (as per EXECUTION_PLAN.md)
        // This action could instead push a message to a Cloudflare Queue
        // which a Worker processes asynchronously. This provides better
        // resilience against GitHub API rate limits and failures.
        // Example: await env.PUBLISH_QUEUE.send({ postId, tenantId });
    }
}