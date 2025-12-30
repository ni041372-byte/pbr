// src/types/db.ts
import { z } from 'zod';

// Helper for unixepoch timestamps
const zUnixEpoch = z.number().int().positive();

export const TenantSchema = z.object({
    id: z.string().uuid().or(z.literal('dev-tenant').or(z.literal('pending-tenant'))), // Allow specific test IDs
    slug: z.string().min(1),
    custom_domain: z.string().nullable(),
    github_repo: z.string().min(1),
    plan_tier: z.enum(['BASIC', 'ENTERPRISE']).default('BASIC'),
    config_json: z.string().nullable(),
    status: z.enum(['ACTIVE', 'PENDING_DNS']).default('ACTIVE'),
    created_at: zUnixEpoch.default(() => Math.floor(Date.now() / 1000)),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const UserSchema = z.object({
    id: z.string().uuid().or(z.literal('super-admin-user').or(z.literal('dev-tenant-user'))), // Allow specific test IDs
    tenant_id: z.string().uuid().nullable(), // Null for Super Admin
    email: z.string().email(),
    role: z.enum(['OWNER', 'EDITOR', 'VIEWER']).default('EDITOR'),
    created_at: zUnixEpoch.default(() => Math.floor(Date.now() / 1000)),
});

export type User = z.infer<typeof UserSchema>;

export const PostSchema = z.object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    title: z.string().min(1),
    slug: z.string().min(1),
    content_md: z.string().nullable(),
    frontmatter: z.string().nullable(), // JSON string
    status: z.enum(['DRAFT', 'PUBLISHING', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
    last_published_at: zUnixEpoch.nullable(),
    updated_at: zUnixEpoch.default(() => Math.floor(Date.now() / 1000)),
    version: z.number().int().default(0), // For Optimistic Locking
});

export type Post = z.infer<typeof PostSchema>;

export const DeploymentSchema = z.object({
    id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    trigger_source: z.string().nullable(), // e.g., 'MANUAL', 'SCHEDULE'
    github_commit_sha: z.string().nullable(),
    cf_deployment_id: z.string().nullable(),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILURE']),
    created_at: zUnixEpoch.default(() => Math.floor(Date.now() / 1000)),
});

export type Deployment = z.infer<typeof DeploymentSchema>;

// Combined schema for all tables
export const DBSchema = z.object({
    tenants: z.array(TenantSchema),
    users: z.array(UserSchema),
    posts: z.array(PostSchema),
    deployments: z.array(DeploymentSchema),
});

export type DB = z.infer<typeof DBSchema>;