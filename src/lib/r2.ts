// src/lib/r2.ts
import { R2Bucket } from '@cloudflare/workers-types';

export function getR2Binding(): R2Bucket {
    if (!process.env.R2_ASSETS) {
        throw new Error("R2 binding (process.env.R2_ASSETS) is not available.");
    }
    return process.env.R2_ASSETS as R2Bucket;
}
