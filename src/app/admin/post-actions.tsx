'use client';

import { publishPost } from '@/actions/post';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface PostActionsProps {
    post: {
        id: string;
        tenant_id: string;
    };
}

export function PostActions({ post }: PostActionsProps) {
    const router = useRouter();
    const [isPublishing, setIsPublishing] = useState(false);
    const [result, setResult] = useState('');

    const handlePublish = async () => {
        setIsPublishing(true);
        setResult('');
        const res = await publishPost(post.id, post.tenant_id);
        setResult(res.message);
        setIsPublishing(false);
        // Refresh the page to show the new status
        router.refresh();
    };

    return (
        <div style={{ display: 'inline-block', marginLeft: '20px' }}>
            <Link href={`/admin/posts/${post.id}/edit`}>
                <button>Edit</button>
            </Link>
            <button onClick={handlePublish} disabled={isPublishing}>
                {isPublishing ? 'Publishing...' : 'Publish'}
            </button>
            {result && <span style={{ marginLeft: '10px' }}>{result}</span>}
        </div>
    );
}
