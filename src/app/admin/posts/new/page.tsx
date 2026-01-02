// src/app/admin/posts/new/page.tsx
import { getSession } from "@/lib/auth";
import { redirect } from 'next/navigation';
import PostForm from '../post-form';
import { createPost } from '@/actions/create-post';

export const dynamic = 'force-dynamic';

export default async function NewPostPage() {
    const session = await getSession();

    if (!session?.user?.id || !session.user.tenant_id) {
        // If not authenticated or not a regular tenant user, redirect to login/admin
        redirect(session?.user?.id ? '/admin' : '/login');
    }

    return (
        <div>
            <h1>Create New Post</h1>
            <PostForm action={createPost} tenantId={session.user.tenant_id} />
        </div>
    );
}
