CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    custom_domain TEXT UNIQUE,
    github_repo TEXT NOT NULL,
    plan_tier TEXT DEFAULT 'BASIC',
    config_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_tenants_domain ON tenants(custom_domain);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id),
    email TEXT NOT NULL,
    role TEXT CHECK(role IN ('OWNER', 'EDITOR', 'VIEWER')) DEFAULT 'EDITOR',
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_users_email_tenant ON users(email, tenant_id);

CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    content_md TEXT,
    frontmatter TEXT,
    status TEXT CHECK(status IN ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'ARCHIVED')) DEFAULT 'DRAFT',
    version INTEGER DEFAULT 0,
    last_published_at INTEGER,
    updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_posts_tenant_status ON posts(tenant_id, status);

CREATE TABLE deployments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    trigger_source TEXT,
    github_commit_sha TEXT,
    cf_deployment_id TEXT,
    status TEXT CHECK(status IN ('PENDING', 'SUCCESS', 'FAILURE')),
    created_at INTEGER DEFAULT (unixepoch())
);
