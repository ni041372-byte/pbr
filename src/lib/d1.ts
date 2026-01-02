// src/lib/d1.ts
import { D1Database, D1Result } from '@cloudflare/workers-types';
import { z } from 'zod';
import { Tenant, TenantSchema, User, UserSchema, Post, PostSchema, Deployment, DeploymentSchema } from '../types/db';

// Helper to get the D1 binding.
export function getD1Binding(): D1Database {
    // Check if D1 binding is available, otherwise provide a mock for build/dev environments
    if (typeof process !== 'undefined' && (process.env.NODE_ENV === 'development' || process.env.CI)) {
        console.warn("D1 binding (process.env.DB) is not available. Providing a mock D1Database for build/dev.");
        // Basic mock for D1Database that prevents build errors
        return {
            prepare: () => ({
                bind: () => ({
                    all: async () => ({ results: [] as any[], success: true }),
                    first: async () => null,
                    run: async () => ({ success: true, changes: 0, lastRowId: null, duration: 0 })
                })
            })
        } as D1Database; // Cast to D1Database to satisfy type checking
    }

    if (!process.env.DB) {
        throw new Error("D1 binding (process.env.DB) is not available.");
    }
    return process.env.DB as D1Database;
}

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

    // --- Reads (no caching) ---
    async getTenantById(id: string): Promise<Tenant | null> {
        return this.queryOne(TenantSchema, 'SELECT * FROM tenants WHERE id = ?', [id]);
    }
    
    async getUserById(id: string): Promise<User | null> {
        const sql = `SELECT * FROM users WHERE id = ? AND (${this.getTenantIdCondition()})`;
        return this.queryOne(UserSchema, sql, this.bindTenantId([id]));
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const sql = `SELECT * FROM users WHERE email = ? AND (${this.getTenantIdCondition()})`;
        return this.queryOne(UserSchema, sql, this.bindTenantId([email]));
    }

    async getPostById(id: string): Promise<Post | null> {
        if (!this.tenantId) return null;
        const sql = `SELECT * FROM posts WHERE id = ? AND tenant_id = ?`;
        return this.queryOne(PostSchema, sql, [id, this.tenantId]);
    }

    async getPostsByTenant(): Promise<Post[]> {
        if (!this.tenantId) return [];
        return this.query(PostSchema, 'SELECT * FROM posts WHERE tenant_id = ? ORDER BY updated_at DESC', [this.tenantId]);
    }

    async getPostBySlug(slug: string): Promise<Post | null> {
        if (!this.tenantId) return null;
        const sql = `SELECT * FROM posts WHERE slug = ? AND tenant_id = ?`;
        return this.queryOne(PostSchema, sql, [slug, this.tenantId]);
    }

    // --- Writes (returns the created/updated object) ---
    async createPost(data: Omit<Post, 'id' | 'tenant_id' | 'updated_at' | 'created_at' | 'version'>): Promise<Post> {
        if (!this.tenantId) throw new Error('Cannot create post without a specific tenantId.');
        const newPost = PostSchema.parse({ 
            id: `pst_${crypto.randomUUID()}`, 
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

        const updatedPost = await this.getPostById(id);
        if (!updatedPost) throw new Error('Failed to retrieve post after update.');

        return updatedPost;
    }

    async createDeployment(data: Omit<Deployment, 'id' | 'created_at'>): Promise<Deployment> {
        const finalTenantId = this.tenantId ?? data.tenant_id;
        if(!finalTenantId) throw new Error('TenantId is required for deployment.');

        const newDeployment = DeploymentSchema.parse({ 
            id: `dpl_${crypto.randomUUID()}`, 
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
            id: `tnt_${crypto.randomUUID()}`, 
            created_at: Math.floor(Date.now() / 1000),
            ...data 
        });

        await this.run(`INSERT INTO tenants (id, slug, custom_domain, github_repo, plan_tier, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newTenant.id, newTenant.slug, newTenant.custom_domain, newTenant.github_repo, newTenant.plan_tier, newTenant.config_json, newTenant.status, newTenant.created_at]);
        
        return newTenant;
    }
}

// Placeholder for getTenantByHostnameEdge to resolve the import error in middleware.ts
// The actual implementation would go here if needed.
export function getTenantByHostnameEdge(hostname: string): string | null {
    // This is a placeholder. Implement actual logic if needed.
    console.warn("getTenantByHostnameEdge called in mock/placeholder. No actual tenant resolution.");
    return null;
}