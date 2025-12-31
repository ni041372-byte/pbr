'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Post } from '@/types/db';

// A generic server action type
type PostAction = (formData: FormData) => Promise<{ success: boolean; message: string; post?: Post }>;

interface PostFormProps {
    post?: Post; // Optional post object for editing
    action: PostAction;
    tenantId: string;
}

export default function PostForm({ post, action, tenantId }: PostFormProps) {
    const router = useRouter();
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [uploading, setUploading] = useState(false);
    const contentRef = useRef<HTMLTextAreaElement>(null);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setError('');

        try {
            // 1. Get presigned URL from our API route
            const res = await fetch('/api/upload/presigned', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, contentType: file.type }),
            });

            if (!res.ok) {
                throw new Error('Failed to get presigned URL.');
            }

            const { presignedUrl, publicUrl } = await res.json();

            // 2. Upload file directly to R2 using the presigned URL
            const uploadRes = await fetch(presignedUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type },
            });

            if (!uploadRes.ok) {
                throw new Error('Failed to upload image.');
            }

            // 3. Insert the public URL into the textarea
            const markdownImage = `\n![${file.name}](${publicUrl})\n`;
            if (contentRef.current) {
                contentRef.current.value += markdownImage;
            }
            setMessage('Image uploaded successfully!');

        } catch (err: any) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        setMessage('');

        const formData = new FormData(e.currentTarget);
        formData.append('tenantId', tenantId);

        const result = await action(formData);

        if (result.success) {
            setMessage(result.message);
            setTimeout(() => router.push('/admin'), 1500);
        } else {
            setError(result.message);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            {error && <p style={{ color: 'red' }}>Error: {error}</p>}
            {message && <p style={{ color: 'green' }}>{message}</p>}
            
            <input type="hidden" name="postId" defaultValue={post?.id} />

            <div>
                <label htmlFor="title">Title</label>
                <input type="text" id="title" name="title" defaultValue={post?.title} required style={{ width: '100%' }} />
            </div>

            <div>
                <label htmlFor="slug">Slug</label>
                <input type="text" id="slug" name="slug" defaultValue={post?.slug} required style={{ width: '100%' }} />
            </div>

            <div>
                <label htmlFor="image-upload">Upload Image</label>
                <input type="file" id="image-upload" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
                {uploading && <span>Uploading...</span>}
            </div>

            <div>
                <label htmlFor="content_md">Content (Markdown)</label>
                <textarea
                    id="content_md"
                    name="content_md"
                    ref={contentRef}
                    defaultValue={post?.content_md ?? ''}
                    rows={20}
                    style={{ width: '100%' }}
                />
            </div>
            
            <button type="submit">{post ? 'Update Post' : 'Create Post'}</button>
        </form>
    );
}
