// src/actions/post.ts
'use server';

import { revalidateTag } from 'next/cache';
import { D1Client, getD1Binding } from '../lib/d1';
import { Post } from '../types/db';

interface PublishPostResult {
    success: boolean;
    message: string;
    postId?: string;
}

export async function publishPost(postId: string, tenantId: string): Promise<PublishPostResult> {
    const db = getD1Binding();
    const d1Client = new D1Client(db, tenantId);

    try {
        const post = await d1Client.getPostById(postId);
        if (!post) {
            return { success: false, message: 'Post not found.' };
        }
        if (!post.title || !post.slug) {
            return { success: false, message: 'Post must have a title and a slug to be published.' };
        }

        // --- Communication with Worker ---
        // This is the new implementation that calls the worker.
        
        // Option 1: Direct HTTP Request to Worker (Current Implementation)
        // NOTE: Replace `<YOUR-SUBDOMAIN>` with your actual Cloudflare Workers subdomain.
        const workerUrl = `https://pbr.ni041372-byte.workers.dev/publish`;
        
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId, tenantId }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Worker failed to publish the post.');
        }
        
        // --- End of Communication with Worker ---


        /*
        // Option 2: Using Cloudflare Queues (Future Implementation)
        // This code is kept here for future reference as requested.
        // To enable this, you would need to:
        // 1. Create a Cloudflare Queue and bind it to the Next.js app's environment as `PUBLISH_QUEUE`.
        // 2. The worker would need to be configured to be triggered by this queue.
        // 3. Uncomment the following lines:
        
        const queue = process.env.PUBLISH_QUEUE as any;
        if (!queue) {
            throw new Error("Cloudflare Queue (PUBLISH_QUEUE) is not configured.");
        }
        await queue.send({ postId, tenantId });
        
        console.log(`Queued post ${postId} for tenant ${tenantId} for publishing.`);
        
        // When using a queue, the UI would show "Publishing started..."
        // The final status update would happen asynchronously when the worker finishes.
        // For simplicity in this step, we will continue with the direct-response flow.
        */


        // Revalidate caches to reflect the updated post status ('PUBLISHING', and then 'PUBLISHED' by the worker)
        revalidateTag(`posts-for-tenant:${tenantId}`);
        revalidateTag(`post:${postId}`);
        if (post.slug) {
            revalidateTag(`post-by-slug:${tenantId}:${post.slug}`);
        }
        
        return { success: true, message: `Worker has successfully published the post: "${post.title}".`, postId };

    } catch (error: any) {
        console.error(`Error in publishPost action for post ${postId}:`, error);
        // The worker handles its own rollback. The action here just reports the failure.
        return { success: false, message: `Failed to trigger publish worker: ${error.message}` };
    }
}
