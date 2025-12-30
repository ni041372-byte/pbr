// src/actions/create-post.ts
'use server';

import { D1Client, getD1Binding } from '@/lib/d1';
import { Post } from '@/types/db';
import { auth } from '@/lib/auth'; // Assuming auth utility

interface CreatePostResult {
    success: boolean;
    message: string;
    postId?: string;
}

export async function createPost(formData: FormData): Promise<CreatePostResult> {
    const session = await auth();
    if (!session?.user?.tenantId) {
        return { success: false, message: 'Unauthorized: Missing tenant ID.' };
    }
    const tenantId = session.user.tenantId;

    const db = getD1Binding();
    const d1Client = new D1Client(db, tenantId);

    const title = formData.get('title') as string;
    const slug = formData.get('slug') as string;
    const content_md = formData.get('content_md') as string;
    const frontmatter = formData.get('frontmatter') as string;

    if (!title || !slug) {
        return { success: false, message: 'Title and Slug are required.' };
    }

    try {
        // Create a new post
        const result = await d1Client.createPost({
            title,
            slug,
            content_md,
            frontmatter,
            status: 'DRAFT', // Newly created posts are in DRAFT status
            last_published_at: null,
        });

        if (result.success) {
            // Need to fetch the created post to get its ID, as createPost doesn't return it directly
            const createdPost = await d1Client.queryOne(PostSchema, 'SELECT id FROM posts WHERE slug = ? AND tenant_id = ? ORDER BY created_at DESC', [slug, tenantId]);
            return { success: true, message: 'Post created successfully!', postId: createdPost?.id };
        } else {
            return { success: false, message: result.error || 'Failed to create post.' };
        }
    } catch (error: any) {
        console.error('Error creating post:', error);
        return { success: false, message: `An unexpected error occurred: ${error.message}` };
    }
}
