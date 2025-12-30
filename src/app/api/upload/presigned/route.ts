// src/app/api/upload/presigned/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { R2Bucket } from '@cloudflare/workers-types';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid'; // For generating unique IDs

// Type definitions for R2 binding
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      R2_ASSETS: R2Bucket; // Name of your R2 bucket binding
    }
  }
}

// Ensure nanoid is available. It's a small dependency.
// If not installed: npm install nanoid

export async function POST(request: NextRequest) {
  try {
    const tenantId = request.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID not found in headers.' }, { status: 400 });
    }

    const { filename, filetype, contentLength } = await request.json();

    if (!filename || !filetype || !contentLength) {
      return NextResponse.json({ error: 'Missing filename, filetype, or contentLength.' }, { status: 400 });
    }

    // Validate file size (e.g., max 5MB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
    if (contentLength > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File size exceeds limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB.` }, { status: 400 });
    }

    // Generate a unique key for the R2 object
    // Format: /{tenantId}/{year}/{month}/{nanoid}.{ext}
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const fileExtension = filename.split('.').pop();
    const key = `${tenantId}/${year}/${month}/${nanoid()}.${fileExtension}`;

    // R2 works with the S3 API
    // Need to mock the S3Client for local development as R2_ASSETS is not a real S3Client.
    // In a deployed Cloudflare Worker, `env.R2_ASSETS` would be the R2Bucket binding directly,
    // and you'd use `R2_ASSETS.put` or similar.
    // However, for generating presigned URLs using @aws-sdk/s3-request-presigner, we need an S3Client instance.
    // Cloudflare provides a way to bind R2 to an S3 compatible endpoint.
    // For local development with `wrangler dev`, this part needs careful handling.

    // This is a placeholder for `S3Client` setup.
    // In a real Cloudflare Workers environment, the R2Bucket binding would be available
    // and you would interact with it directly. For generating presigned URLs using the AWS SDK locally,
    // you'd typically point to a local S3 mock or Cloudflare's S3 compatibility API.
    // For local dev, `wrangler dev` usually binds R2 buckets to a local endpoint, but `getSignedUrl`
    // requires a more complete S3Client config.
    // For now, we'll assume the environment provides the necessary credentials for S3Client to connect to R2's S3-compatible API.
    const s3Client = new S3Client({
      region: 'auto', // Cloudflare R2 does not use traditional AWS regions
      endpoint: process.env.R2_ENDPOINT, // e.g., 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com'
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || 'dummy',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'dummy',
      },
      forcePathStyle: true, // Required for Cloudflare R2
    });

    const putCommand = new PutObjectCommand({
      Bucket: 'endpr-assets', // The name of your R2 bucket
      Key: key,
      ContentType: filetype,
      ContentLength: contentLength,
    });

    // Generate the presigned URL with a 5-minute expiry
    const presignedUrl = await getSignedUrl(s3Client, putCommand, {
      expiresIn: 300, // 5 minutes
    });

    return NextResponse.json({ url: presignedUrl, key: key });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return NextResponse.json({ error: 'Failed to generate presigned URL.' }, { status: 500 });
  }
}