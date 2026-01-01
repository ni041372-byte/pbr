// src/lib/d1.ts
import { D1Database, D1Result } from '@cloudflare/workers-types';
import { z } from 'zod';
import { Tenant, TenantSchema, User, UserSchema, Post, PostSchema, Deployment, DeploymentSchema } from '../types/db';
import { unstable_cache as nextCache, revalidateTag } from 'next/cache';
import { randomUUID } from 'crypto';

// Helper to get the D1 binding.
export function getD1Binding(): D1Database {
    if (!process.env.DB) {
        throw new Error("D1 binding (process.env.DB) is not available.");
    }
    return process.env.DB as D1Database;
}

// Wrapper for nextCache to simplify usage
const cache = <T>(
    func: () => Promise<T>,
    keys: string[],
    tags: string[],
    revalidate: number
): Promise<T> => {
    return nextCache(func, keys, { tags, revalidate })();
};


// Base D1 client
class BaseD1Client {
    protected db: D1Database;
    constructor(d1: D1Database) { this.db = d1; }

    protected async query<T extends z.ZodTypeAny>(schema: T, sql: string, params: any[] = []): Promise<z.infer<T>[]> {
        const { results } = await this.db.prepare(sql).bind(...params).all<z.infer<T>>();
        return results ? results.map(row => schema.parse(row)) : [];
    }
    protected async queryOne<T extends z.ZodTypeAny>(schema: T, sql: string, params: any[] = []): Promise<z.infer<T> | null> {
        const result = await this.db.prepare(sql).bind(...params).first<z.infer<T>>();
        return result ? schema.parse(result) : null;
    }
    protected async run(sql: string, params: any[] = []): Promise<D1Result> {
        return this.db.prepare(sql).bind(...params).run();
    }
}

// Tenant-aware D1 client
export class D1Client extends BaseD1Client {
    private tenantId: string | null;

    constructor(d1: D1Database, tenantId: string | null = null) {
        super(d1);
        this.tenantId = tenantId;
    }

    private bindTenantId = (params: any[]): any[] => this.tenantId ? [...params, this.tenantId] : params;
    private getTenantIdCondition = (): string => this.tenantId === null ? 'tenant_id IS NULL' : 'tenant_id = ?';

    // --- Cached Reads ---
    async getTenantById(id: string): Promise<Tenant | null> {
        return cache(() => this.queryOne(TenantSchema, 'SELECT * FROM tenants WHERE id = ?', [id]),
            [`tenant:${id}`], [`tenants`], 60);
    }
    
    async getUserById(id: string): Promise<User | null> {
        const sql = `SELECT * FROM users WHERE id = ? AND (${this.getTenantIdCondition()})`;
        return cache(() => this.queryOne(UserSchema, sql, this.bindTenantId([id])),
            [`user:${id}`], [`users`, `tenant:${this.tenantId}`], 60);
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const sql = `SELECT * FROM users WHERE email = ? AND (${this.getTenantIdCondition()})`;
        return cache(() => this.queryOne(UserSchema, sql, this.bindTenantId([email])),
            [`user-by-email:${email}`], [`users`, `tenant:${this.tenantId}`], 10);
    }

    async getPostById(id: string): Promise<Post | null> {
        if (!this.tenantId) return null;
        const sql = `SELECT * FROM posts WHERE id = ? AND tenant_id = ?`;
        return cache(() => this.queryOne(PostSchema, sql, [id, this.tenantId]),
            [`post:${id}`], [`posts`, `tenant:${this.tenantId}`], 60);
    }

    async getPostsByTenant(): Promise<Post[]> {
        if (!this.tenantId) return [];
        return cache(() => this.query(PostSchema, 'SELECT * FROM posts WHERE tenant_id = ? ORDER BY updated_at DESC', [this.tenantId]),
            [`posts-for-tenant:${this.tenantId}`], [`posts`, `tenant:${this.tenantId}`], 60);
    }

    async getPostBySlug(slug: string): Promise<Post | null> {
        if (!this.tenantId) return null;
        const sql = `SELECT * FROM posts WHERE slug = ? AND tenant_id = ?`;
        return cache(() => this.queryOne(PostSchema, sql, [slug, this.tenantId]),
            [`post-by-slug:${this.tenantId}:${slug}`], [`posts`, `tenant:${this.tenantId}`], 60);
    }

    // --- Writes (now returns the created/updated object) ---
    async createPost(data: Omit<Post, 'id' | 'tenant_id' | 'updated_at' | 'created_at' | 'version'>): Promise<Post> {
        if (!this.tenantId) throw new Error('Cannot create post without a specific tenantId.');
        const newPost = PostSchema.parse({ 
            id: `pst_${randomUUID()}`, 
            tenant_id: this.tenantId, 
            created_at: Math.floor(Date.now() / 1000), 
            updated_at: Math.floor(Date.now() / 1000), 
            version: 0, 
            ...data 
        });

        await this.run(`INSERT INTO posts (id, tenant_id, title, slug, content_md, frontmatter, status, last_published_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newPost.id, newPost.tenant_id, newPost.title, newPost.slug, newPost.content_md, newPost.frontmatter, newPost.status, newPost.last_published_at, newPost.updated_at, newPost.version]);
        
        return newPost;
    }

    async updatePost(id: string, data: Partial<Omit<Post, 'id' | 'tenant_id' | 'created_at'>>, expectedVersion: number): Promise<Post> {
        if (!this.tenantId) throw new Error('Cannot update post without a specific tenantId.');
        const fields = Object.keys(data).map(key => `${key} = ?`);
        if (fields.length === 0) throw new Error('No fields provided for update.');

        const newVersion = expectedVersion + 1;
        const newUpdatedAt = Math.floor(Date.now() / 1000);

        const params = [...Object.values(data), newUpdatedAt, newVersion, id, this.tenantId, expectedVersion];
        const sql = `UPDATE posts SET ${fields.join(', ')}, updated_at = ?, version = ? WHERE id = ? AND tenant_id = ? AND version = ?`;
        
        const result = await this.run(sql, params);
        if (result.meta.changes === 0) throw new Error('Optimistic locking failed: Post was modified by another user or does not exist.');

        // Invalidate cache and return the freshly updated post
        revalidateTag(`post:${id}`);
        const updatedPost = await this.getPostById(id);
        if (!updatedPost) throw new Error('Failed to retrieve post after update.');

        return updatedPost;
    }

    async createDeployment(data: Omit<Deployment, 'id' | 'created_at'>): Promise<Deployment> {
        const finalTenantId = this.tenantId ?? data.tenant_id;
        if(!finalTenantId) throw new Error('TenantId is required for deployment.');

        const newDeployment = DeploymentSchema.parse({ 
            id: `dpl_${randomUUID()}`, 
            tenant_id: finalTenantId, 
            created_at: Math.floor(Date.now() / 1000),
            ...data 
        });

        await this.run(`INSERT INTO deployments (id, tenant_id, trigger_source, github_commit_sha, cf_deployment_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newDeployment.id, newDeployment.tenant_id, newDeployment.trigger_source, newDeployment.github_commit_sha, newDeployment.cf_deployment_id, newDeployment.status, newDeployment.created_at]);

        return newDeployment;
    }
}

// Special client for Super Admin operations
export class SuperAdminD1Client extends D1Client {
    constructor(d1: D1Database) {
        super(d1, null);
    }
    async createTenant(data: Omit<Tenant, 'id' | 'created_at'>): Promise<Tenant> {
        const newTenant = TenantSchema.parse({ 
            id: `tnt_${randomUUID()}`, 
            created_at: Math.floor(Date.now() / 1000),
            ...data 
        });

        await this.run(`INSERT INTO tenants (id, slug, custom_domain, github_repo, plan_tier, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newTenant.id, newTenant.slug, newTenant.custom_domain, newTenant.github_repo, newTenant.plan_tier, newTenant.config_json, newTenant.status, newTenant.created_at]);
        
        return newTenant;
    }
}

// Cached function for Middleware/Edge
export async function getTenantByHostnameEdge(db: D1Database, hostname: string): Promise<Tenant | null> {
    const fn = async () => {
        const tenant = await db.prepare('SELECT id, slug, custom_domain, status FROM tenants WHERE custom_domain = ?').bind(hostname).first<Tenant>();
        return tenant ? TenantSchema.parse(tenant) : null;
    };
    return cache(fn, [`tenant-by-hostname:${hostname}`], [`tenants`], 300); // Cache for 5 minutes
}