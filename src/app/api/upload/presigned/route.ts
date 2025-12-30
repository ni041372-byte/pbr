// src/app/api/upload/presigned/route.ts
import { NextResponse } from 'next/server';
import { getR2Binding } from '@/lib/r2'; // Assuming an R2 binding helper
import { auth } from '@/lib/auth';
import { createPresignedUrl } from '@/lib/r2-presigned';


export async function POST(request: Request) {
    try {
        const session = await auth(); // Get session to identify the user and tenant
        if (!session?.user?.tenantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const tenantId = session.user.tenantId;

        const { filename, contentType } = await request.json();
        if (!filename || !contentType) {
            return NextResponse.json({ error: 'Filename and contentType are required' }, { status: 400 });
        }

        const r2 = getR2Binding();
        const bucketName = 'endpr-assets';

        // Enforce tenantId in the file key for isolation
        const key = `${tenantId}/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${crypto.randomUUID()}-${filename}`;

        // Generate a presigned URL for PUT operation
        const presignedUrl = await createPresignedUrl({
            r2,
            bucketName,
            key,
            method: 'PUT',
            expiresIn: 300, // 5 minutes
        });

        return NextResponse.json({
            url: presignedUrl,
            key: key, // The client will need this to construct the final URL after upload
        });

    } catch (error: any) {
        console.error('Error creating presigned URL:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
