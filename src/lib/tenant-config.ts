// src/lib/tenant-config.ts
import { D1Database } from '@cloudflare/workers-types';
import { unstable_cache } from 'next/cache'; // Assuming Next.js 15+ and App Router

export interface SiteConfig {
    siteName: string;
    theme: string;
    menu: Array<{ label: string; path: string }>;
    // Add other site configuration properties here
}

// Define a default/fallback configuration
const DEFAULT_SITE_CONFIG: SiteConfig = {
    siteName: 'Default Site',
    theme: 'default',
    menu: [
        { label: 'Home', path: '/' },
        { label: 'About', path: '/about' },
    ],
};

// This function assumes `process.env.DB` is available,
// similar to how it's accessed in `middleware.ts`.
// In a more robust setup, D1 might be passed as an argument.
const getDb = () => {
    if (!process.env.DB) {
        throw new Error(
            'D1Database binding not available. Check your wrangler.toml and environment setup.'
        );
    }
    return process.env.DB;
};

export const getTenantConfig = unstable_cache(
    async (tenantId: string): Promise<SiteConfig> => {
        const db = getDb();
        try {
            const stmt = db.prepare('SELECT config_json FROM tenants WHERE id = ?');
            const result = await stmt.bind(tenantId).first<{ config_json: string }>();

            if (result && result.config_json) {
                try {
                    const parsedConfig: SiteConfig = JSON.parse(result.config_json);
                    return { ...DEFAULT_SITE_CONFIG, ...parsedConfig }; // Merge with default for robustness
                } catch (parseError) {
                    console.error(`Error parsing config_json for tenant ${tenantId}:`, parseError);
                    // Fallback to default if parsing fails
                    return DEFAULT_SITE_CONFIG;
                }
            }
        } catch (dbError) {
            console.error(`Error fetching config for tenant ${tenantId}:`, dbError);
            // Fallback to default if DB fetch fails
        }

        // If no config found, or DB/parsing failed, return default
        return DEFAULT_SITE_CONFIG;
    },
    ['tenant-config'], // Key for caching
    {
        tags: ['tenant-config'], // Tags for revalidation
        revalidate: 60 * 5, // Revalidate every 5 minutes (adjust as needed)
    }
);

// Helper to get config from request headers (set by middleware)
export async function getSiteConfigFromHeaders(headers: Headers): Promise<SiteConfig> {
    const tenantId = headers.get('x-tenant-id');
    if (!tenantId) {
        console.warn('x-tenant-id header not found. Returning default config.');
        return DEFAULT_SITE_CONFIG;
    }
    return getTenantConfig(tenantId);
}
