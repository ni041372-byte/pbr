// src/actions/provision.ts
'use server';

import { getD1Binding, SuperAdminD1Client } from '../lib/d1';
import { getSession } from '../lib/auth';
// import { fork_repository } from 'github'; // This was a build error. Tool calls happen at runtime.
import { randomUUID } from 'crypto';

type ProvisionResult = {
    success: boolean;
    error?: string;
    tenantId?: string;
    dnsRecords?: { type: string; name: string; value: string };
};

interface ProvisionParams {
    customerName: string;
    requestedDomain: string;
    plan: 'BASIC' | 'ENTERPRISE';
}

function slugify(text: string): string {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

export async function provisionNewTenant(params: ProvisionParams): Promise<ProvisionResult> {
    const session = await getSession();
    // In a real app, we'd check for a specific 'super-admin' role
    if (!session?.user || session.user.tenant_id !== null) {
        return { success: false, error: 'Unauthorized. Only Super Admins can provision new tenants.' };
    }

    const { customerName, requestedDomain, plan } = params;
    
    const db = getD1Binding();
    const d1Admin = new SuperAdminD1Client(db);

    const slug = slugify(customerName);
    const newTenantId = `tnt_${randomUUID()}`;
    const newRepoName = `endpr-tenant-${slug}`;
    const githubOrg = process.env.GITHUB_ORG!; // Must be set in environment
    const templateRepo = process.env.GITHUB_TEMPLATE_REPO!; // e.g. 'endpr-template'
    
    try {
        // 1. Create new GitHub repo by forking a template
        console.log(`Forking ${githubOrg}/${templateRepo} into ${githubOrg}/${newRepoName}`);
        // const forkResult = await fork_repository({
        //     owner: githubOrg,
        //     repo: templateRepo,
        //     organization: githubOrg,
        //     name: newRepoName,
        // });

        // This is a simplified assumption. The `fork_repository` tool response
        // would need to be checked for the new repo's details.
        // const newRepoFullName = forkResult.full_name;
        const newRepoFullName = `${githubOrg}/${newRepoName}`; // Placeholder

        // 2. Configure Cloudflare for SaaS custom hostname (Placeholder)
        console.log(`TODO: Call Cloudflare API to add custom hostname: ${requestedDomain}`);
        const dnsVerificationValue = `placeholder-verification-value-for-${requestedDomain}`;

        // 3. Create the new tenant record in D1
        const newTenant = await d1Admin.createTenant({
            slug: slug,
            custom_domain: requestedDomain,
            github_repo: newRepoFullName,
            plan_tier: plan,
            config_json: JSON.stringify({}),
            status: 'PENDING_DNS',
        });

        return { 
            success: true,
            tenantId: newTenant.id,
            dnsRecords: {
                type: 'TXT',
                name: '_cf-custom-hostname.' + requestedDomain,
                value: dnsVerificationValue,
            }
        };

    } catch (error: any) {
        console.error(`[Action] Failed to provision tenant for: ${customerName}`, error);
        // TODO: Implement rollback logic (e.g., delete forked GitHub repo)
        return { success: false, error: error.message };
    }
}