import * as aws4 from 'aws4';

export default {
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);

		if (request.method === 'POST' && pathname === '/upload/presigned') {
			return handlePresignedUrlRequest(request, env);
		}

		return new Response('Not found', { status: 404 });
	},
};

async function handlePresignedUrlRequest(request, env) {
	try {
		// Mock tenantId for now, in a real app this would come from an auth system
		const tenantId = 'dev-tenant';

		const { filename, contentType } = await request.json();
		if (!filename || !contentType) {
			return new Response(JSON.stringify({ error: 'Filename and contentType are required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const key = `${tenantId}/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${crypto.randomUUID()}-${filename}`;

		const presignedUrl = await createPresignedUrl({
			r2: env.R2_ASSETS,
			bucketName: 'endpr-assets',
			key,
			method: 'PUT',
			expiresIn: 300, // 5 minutes
			env: env,
		});

		return new Response(JSON.stringify({ url: presignedUrl, key: key }), {
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Error creating presigned URL:', error);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

async function createPresignedUrl({ r2, bucketName, key, method, expiresIn, env }) {
	const accessKeyId = env.R2_ACCESS_KEY_ID;
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;

    if (!accessKeyId || !secretAccessKey || !accountId) {
        throw new Error('R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CLOUDFLARE_ACCOUNT_ID environment variables are required.');
    }

	const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`);

	const signedRequest = aws4.sign({
		host: url.host,
		path: url.pathname,
		service: 's3',
		region: 'auto',
		method: method,
		expiresIn: expiresIn,
	}, {
		accessKeyId: accessKeyId,
		secretAccessKey: secretAccessKey,
	});

	const presignedUrl = new URL(`https://${signedRequest.hostname}${signedRequest.path}`);
	return presignedUrl.toString();
}
