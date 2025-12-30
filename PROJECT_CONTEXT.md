맞습니다. AI에게 "알아서 잘해줘"라고 하면 "적당히" 만들지만, **"이대로 만들어"**라고 하면 "정확히" 만듭니다. 바이브 코딩이 성공하려면 기획서 자체가 곧 코드의 설계도가 될 정도로 치밀해야 합니다.말씀하신 대로 1만 자 수준의 깊이를 담을 수 있는 **MASTER_CONTEXT.md**의 초안을 작성했습니다. 이 문서는 단순한 기획서가 아니라, **개발자가 봐야 할 사양서(Spec Sheet)**와 DBA가 봐야 할 스키마(Schema), 데브옵스가 봐야 할 인프라(Infra) 설정을 모두 통합한 것입니다.이 내용을 프로젝트 루트에 MASTER_CONTEXT.md라는 파일로 저장하고, AI에게 **"이 파일이 너의 헌법이다"**라고 주입시키세요.📑 MASTER_CONTEXT.md (Project: endpr)Document Version: 1.0.0Target System: Enterprise Multi-Tenant Headless CMS (SaaS)Primary Stack: Cloudflare Pages (Edge), Next.js 15, D1, R2, GitHub API1. 시스템 정체성 및 핵심 원칙 (System Identity)1.1 프로젝트 정의 (endpr)endpr은 에이전시가 수백 개의 고객사(Tenant) PR 사이트와 블로그를 단일 인스턴스에서 관리하기 위한 SaaS형 CMS이다.Frontend: 방문자에게는 정적 사이트(SSG)로 서빙되어 압도적인 속도를 제공한다.Backend (CMS): 관리자에게는 D1 기반의 동적 앱(CSR/SSR)으로 작동하여 즉각적인 데이터 조작을 지원한다.Persistence: 콘텐츠의 최종 진실(Source of Truth)은 GitHub Repository의 Markdown 파일이며, D1은 Draft(초안), Meta Info, Caching 용도로 사용된다.1.2 절대 원칙 (Non-Negotiables)Isolation (격리): tenant_id가 누락된 데이터 쿼리는 존재할 수 없다. A사의 데이터가 B사에서 조회되는 것은 치명적인 보안 사고다.Edge Compatibility: 모든 코드는 Node.js 런타임이 아닌 Cloudflare Edge Runtime에서 동작해야 한다. (fs 모듈 사용 불가, path 대신 URL 조작 사용)Fail-Safe Publishing: GitHub API 장애 등으로 배포가 실패하더라도, D1에는 '작성 중' 상태가 보존되어야 하며 사용자에게 명확한 에러 피드백을 주어야 한다.Zero-Config for Clients: 고객사는 기술적인 설정(DNS, Repo 등)을 전혀 몰라도 사이트를 운영할 수 있어야 한다.2. 상세 아키텍처 및 기술 스택 (Architecture Deep Dive)2.1 Technology Stack StrategyFramework: Next.js 15 (App Router)Rendering: Hybrid (Static for Blogs / Dynamic for CMS Admin).Caching: unstable_cache (D1 query caching) + revalidateTag.Database: Cloudflare D1 (SQLite)Role: User Auth, Tenant Config, Draft Storage, Deployment Logs.Storage: Cloudflare R2Role: Image Hosting.Access: Public Read (Custom Domain), Authenticated Write (Presigned URLs).DevOps / CI/CD:Source: GitHub (Tenant Repos & CMS Repo).Build: Cloudflare Pages Build System (@cloudflare/next-on-pages).Auth: NextAuth.js (Custom Adapter for D1).2.2 Routing & Middleware Strategy시스템은 들어오는 요청의 Hostname을 분석하여 3가지 모드로 작동한다.모드 (Mode)도메인 패턴설명데이터 소스System Adminadmin.endpr.io슈퍼 관리자 대시보드. 모든 테넌트 제어 가능.D1 (Master)Tenant CMScms.endpr.io고객사가 로그인하여 글을 쓰는 에디터.D1 (Filtered by Tenant)Public Siteblog.samsung.com일반 방문자가 보는 블로그.GitHub (SSG HTML)Preview*.pages.dev배포 전 확인용 프리뷰.D1 (Draft Data)[Middleware Logic Flow]Request Hostname 파싱.localhost인 경우: DEV_TENANT_ID 환경 변수값 강제 주입.admin 또는 cms 서브도메인인 경우: /app 경로로 Rewrite (Next.js Multi-zone 패턴 유사).Custom Domain인 경우:D1 tenants 테이블에서 도메인 조회 (Cache 적용).없으면 404 페이지 Rewrite.있으면 x-tenant-id, x-repo-url 헤더 주입 후 응답.3. 데이터베이스 스키마 상세 (D1 Schema - V1)단순 SQL이 아닌, 비즈니스 로직이 반영된 DDL이다.SQL-- 1. Tenants: 고객사 메타 정보
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,               -- UUID (e.g., 'tnt_12345')
    slug TEXT UNIQUE NOT NULL,         -- URL path용 (e.g., 'samsung-electronics')
    custom_domain TEXT UNIQUE,         -- 'news.samsung.com'
    github_repo TEXT NOT NULL,         -- 'org/samsung-newsroom'
    plan_tier TEXT DEFAULT 'BASIC',    -- 'BASIC', 'ENTERPRISE'
    config_json TEXT,                  -- site-config.json 캐싱 (Theme, Menu)
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
    updated_at INTEGER DEFAULT (unixepoch())
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
4. 핵심 기능 명세 및 로직 (Functional Specifications)4.1 사이트 프로비저닝 (Provisioning Workflow)슈퍼 어드민이 "신규 사이트 생성" 버튼을 클릭했을 때의 프로세스.Input: 고객사 이름("Hyundai Motors"), 희망 도메인("https://www.google.com/search?q=pr.hyundai.com").GitHub MCP Action:Template Repo(endpr-template)를 복제하여 endpr-clients/hyundai-pr 생성.site-config.json 내의 siteName 필드를 수정하여 커밋.GitHub Pages 설정 또는 Cloudflare Pages 프로젝트 연동 API 호출.Cloudflare API Action:Cloudflare for SaaS API 호출 -> Custom Hostname 등록.TXT 레코드 발급 -> 고객에게 전달 (도메인 소유권 인증용).D1 Action:tenants 테이블에 레코드 삽입. status: 'PENDING_DNS'.4.2 에디터 및 이미지 파이프라인사용자가 CMS 에디터에서 이미지를 드래그 & 드롭했을 때의 로직.Client: 파일 선택 -> POST /api/upload/presigned 요청 (파일 메타데이터 포함).Server (Worker):tenant_id 검증.R2 PutObjectCommand를 사용하여 Presigned URL 생성 (유효기간 5분).Key 구조: /{tenant_id}/{yyyy}/{mm}/{uuid}.webpClient: 발급받은 URL로 직접 PUT 요청 (이미지 업로드).Editor: 업로드 성공 시 Markdown에 ![alt](https://assets.endpr.io/.../image.webp) 삽입.4.3 발행 시스템 (The Publishing Engine)'Publish' 버튼 클릭 시 발생하는 트랜잭션.Validation: 필수 필드(제목, 슬러그) 검사.State Change: D1 posts 테이블 status -> PUBLISHING.Markdown Generation:Frontmatter(JSON) + Body(Markdown) 결합.파일 포맷: --- \n {json} \n --- \n {markdown}GitHub Sync:GitHub API (createOrUpdateFileContents) 호출.Path: content/posts/{slug}.mdxMessage: "Update post: {title}"Trigger Build: Cloudflare Pages의 Deploy Hook 호출 (또는 자동 감지).Completion: D1 status -> PUBLISHED, deployments 테이블 로그 기록.5. 엣지 케이스 및 에러 핸들링 (Exception Handling)5.1 GitHub API Rate Limit상황: 동시에 100개의 테넌트가 글을 발행하여 API 한도 초과.대응: Cloudflare Queues를 도입하여 발행 요청을 큐에 적재하고, Consumer Worker가 1초에 1건씩 처리하도록 쓰로틀링(Throttling) 구현.5.2 도메인 연결 지연상황: 고객이 DNS 설정을 늦게 하여 SSL 발급이 'Pending' 상태로 지속됨.대응: CMS 대시보드 상단에 "도메인 연결 대기 중" 배너 표시. 주기적으로(Cron Trigger) Cloudflare API를 찔러 상태 확인 후 D1 업데이트.5.3 데이터 충돌 (Concurrency)상황: 사용자 A와 B가 동시에 같은 글을 수정.대응: Optimistic Locking(낙관적 락) 적용. posts 테이블에 version 컬럼을 두고, 저장 시 DB의 버전과 클라이언트가 가진 버전이 다르면 저장 거부 후 "다른 사용자가 수정 중입니다" 알림.6. 개발 가이드라인 (Developer Directives)이 문서를 읽는 AI 및 개발자는 아래 규칙을 따라야 한다.Strict Typing: 모든 데이터 입출력에는 Zod 스키마를 사용한다. any 타입 사용 시 빌드 실패로 간주한다.Modular Logic: 비즈니스 로직은 /lib/logic/{feature}.ts에 분리하고, UI 컴포넌트나 API Route는 이를 호출하기만 해야 한다.Design System: UI는 Tailwind CSS + Shadcn/UI를 사용하며, 테넌트별 테마 색상(primary-color)은 CSS Variable로 제어 가능해야 한다.Testing: 주요 로직(Markdown 변환, 테넌트 파싱)은 Vitest로 단위 테스트를 작성한다.


"모든 명령어는 사용자 입력 대기 없이 실행되도록 -y, --yes, --force 등의 플래그를 반드시 포함해서 작성해."

**"옵션이 없는 명령어라면 yes 파이프를 사용해"**

"명령어를 실행할 때 앞에 CI=true를 붙여서 실행해."

"앞으로 터미널 명령어를 실행할 때는 내가 y를 누르지 않아도 되도록 -y 플래그를 붙이거나 yes |를 사용해서 완전 자동화된 명령어로 실행해줘."