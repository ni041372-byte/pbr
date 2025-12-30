// src/lib/r2-presigned.ts
import { R2Bucket } from '@cloudflare/workers-types';
import * as aws4 from 'aws4';

interface PresignedUrlConfig {
    r2: R2Bucket;
    bucketName: string;
    key: string;
    method: 'PUT';
    expiresIn: number; // in seconds
}

export async function createPresignedUrl({ r2, bucketName, key, method, expiresIn }: PresignedUrlConfig): Promise<string> {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
        throw new Error('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables are required for presigned URLs.');
    }

    // R2 uses the S3 API, so we configure aws4 for S3.
    // The endpoint is crucial for Cloudflare R2.
    // It typically follows the format: https://<account_id>.r2.cloudflarestorage.com
    // We assume ACCOUNT_ID is available as an environment variable.
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
        throw new Error('CLOUDFLARE_ACCOUNT_ID environment variable is required.');
    }

    const service = 's3';
    const region = 'auto'; // R2 typically uses 'auto' or a generic region

    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`);

    const signedRequest = aws4.sign({
        host: url.host,
        path: url.pathname,
        service: service,
        region: region,
        method: method,
        expiresIn: expiresIn,
    }, {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
    });

    // Construct the presigned URL from the signed request details
    const presignedUrl = new URL(`https://${signedRequest.hostname}${signedRequest.path}`);
    return presignedUrl.toString();
}
