// src/lib/d1.ts
import { D1Database, D1Result } from '@cloudflare/workers-types';
import { z } from 'zod';
import { Tenant, TenantSchema, User, UserSchema, Post, PostSchema, Deployment, DeploymentSchema } from '../types/db';
import { unstable_cache as nextCache } from 'next/cache';

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
        return results.map(row => schema.parse(row));
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
        // Caching user by email might have security implications if keys are guessable.
        // For now, we keep it short-lived.
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

    // --- Writes (no caching, but they are simple) ---
    async createUser(data: Omit<User, 'id' | 'created_at'>): Promise<D1Result> {
        const id = `usr_${randomUUID()}`;
        const finalTenantId = this.tenantId ?? data.tenant_id;
        const parsedData = UserSchema.parse({ id, tenant_id: finalTenantId, created_at: Math.floor(Date.now() / 1000), ...data });
        return this.run(`INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)`, [parsedData.id, parsedData.tenant_id, parsedData.email, parsedData.role, parsedData.created_at]);
    }

    async updateUser(id: string, data: Partial<Omit<User, 'id'>>): Promise<D1Result> {
        const fields = Object.keys(data).map(key => `${key} = ?`);
        if (fields.length === 0) throw new Error('No fields provided for update.');

        const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
        const params = [...Object.values(data), id];

        const result = await this.run(sql, params);
        if (result.changes === 0) {
            throw new Error('User not found or no changes made.');
        }
        return result;
    }

    async deleteUser(id: string): Promise<D1Result> {
        const sql = `DELETE FROM users WHERE id = ?`;
        const result = await this.run(sql, [id]);
        if (result.changes === 0) {
            throw new Error('User not found.');
        }
        return result;
    }



    async createPost(data: Omit<Post, 'id' | 'tenant_id' | 'updated_at' | 'created_at' | 'version'>): Promise<D1Result> {
        if (!this.tenantId) throw new Error('Cannot create post without a specific tenantId.');
        const id = `pst_${randomUUID()}`;
        const parsedData = PostSchema.parse({ id, tenant_id: this.tenantId, created_at: Date.now(), updated_at: Date.now(), version: 0, ...data });
        return this.run(`INSERT INTO posts (id, tenant_id, title, slug, content_md, frontmatter, status, last_published_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [parsedData.id, parsedData.tenant_id, parsedData.title, parsedData.slug, parsedData.content_md, parsedData.frontmatter, parsedData.status, parsedData.last_published_at, parsedData.updated_at, parsedData.version]);
    }

    async updatePost(id: string, data: Partial<Omit<Post, 'id' | 'tenant_id' | 'created_at'>>, expectedVersion: number): Promise<D1Result> {
        if (!this.tenantId) throw new Error('Cannot update post without a specific tenantId.');
        const fields = Object.keys(data).map(key => `${key} = ?`);
        if (fields.length === 0) throw new Error('No fields provided for update.');

        const params = [...Object.values(data), Date.now(), expectedVersion + 1, id, this.tenantId, expectedVersion];
        const sql = `UPDATE posts SET ${fields.join(', ')}, updated_at = ?, version = ? WHERE id = ? AND tenant_id = ? AND version = ?`;
        const result = await this.run(sql, params);
        if (result.changes === 0) throw new Error('Optimistic locking failed: Post was modified by another user or does not exist.');
        return result;
    }

    async createDeployment(data: Omit<Deployment, 'id' | 'created_at'>): Promise<D1Result> {
        const id = `dpl_${randomUUID()}`;
        const finalTenantId = this.tenantId ?? data.tenant_id;
        if(!finalTenantId) throw new Error('TenantId is required for deployment.');
        const parsedData = DeploymentSchema.parse({ id, tenant_id: finalTenantId, created_at: Date.now(), ...data });
        return this.run(`INSERT INTO deployments (id, tenant_id, trigger_source, github_commit_sha, cf_deployment_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [parsedData.id, parsedData.tenant_id, parsedData.trigger_source, parsedData.github_commit_sha, parsedData.cf_deployment_id, parsedData.status, parsedData.created_at]);
    }
}

// Special client for Super Admin operations
export class SuperAdminD1Client extends D1Client {
    constructor(d1: D1Database) {
        super(d1, null);
    }
    async createTenant(data: Omit<Tenant, 'id' | 'created_at'>): Promise<D1Result> {
        const id = `tnt_${randomUUID()}`;
        const parsedData = TenantSchema.parse({ id, created_at: Date.now(), ...data });
        return this.run(`INSERT INTO tenants (id, slug, custom_domain, github_repo, plan_tier, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [parsedData.id, parsedData.slug, parsedData.custom_domain, parsedData.github_repo, parsedData.plan_tier, parsedData.config_json, parsedData.status, parsedData.created_at]);
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