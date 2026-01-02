// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { getD1Binding, getTenantByHostnameEdge } from './lib/d1';

// This is the D1 binding from wrangler.toml
// In a Cloudflare environment, you can access it like this.
// Note: This might be different based on your exact setup,
// especially with Next.js on Pages. You might need to use process.env.
// We declare it here for type safety.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DB: D1Database;
    }
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to suit your needs.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

export async function middleware(request: NextRequest) {
  console.log(`[Middleware] Starting for request: ${request.nextUrl.pathname}`);
  const headers = new Headers(request.headers);
  const hostname = request.headers.get('host') || 'localhost';
  console.log(`[Middleware] Hostname: ${hostname}`);

  // For local development, wrangler binds the D1 instance to the `process.env`
  // In production, it's available in the execution context.
  const db = getD1Binding();
  console.log(`[Middleware] D1 binding retrieved. Type: ${typeof db}`);

  try {
    console.log(`[Middleware] Attempting to find tenant for hostname: ${hostname}`);
    const tenant = await getTenantByHostnameEdge(db, hostname);
    console.log('[Middleware] Tenant lookup result:', JSON.stringify(tenant, null, 2));

    if (tenant) {
      console.log(`[Middleware] Tenant found: ${tenant.slug}. Injecting headers.`);
      // If a tenant is found, inject the tenant ID into the request headers.
      headers.set('x-tenant-id', tenant.id);
      headers.set('x-tenant-slug', tenant.slug);

      // (Optional) Redirect logic for inactive tenants can be added here
      // For example:
      if (tenant.status === 'PENDING_DNS') {
        console.log(`[Middleware] Tenant status is PENDING_DNS. Redirecting to /connect-domain.`);
        const url = request.nextUrl.clone();
        url.pathname = '/connect-domain';
        return NextResponse.redirect(url);
      }

      console.log('[Middleware] Passing request to Next.js.');
      return NextResponse.next({
        request: {
          headers,
        },
      });

    } else {
      console.log('[Middleware] No tenant found. Rewriting to /404.');
      // Handle case where no tenant is found for the hostname.
      // You might want to redirect to a generic "not found" page
      // or an "unrecognized tenant" page.
      // For now, we'll just pass the request through.
      const url = request.nextUrl.clone();
      url.pathname = '/404';
      return NextResponse.rewrite(url);
    }
  } catch (error) {
    console.error('[Middleware] CRITICAL ERROR:', error);
    // In case of a DB error, you might want to return a 500 page
    // or a generic error page.
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
