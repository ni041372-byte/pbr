// src/app/api/upload/presigned/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';


// This endpoint generates a presigned URL for uploading a file to R2.
export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.user?.tenant_id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = session.user.tenant_id;
    const { filename, contentType } = await request.json();

    if (!filename || !contentType) {
        return NextResponse.json({ error: 'Missing filename or contentType' }, { status: 400 });
    }

    // Generate a unique key for the object in R2
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const uniqueId = randomUUID();
    const fileExtension = filename.split('.').pop();
    const key = `${tenantId}/${year}/${month}/${uniqueId}.${fileExtension}`;
    
    // R2 Client configuration
    // These environment variables must be set in Cloudflare Pages settings.
    const r2 = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT!,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID!,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
    });

    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!, // This also needs to be in env vars
        Key: key,
        ContentType: contentType,
    });

    try {
        const presignedUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // URL expires in 5 minutes
        
        // Construct the public URL. This assumes a custom domain is configured for the R2 bucket.
        // This public URL needs to be configured as an environment variable.
        const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

        return NextResponse.json({ presignedUrl, publicUrl });
    } catch (error) {
        console.error("Error generating presigned URL:", error);
        return NextResponse.json({ error: 'Failed to generate upload URL.' }, { status: 500 });
    }
}
