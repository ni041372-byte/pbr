// src/app/admin/provision/page.tsx
import { getSession } from "@/lib/auth";
import { redirect } from 'next/navigation';
import ProvisionForm from './provision-form';

export default async function ProvisionPage() {
    const session = await getSession();

    // Protect this page: only users who are authenticated AND are super admins (tenant_id is null)
    // can access this page.
    if (!session?.user || session.user.tenant_id !== null) {
        redirect('/admin');
    }

    return (
        <div>
            <h1>Super Admin: Provision New Tenant</h1>
            <p>Use this form to create a new tenant, which will fork the template GitHub repository and prepare the Cloudflare custom hostname.</p>
            <ProvisionForm />
        </div>
    );
}
