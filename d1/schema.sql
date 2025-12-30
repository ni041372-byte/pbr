CREATE TABLE tenants (
    id TEXT PRIMARY KEY,               -- UUID (e.g., 'tnt_12345')
    slug TEXT UNIQUE NOT NULL,         -- URL path용 (e.g., 'samsung-electronics')
    custom_domain TEXT UNIQUE,         -- 'news.samsung.com'
    github_repo TEXT NOT NULL,         -- 'org/samsung-newsroom'
    plan_tier TEXT DEFAULT 'BASIC',    -- 'BASIC', 'ENTERPRISE'
    config_json TEXT,                  -- site-config.json 캐싱 (Theme, Menu)
    status TEXT CHECK(status IN ('ACTIVE', 'PENDING_DNS')) DEFAULT 'ACTIVE',
    created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_tenants_domain ON tenants(custom_domain);

-- 2. Users: 사용자 (RBAC)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id), -- NULL이면 Super Admin
    email TEXT NOT NULL,
    role TEXT CHECK(role IN ('OWNER', 'EDITOR', 'VIEWER')) DEFAULT 'EDITOR',
    created_at INTEGER DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_users_email_tenant ON users(email, tenant_id);

-- 3. Posts: 글 관리 (Draft & History)
CREATE TABLE posts (
    id TEXT PRIMARY KEY,               -- UUID
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,                -- 'my-first-post' (Tenant 내 유일)
    content_md TEXT,                   -- Markdown 본문 (Draft 상태)
    frontmatter TEXT,                  -- JSON string (tags, categories, date)
    status TEXT CHECK(status IN ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'ARCHIVED')) DEFAULT 'DRAFT',
    last_published_at INTEGER,         -- 마지막으로 GitHub에 Push된 시간
    updated_at INTEGER DEFAULT (unixepoch()),
    version INTEGER DEFAULT 0          -- Added for Optimistic Locking
);
CREATE INDEX idx_posts_tenant_status ON posts(tenant_id, status);

-- 4. Deployments: 배포 로그
CREATE TABLE deployments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    trigger_source TEXT,               -- 'MANUAL', 'SCHEDULE'
    github_commit_sha TEXT,
    cf_deployment_id TEXT,
    status TEXT CHECK(status IN ('PENDING', 'SUCCESS', 'FAILURE')),
    created_at INTEGER DEFAULT (unixepoch())
);