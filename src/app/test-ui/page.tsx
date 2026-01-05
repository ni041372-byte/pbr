// src/app/test-ui/page.tsx
'use client';

import React, { useState, FormEvent, ChangeEvent } from 'react';
import { createPost } from '@/actions/create-post';
import { publishPost } from '@/actions/post'; // Assuming this is the correct path to publishPost

export default function TestUIPage() {
  const [createPostResult, setCreatePostResult] = useState<{ success: boolean; message: string; postId?: string } | null>(null);
  const [imageUploadResult, setImageUploadResult] = useState<string | null>(null);
  const [publishPostResult, setPublishPostResult] = useState<{ success: boolean; message: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [postIdToPublish, setPostIdToPublish] = useState<string>('');

  const MOCK_TENANT_ID = 'dev-tenant'; // Hardcoded tenant ID for testing

  const handleCreatePost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatePostResult(null);

    const formData = new FormData(event.currentTarget);
    const result = await createPost(formData);
    setCreatePostResult(result);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      setSelectedFile(event.target.files[0]);
    } else {
      setSelectedFile(null);
    }
  };

  const handleImageUpload = async () => {
    if (!selectedFile) {
      alert('Please select an image to upload.');
      return;
    }
    setImageUploadResult(null);

    try {
      // 1. Get presigned URL from the pbr worker
      const presignedUrlApi = `https://pbr.<your-workers-subdomain>.workers.dev/upload/presigned`; // *** REMEMBER TO REPLACE <your-workers-subdomain> ***
      const response = await fetch(presignedUrlApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Assuming the worker can extract tenantId from the body or a header if needed
          // For now, it's hardcoded in the worker, but you might pass it here:
          // 'X-Tenant-Id': MOCK_TENANT_ID,
        },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentType: selectedFile.type,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get presigned URL: ${response.statusText}`);
      }

      const { url, key } = await response.json();
      console.log('Received presigned URL:', url);
      console.log('R2 Key:', key);

      // 2. Upload image using the presigned URL
      const uploadResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type,
        },
        body: selectedFile,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload image to R2: ${uploadResponse.statusText}`);
      }

      const imageUrl = `https://r2.cloudflarestorage.com/${key}`; // Construct public URL
      setImageUploadResult(`Image uploaded successfully! URL: ${imageUrl}`);
    } catch (error: any) {
      console.error('Error during image upload:', error);
      setImageUploadResult(`Image upload failed: ${error.message}`);
    }
  };

  const handlePublishPost = async () => {
    if (!postIdToPublish) {
      alert('Please enter a Post ID to publish.');
      return;
    }
    setPublishPostResult(null);

    try {
      const result = await publishPost(postIdToPublish, MOCK_TENANT_ID);
      setPublishPostResult(result);
    } catch (error: any) {
      console.error('Error publishing post:', error);
      setPublishPostResult({ success: false, message: `Failed to publish post: ${error.message}` });
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">CMS Test UI</h1>

      {/* Post Creation Section */}
      <section className="mb-8 p-6 bg-white shadow-md rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">Create New Post</h2>
        <form onSubmit={handleCreatePost} className="space-y-4">
          <div>
            <label htmlFor="postTitle" className="block text-sm font-medium text-gray-700">Title</label>
            <input type="text" id="postTitle" name="title" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" required />
          </div>
          <div>
            <label htmlFor="postSlug" className="block text-sm font-medium text-gray-700">Slug</label>
            <input type="text" id="postSlug" name="slug" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" required />
          </div>
          <div>
            <label htmlFor="postContent" className="block text-sm font-medium text-gray-700">Content (Markdown)</label>
            <textarea id="postContent" name="content_md" rows={5} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"></textarea>
          </div>
          <div>
            <label htmlFor="postFrontmatter" className="block text-sm font-medium text-gray-700">Frontmatter (JSON)</label>
            <textarea id="postFrontmatter" name="frontmatter" rows={3} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"></textarea>
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md shadow-md hover:bg-blue-700">Create Post</button>
        </form>
        {createPostResult && (
          <div className={`mt-4 p-3 rounded-md ${createPostResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <p>{createPostResult.message}</p>
            {createPostResult.postId && <p>Post ID: {createPostResult.postId}</p>}
          </div>
        )}
      </section>

      {/* Image Upload Section */}
      <section className="mb-8 p-6 bg-white shadow-md rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">Upload Image to R2</h2>
        <input type="file" id="imageUpload" accept="image/*" className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" onChange={handleFileChange} />
        <button type="button" onClick={handleImageUpload} className="mt-4 px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow-md hover:bg-green-700" disabled={!selectedFile}>Upload Image</button>
        {imageUploadResult && (
          <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded-md">
            <p>{imageUploadResult}</p>
          </div>
        )}
      </section>

      {/* Post Publishing Section */}
      <section className="mb-8 p-6 bg-white shadow-md rounded-lg">
        <h2 className="text-2xl font-semibold mb-4">Publish Post</h2>
        <div>
          <label htmlFor="postIdToPublish" className="block text-sm font-medium text-gray-700">Post ID to Publish</label>
          <input type="text" id="postIdToPublish" name="postId" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2" value={postIdToPublish} onChange={(e) => setPostIdToPublish(e.target.value)} />
        </div>
        <button type="button" onClick={handlePublishPost} className="mt-4 px-4 py-2 bg-purple-600 text-white font-semibold rounded-md shadow-md hover:bg-purple-700" disabled={!postIdToPublish}>Publish Post</button>
        {publishPostResult && (
          <div className={`mt-4 p-3 rounded-md ${publishPostResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <p>{publishPostResult.message}</p>
          </div>
        )}
      </section>
    </div>
  );
}