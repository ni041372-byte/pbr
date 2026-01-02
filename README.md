# endpr - Enterprise Multi-Tenant Headless CMS

This project is a multi-tenant headless CMS built with Next.js and Cloudflare. It is designed for agencies to manage hundreds of client websites from a single instance.

## ✨ Core Features
.
*   **Multi-Tenant Architecture:** Each tenant (client) has its own isolated data and configuration, identified by hostname.
*   **Headless CMS:** Content is managed in a central admin panel and delivered via a Git-based workflow.
*   **Static Site Generation (SSG) for Performance:** Published content is served as a static site for maximum speed.
*   **Dynamic Admin Panel:** The CMS backend is a dynamic application for real-time content management.
*   **Cloudflare Integration:** Leverages Cloudflare D1 (database), R2 (storage), and Pages (hosting) for a serverless, edge-first architecture.

## 🚀 Getting Started

This guide will walk you through deploying the `endpr` project to Cloudflare Pages.

### Step 1: Fork and Clone the Repository

1.  **Fork this repository** to your own GitHub account.
2.  **Clone your forked repository** to your local machine.

### Step 2: Cloudflare Project Setup

1.  **Create a D1 Database:**
    *   In your Cloudflare dashboard, go to **Workers & Pages -> D1**.
    *   Click **Create database**.
    *   Name your database (e.g., `endpr_db`) and note its name.

2.  **Create an R2 Bucket:**
    *   In your Cloudflare dashboard, go to **R2**.
    *   Click **Create bucket**.
    *   Name your bucket (e.g., `endpr-assets`) and note its name.

### Step 3: Cloudflare Pages Deployment

1.  **Create a Pages Project:**
    *   In your Cloudflare dashboard, go to **Workers & Pages -> Create application -> Pages**.
    *   Select **Connect to Git**.
    *   Choose your forked GitHub repository (`endpr` or your renamed version).
    *   Click **Begin setup**.

2.  **Configure Build Settings:**
    *   **Project name:** Choose a name for your project.
    *   **Production branch:** Select `main`.
    *   **Framework preset:** Select **Next.js**.
    *   **Build command:** `npm run build` (This should be the default).
    *   **Build output directory:** `.next` (This should be the default).

3.  **Configure Environment Variables and Bindings:**
    *   This is the most critical step. Go to **Settings -> Functions -> Bindings**.
    *   **D1 Database Bindings:**
        *   Click **Add binding**.
        *   **Variable name:** `DB`
        *   **D1 database:** Select the D1 database you created (`endpr_db`).
    *   **R2 Bucket Bindings:**
        *   Click **Add binding**.
        *   **Variable name:** `R2_ASSETS`
        *   **R2 bucket:** Select the R2 bucket you created (`endpr-assets`).
    *   **Environment Variables (Secrets):**
        *   Go to **Settings -> Environment variables**.
        *   Click **Add variable** for each of the following (make sure to click "Encrypt" for secrets).
        *   `GITHUB_TOKEN`: Your GitHub Personal Access Token with `repo` scope.
        *   `R2_ENDPOINT`: Your R2 S3 API endpoint. You can find this in the R2 bucket settings (e.g., `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
        *   `R2_ACCESS_KEY_ID`: Your R2 API Access Key ID.
        *   `R2_SECRET_ACCESS_KEY`: Your R2 API Secret Access Key.

4.  **Save and Deploy:**
    *   Click **Save and Deploy**.
    *   Cloudflare Pages will now build and deploy your project.

### Step 4: Post-Deployment Setup

1.  **Run D1 Schema Migration:**
    *   After the first deployment, you need to apply the database schema.
    *   In your Cloudflare dashboard, go to **Workers & Pages -> D1 -> [Your Database] -> Console**.
    *   Copy the contents of `d1/schema.sql` from your repository and execute it in the D1 console.

2.  **Seed Initial Data (Optional but Recommended):**
    *   To get started quickly, you can manually insert the initial `tenant` and `user` data into your D1 database using the console.
    *   **Tenant:**
        ```sql
        INSERT INTO tenants (id, slug, custom_domain, github_repo, plan_tier, config_json, status)
        VALUES ('prod-tenant', 'prod-tenant', 'your-production-domain.com', 'your-github/repo', 'ENTERPRISE', '{}', 'ACTIVE');
        ```
        (Replace `your-production-domain.com` and `your-github/repo` with your actual values)
    *   **Super Admin:**
        ```sql
        INSERT INTO users (id, tenant_id, email, role)
        VALUES ('super-admin-user-prod', NULL, 'your-email@example.com', 'OWNER');
        ```
        (Replace `your-email@example.com` with your email)

## 🛠️ Local Development

While the primary workflow is deployment-based, you can still run the project locally.

1.  **Install Dependencies:** `npm install`
2.  **Configure Local D1:**
    *   `npx wrangler d1 execute endpr_db --local --file=d1/schema.sql`
3.  **Run the Dev Server:**
    *   Set the required environment variables (`GITHUB_TOKEN`, `R2_...`).
    *   `npx wrangler dev --local --experimental-local-pages`

This will start a local development server with live-reloading and access to your local D1 database.
