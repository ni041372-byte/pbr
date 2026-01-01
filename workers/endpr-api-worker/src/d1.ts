// workers/endpr-api-worker/src/d1.ts
import type { D1Database, D1Result } from '@cloudflare/workers-types';
import { z } from 'zod';
import { Tenant, TenantSchema, User, UserSchema, Post, PostSchema, Deployment, DeploymentSchema } from './types';

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

// Tenant-aware D1 client for Worker
export class D1Client extends BaseD1Client {
    private tenantId: string | null;

    constructor(d1: D1Database, tenantId: string | null = null) {
        super(d1);
        this.tenantId = tenantId;
    }

    // --- Reads (no caching in worker version) ---
    async getTenantById(id: string): Promise<Tenant | null> {
        return this.queryOne(TenantSchema, 'SELECT * FROM tenants WHERE id = ?', [id]);
    }

    async getPostById(id: string): Promise<Post | null> {
        if (!this.tenantId) return null;
        const sql = `SELECT * FROM posts WHERE id = ? AND tenant_id = ?`;
        return this.queryOne(PostSchema, sql, [id, this.tenantId]);
    }

    // --- Writes ---
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

        // Return the freshly updated post
        const updatedPost = await this.getPostById(id);
        if (!updatedPost) throw new Error('Failed to retrieve post after update.');

        return updatedPost;
    }
    
    async createDeployment(data: Omit<Deployment, 'id' | 'created_at'>): Promise<Deployment> {
        const id = crypto.randomUUID();
        const finalTenantId = this.tenantId ?? data.tenant_id;
        if(!finalTenantId) throw new Error('TenantId is required for deployment.');

        const newDeployment = DeploymentSchema.parse({ 
            id, 
            tenant_id: finalTenantId,
            created_at: Math.floor(Date.now() / 1000),
            ...data
        });

        await this.run(`INSERT INTO deployments (id, tenant_id, trigger_source, github_commit_sha, cf_deployment_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newDeployment.id, newDeployment.tenant_id, newDeployment.trigger_source, newDeployment.github_commit_sha, newDeployment.cf_deployment_id, newDeployment.status, newDeployment.created_at]);

        return newDeployment;
    }
}
