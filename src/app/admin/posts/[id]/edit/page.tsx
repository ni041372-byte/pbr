// src/app/admin/posts/[id]/edit/page.tsx
import { getSession } from "@/lib/auth";
import { redirect } from 'next/navigation';
import PostForm from '../../post-form';
import { updatePost } from '@/actions/update-post';
import { D1Client, getD1Binding } from "@/lib/d1";

interface EditPostPageProps {
    params: {
        id: string;
    }
}

export default async function EditPostPage({ params }: EditPostPageProps) {
    const session = await getSession();
    const postId = params.id;

    if (!session?.user?.id || !session.user.tenant_id) {
        redirect(session?.user?.id ? '/admin' : '/login');
    }
    
    const db = getD1Binding();
    const d1Client = new D1Client(db, session.user.tenant_id);
    const post = await d1Client.getPostById(postId);

    if (!post) {
        return <div>Post not found.</div>
    }

    return (
        <div>
            <h1>Edit Post</h1>
            <PostForm 
                action={updatePost} 
                tenantId={session.user.tenant_id}
                post={post}
            />
        </div>
    );
}
