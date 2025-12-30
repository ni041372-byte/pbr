# EXECUTION_PLAN (v1.1 - Architect's Review 반영)

🟢 **Phase 1: 인프라 및 데이터베이스 구축 (Foundation)**
**[Task 1.1] D1 데이터베이스 초기화**
-   **목표:** D1에 tenants, users, posts, deployments 테이블 생성 및 필수 초기 데이터 삽입.
-   **참고 문서:** MASTER_CONTEXT.md > 3. 데이터베이스 스키마 상세, 5.3 데이터 충돌
-   **사용 MCP:** `cloudflare-bindings`
-   **지시 사항:**
    1.  MASTER_CONTEXT.md의 스키마를 기반으로 `d1/schema.sql` 파일을 작성한다.
        -   **(보완)** `posts` 테이블에 `version INTEGER DEFAULT 0` 컬럼을 추가하여 Optimistic Locking을 대비한다.
    2.  Cloudflare MCP를 사용하여 로컬 D1 데이터베이스에 스키마를 적용한다 (`wrangler d1 execute`).
    3.  초기 데이터 삽입:
        -   `tenants` 테이블에 테스트용 데이터 삽입 (`id: 'dev-tenant'`, `custom_domain: 'localhost'`).
        -   **(보완)** `users` 테이블에 시스템 전체를 관리할 `Super Admin` 계정을 삽입한다 (`tenant_id`는 `NULL`로 설정).
-   **검증:**
    -   `SELECT * FROM tenants WHERE id='dev-tenant'` 쿼리 결과 확인.
    -   `SELECT * FROM users WHERE tenant_id IS NULL` 쿼리 결과 확인.

**[Task 1.2] 프로젝트 구조 및 공통 유틸리티 설정**
-   **목표:** 테넌트 격리를 위한 폴더 구조 및 Type-safe D1 클라이언트 래퍼 생성.
-   **참고 문서:** MASTER_CONTEXT.md > 2.1 기술 스택 전략, 6. 개발 가이드라인
-   **사용 MCP:** `file-system` (기본)
-   **지시 사항:**
    1.  `src/lib/d1.ts`를 생성한다.
    2.  모든 쿼리에 `tenant_id`를 강제하는 Type-safe D1 쿼리 헬퍼 함수들을 작성한다.
        -   **(강화)** 이 래퍼는 `Super Admin`의 `tenant_id IS NULL` 케이스와 `posts` 테이블의 `version` 컬럼 업데이트 로직을 처리할 수 있도록 확장성 있게 설계한다.
    3.  `src/types/db.ts`에 Zod 스키마를 사용하여 DB 모델 타입을 정의한다.

---

🔵 **Phase 2: 코어 로직 & 라우팅 (The Brain)**
**[Task 2.1] 멀티 테넌트 미들웨어 구현**
-   **목표:** 도메인에 따라 테넌트를 식별하고, 상태에 따라 적절히 요청을 분기.
-   **참고 문서:** MASTER_CONTEXT.md > 2.2 라우팅 & 미들웨어 전략, 5.2 도메인 연결 지연
-   **사용 MCP:** `sequential-thinking`
-   **지시 사항:**
    1.  `Sequential Thinking`을 사용하여 라우팅 시나리오(Localhost, Admin, Preview, Custom Domain)를 분석한다.
    2.  `src/middleware.ts`를 작성한다.
    3.  요청 Hostname으로 테넌트를 식별하고 `x-tenant-id` 헤더에 주입한다.
    4.  **(보완)** 식별된 테넌트의 `status`를 조회하여, `PENDING_DNS` 등 비활성 상태일 경우, 특정 안내 페이지(예: `/connect-domain`)로 리다이렉트하는 로직을 추가한다.
-   **검증:** `curl` 명령어로 각 도메인 시나리오별 응답 헤더와 리다이렉트 여부 확인.

**[Task 2.2] 테넌트 설정(Config) 로더 구현**
-   **목표:** 테넌트별 `site-config.json`을 D1에서 캐시하여 로드.
-   **참고 문서:** MASTER_CONTEXT.md > 3. 데이터베이스 스키마 (tenants 테이블)
-   **사용 MCP:** `cloudflare-bindings`
-   **지시 사항:**
    1.  `src/lib/tenant-config.ts` 함수를 작성한다 (캐싱 적용 필수: `unstable_cache`).
    2.  D1의 `config_json` 컬럼을 파싱하여 테마, 메뉴 등을 반환한다.
        -   **(강화)** `config_json`이 비어있거나 파싱에 실패할 경우를 대비한 기본(fallback) 설정값을 반환하는 로직을 포함한다.

---

🟠 **Phase 3: 콘텐츠 파이프라인 (Operations)**
**[Task 3.1] GitHub 연동 퍼블리싱 액션**
-   **목표:** '발행' 시 D1 데이터를 GitHub에 Push하고, 모든 과정을 안정적으로 처리.
-   **참고 문서:** MASTER_CONTEXT.md > 1.2 절대 원칙 (Fail-Safe), 4.3 발행 시스템, 5.1 API Rate Limit
-   **사용 MCP:** `github`, `sequential-thinking`
-   **지시 사항:**
    1.  Server Action: `publishPost(postId)`를 구현한다.
    2.  **(보완) 실패 복원력 설계:**
        -   `try-catch-finally` 구조로 API 실패를 처리한다.
        -   `posts.status`를 `PUBLISHING`으로 변경 -> GitHub API 호출 -> 실패 시 `DRAFT`로 롤백.
        -   성공/실패 여부와 관계없이 `deployments` 테이블에 로그를 기록한다 (`SUCCESS` or `FAILURE`).
    3.  GitHub MCP를 사용하여 `content/posts/{slug}.mdx` 파일을 생성/수정한다.
    4.  **(고려) 확장성:** 이 액션은 직접 GitHub API를 호출하는 대신, `Cloudflare Queues`에 발행 요청을 적재하는 방식으로 리팩토링할 수 있음을 주석으로 명시한다.
-   **검증:** 테스트 포스트 발행 성공 및 실패 시나리오를 모두 테스트하고, `deployments` 테이블의 로그를 확인.

**[Task 3.2] R2 이미지 업로드 파이프라인**
-   **목표:** Presigned URL을 통한 안전하고 효율적인 이미지 업로드 구현.
-   **참고 문서:** MASTER_CONTEXT.md > 4.2 에디터 및 이미지 파이프라인
-   **사용 MCP:** `cloudflare-bindings`
-   **지시 사항:**
    1.  API Route: `/api/upload/presigned`를 작성한다.
    2.  R2 Bucket(`endpr-assets`)에 대한 `PutObject` 권한이 있는 Presigned URL을 생성한다.
    3.  파일 키(Key)에 반드시 `tenant_id`가 포함되도록 강제한다.
    4.  **(강화)** 업로드된 이미지는 가급적 `webp` 포맷으로 변환하는 것을 권장. (예: `Cloudflare Images` Variants 또는 클라이언트 사이드 변환)

---

🔴 **Phase 4: 프로비저닝 자동화 (Expansion)**
**[Task 4.1] 신규 테넌트 프로비저닝**
-   **목표:** 버튼 클릭으로 GitHub Repo 생성, D1 등록, 도메인 연결까지 자동화.
-   **참고 문서:** MASTER_CONTEXT.md > 4.1 사이트 프로비저닝
-   **사용 MCP:** `github`, `cloudflare-bindings`
-   **지시 사항:**
    1.  **(보완) 보안:** GitHub API 토큰은 Cloudflare Worker Secret으로 안전하게 관리한다.
    2.  GitHub MCP의 `create_repository` (from template) 기능을 활용한다.
    3.  Cloudflare for SaaS API로 Custom Hostname을 등록한다.
    4.  **(보완) 사용자 경험:** 발급된 DNS 인증용 TXT 레코드를 사용자 대시보드에 명확히 안내하고, 복사하기 기능을 제공한다.
    5.  모든 과정이 성공하면 D1 `tenants` 테이블에 새 레코드를 `commit`한다.
