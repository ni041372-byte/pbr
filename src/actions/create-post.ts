// src/actions/create-post.ts
'use server';

import { D1Client, getD1Binding } from '@/lib/d1';
import { Post } from '@/types/db';
import { getSession } from '@/lib/auth';
import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';

interface ActionResult {
    success: boolean;
    message: string;
    post?: Post;
}

export async function createPost(formData: FormData): Promise<ActionResult> {
    const session = await getSession();
    const tenantId = formData.get('tenantId') as string;

    if (!session?.user || session.user.tenant_id !== tenantId) {
        return { success: false, message: 'Unauthorized' };
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

        // Check if slug is unique for the tenant
        const existingPost = await d1Client.getPostBySlug(slug);
        if (existingPost) {
            return { success: false, message: 'This slug is already in use. Please choose a unique one.' };
        }

        const result = await d1Client.createPost({
            title,
            slug,
            content_md,
            frontmatter: JSON.stringify({ author: session.user.email }), // Add some default frontmatter
            status: 'DRAFT',
            last_published_at: null,
        });

        if (!result.success) {
             throw new Error(result.error?.message ?? 'D1 operation failed');
        }

        const newPost = await d1Client.getPostBySlug(slug);
        if (!newPost) {
            throw new Error('Failed to retrieve the newly created post.');
        }
        
        // Revalidate the data cache for the tenant's posts list
        revalidateTag(`posts-for-tenant:${tenantId}`);
        // Revalidate the admin page path to reflect changes immediately in the UI
        revalidatePath('/admin');

        return { success: true, message: 'Post created successfully!', post: newPost };

    } catch (e: any) {
        return { success: false, message: e.message };
    }
}