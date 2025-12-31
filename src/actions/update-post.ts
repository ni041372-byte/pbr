// src/actions/update-post.ts
'use server';

import { D1Client, getD1Binding } from '@/lib/d1';
import { Post } from '@/types/db';
import { getSession } from '@/lib/auth';
import { revalidatePath, revalidateTag } from 'next/cache';

interface ActionResult {
    success: boolean;
    message: string;
    post?: Post;
}

export async function updatePost(formData: FormData): Promise<ActionResult> {
    const session = await getSession();
    const tenantId = formData.get('tenantId') as string;
    const postId = formData.get('postId') as string;

    if (!session?.user || session.user.tenant_id !== tenantId || !postId) {
        return { success: false, message: 'Unauthorized or missing post ID.' };
    }

    const title = formData.get('title') as string;
    const slug = formData.get('slug') as string;
    const content_md = formData.get('content_md') as string;

    if (!title || !slug) {
        return { success: false, message: 'Title and Slug are required fields.' };
    }

    try {
        const db = getD1Binding();
        const d1Client = new D1Client(db, tenantId);

        const currentPost = await d1Client.getPostById(postId);
        if (!currentPost) {
            return { success: false, message: 'Post not found.' };
        }

        // Check if slug is being changed and if the new one is unique
        if (slug !== currentPost.slug) {
            const existingPost = await d1Client.getPostBySlug(slug);
            if (existingPost) {
                return { success: false, message: 'This slug is already in use. Please choose a unique one.' };
            }
        }
        
        await d1Client.updatePost(postId, {
            title,
            slug,
            content_md,
        }, currentPost.version);

        const updatedPost = await d1Client.getPostById(postId);
        if (!updatedPost) {
            throw new Error('Failed to retrieve the updated post.');
        }
        
        // Revalidate data caches
        revalidateTag(`posts-for-tenant:${tenantId}`);
        revalidateTag(`post:${postId}`);
        revalidateTag(`post-by-slug:${tenantId}:${slug}`);
        if (slug !== currentPost.slug) {
            revalidateTag(`post-by-slug:${tenantId}:${currentPost.slug}`);
        }

        // Revalidate path caches
        revalidatePath('/admin');
        revalidatePath(`/admin/posts/${postId}/edit`);

        return { success: true, message: 'Post updated successfully!', post: updatedPost };

    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
