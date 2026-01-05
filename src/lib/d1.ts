// src/lib/d1.ts
import { D1Database, D1Result, D1PreparedStatement } from '@cloudflare/workers-types';
import { z } from 'zod';
import { Tenant, TenantSchema, User, UserSchema, Post, PostSchema, Deployment, DeploymentSchema } from '../types/db';

// Helper to get the D1 binding. In a real Next.js/Cloudflare Pages app,
// the D1 binding is often available via `env.DB` in Workers or `process.env.DB` in middleware/server components.
export function getD1Binding(): D1Database {
    // This assumes `process.env.DB` is available which is true in Next.js Server Components
    // or middleware when deployed to Cloudflare Pages/Workers.
    // For local development, this is set up by wrangler.
    if (!process.env.DB) {
        // Fallback for types in development if DB is not always present in process.env
        // A more robust solution might involve passing DB explicitly or using a context provider.
        console.warn("process.env.DB is not defined. Ensure D1 binding is configured correctly.");
        // Provide a mock for local dev if needed, or throw error if strict
        throw new Error("D1 binding (process.env.DB) is not available.");
    }
    return process.env.DB as D1Database;
}


// Base D1 client for direct queries (use with caution, does not enforce tenant_id)
class BaseD1Client {
    protected db: D1Database;

    constructor(d1: D1Database) {
        this.db = d1;
    }

    protected async query<T extends z.ZodTypeAny>(
        schema: T,
        sql: string,
        params: any[] = []
    ): Promise<z.infer<T>[]> {
        const stmt = this.db.prepare(sql).bind(...params);
        const { results } = await stmt.all<z.infer<T>>();
        // Validate each result against the schema
        return results.map(row => schema.parse(row));
    }

    protected async queryOne<T extends z.ZodTypeAny>(
        schema: T,
        sql: string,
        params: any[] = []
    ): Promise<z.infer<T> | null> {
        const stmt = this.db.prepare(sql).bind(...params);
        const result = await stmt.first<z.infer<T>>();
        return result ? schema.parse(result) : null;
    }

    protected async run(sql: string, params: any[] = []): Promise<D1Result> {
        const stmt = this.db.prepare(sql).bind(...params);
        return stmt.run();
    }
}

// Tenant-aware D1 client
export class D1Client extends BaseD1Client {
    private tenantId: string | null; // null for Super Admin

    constructor(d1: D1Database, tenantId: string | null = null) {
        super(d1);
        this.tenantId = tenantId;
    }

    // --- Helper to bind tenant_id ---
    private bindTenantId(params: any[]): any[] {
        if (this.tenantId === null) { // Super Admin case
            return params;
        }
        return [...params, this.tenantId];
    }

    private getTenantIdCondition(): string {
        return this.tenantId === null ? 'tenant_id IS NULL' : 'tenant_id = ?';
    }


    // --- Tenants Table ---
    async getTenantById(id: string): Promise<Tenant | null> {
        return this.queryOne(TenantSchema, 'SELECT * FROM tenants WHERE id = ?', [id]);
    }

    async getTenantByHostname(hostname: string): Promise<Tenant | null> {
        return this.queryOne(TenantSchema, 'SELECT * FROM tenants WHERE custom_domain = ?', [hostname]);
    }

    // This method can only be called by Super Admin or if tenantId matches
    async getAllTenants(): Promise<Tenant[]> {
        if (this.tenantId !== null) {
            throw new Error('Only Super Admin can list all tenants.');
        }
        return this.query(TenantSchema, 'SELECT * FROM tenants');
    }


    // --- Users Table ---
    async getUserById(id: string): Promise<User | null> {
        const sql = `SELECT * FROM users WHERE id = ? AND (${this.getTenantIdCondition()})`;
        const params = this.bindTenantId([id]);
        return this.queryOne(UserSchema, sql, params);
    }

    async getUserByEmail(email: string): Promise<User | null> {
        const sql = `SELECT * FROM users WHERE email = ? AND (${this.getTenantIdCondition()})`;
        const params = this.bindTenantId([email]);
        return this.queryOne(UserSchema, sql, params);
    }

    async createUser(data: Omit<User, 'id' | 'created_at'>): Promise<D1Result> {
        const id = crypto.randomUUID();
        const finalTenantId = this.tenantId === null ? data.tenant_id : this.tenantId; // Super admin can specify, regular tenant is implied
        const parsedData = UserSchema.parse({ id, tenant_id: finalTenantId, created_at: Math.floor(Date.now() / 1000), ...data });
        const sql = `INSERT INTO users (id, tenant_id, email, role, created_at) VALUES (?, ?, ?, ?, ?)`;
        return this.run(sql, [parsedData.id, parsedData.tenant_id, parsedData.email, parsedData.role, parsedData.created_at]);
    }


    // --- Posts Table (with Optimistic Locking support) ---
    async getPostById(id: string): Promise<Post | null> {
        const sql = `SELECT * FROM posts WHERE id = ? AND (${this.getTenantIdCondition()})`;
        const params = this.bindTenantId([id]);
        return this.queryOne(PostSchema, sql, params);
    }

    async getPostsByTenant(): Promise<Post[]> {
        if (this.tenantId === null) {
            throw new Error('Super Admin cannot directly query tenant-specific posts without a tenantId.');
        }
        return this.query(PostSchema, 'SELECT * FROM posts WHERE tenant_id = ?', [this.tenantId]);
    }

    async getPostBySlug(slug: string): Promise<Post | null> {
        if (this.tenantId === null) {
            throw new Error('Cannot get post by slug without a specific tenantId.');
        }
        const sql = `SELECT * FROM posts WHERE slug = ? AND tenant_id = ?`;
        return this.queryOne(PostSchema, sql, [slug, this.tenantId]);
    }

    async createPost(data: Omit<Post, 'id' | 'tenant_id' | 'updated_at' | 'created_at' | 'version'>): Promise<D1Result> {
        if (this.tenantId === null) {
            throw new Error('Cannot create post without a specific tenantId.');
        }
        const id = crypto.randomUUID();
        const parsedData = PostSchema.parse({
            id,
            tenant_id: this.tenantId,
            created_at: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
            version: 0,
            ...data
        });
        const sql = `INSERT INTO posts (id, tenant_id, title, slug, content_md, frontmatter, status, last_published_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        return this.run(sql, [
            parsedData.id, parsedData.tenant_id, parsedData.title, parsedData.slug,
            parsedData.content_md, parsedData.frontmatter, parsedData.status,
            parsedData.last_published_at, parsedData.updated_at, parsedData.version
        ]);
    }

    async updatePost(
        id: string,
        data: Partial<Omit<Post, 'id' | 'tenant_id' | 'created_at' | 'updated_at' | 'version'>>, // Exclude auto-managed fields
        expectedVersion: number // For optimistic locking
    ): Promise<D1Result> {
        if (this.tenantId === null) {
            throw new Error('Cannot update post without a specific tenantId.');
        }

        // Construct update fields dynamically
        const fields: string[] = [];
        const params: any[] = [];
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                fields.push(`${key} = ?`);
                params.push((data as any)[key]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No fields provided for update.');
        }

        const sql = `
            UPDATE posts
            SET ${fields.join(', ')}, updated_at = ?, version = ?
            WHERE id = ? AND tenant_id = ? AND version = ?`;

        params.push(Math.floor(Date.now() / 1000)); // updated_at
        params.push(expectedVersion + 1); // new version
        params.push(id);
        params.push(this.tenantId);
        params.push(expectedVersion); // old version for optimistic locking

        const result = await this.run(sql, params);
        if (result.changes === 0) {
            throw new Error('Optimistic locking failed: Post was modified by another user or does not exist.');
        }
        return result;
    }


    // --- Deployments Table ---
    async getDeploymentById(id: string): Promise<Deployment | null> {
        const sql = `SELECT * FROM deployments WHERE id = ? AND (${this.getTenantIdCondition()})`;
        const params = this.bindTenantId([id]);
        return this.queryOne(DeploymentSchema, sql, params);
    }

    async createDeployment(data: Omit<Deployment, 'id' | 'tenant_id' | 'created_at'>): Promise<D1Result> {
        if (this.tenantId === null && !data.tenant_id) { // Allow Super Admin to create deployments for any tenant
             throw new Error('TenantId is required for deployment.');
        }
        const id = crypto.randomUUID();
        const finalTenantId = this.tenantId === null ? data.tenant_id : this.tenantId;

        const parsedData = DeploymentSchema.parse({
            id,
            tenant_id: finalTenantId,
            created_at: Math.floor(Date.now() / 1000),
            ...data
        });

        const sql = `INSERT INTO deployments (id, tenant_id, trigger_source, github_commit_sha, cf_deployment_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        return this.run(sql, [
            parsedData.id, parsedData.tenant_id, parsedData.trigger_source,
            parsedData.github_commit_sha, parsedData.cf_deployment_id,
            parsedData.status, parsedData.created_at
        ]);
    }
}

// Special client for Super Admin operations
export class SuperAdminD1Client extends D1Client {
    constructor(d1: D1Database) {
        super(d1, null); // tenantId is null for Super Admin
    }
}


// --- Updated getTenantByHostname for Middleware/Edge Functions ---
// The original getTenantByHostname in middleware does not have a tenantId context,
// so it needs to query directly.
export async function getTenantByHostnameEdge(db: D1Database, hostname: string): Promise<Tenant | null> {
    const d1 = db; // D1 binding passed directly from middleware context
    const stmt = d1.prepare('SELECT id, slug, custom_domain, status FROM tenants WHERE custom_domain = ?');
    const tenant = await stmt.bind(hostname).first<Tenant>();
    return tenant ? TenantSchema.parse(tenant) : null;
}
