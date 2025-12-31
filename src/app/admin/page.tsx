// src/app/admin/page.tsx
import { getSession } from "@/lib/auth";
import { D1Client, getD1Binding } from "@/lib/d1";
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PostActions } from "./post-actions";

export default async function AdminDashboard() {
    const session = await getSession();

    if (!session?.user?.id) {
        redirect('/login');
    }

    const tenantId = session.user.tenant_id;
    if (!tenantId) {
        return (
            <div style={{ padding: '2rem' }}>
                <h1>Admin Dashboard</h1>
                <p>Welcome, Super Admin. Tenant-specific content is not shown on this dashboard.</p>
                <Link href="/admin/provision"><button>Provision New Tenant</button></Link>
            </div>
        );
    }
    
    const db = getD1Binding();
    const d1Client = new D1Client(db, tenantId);
    
    const [tenant, posts] = await Promise.all([
        d1Client.getTenantById(tenantId),
        d1Client.getPostsByTenant()
    ]);

    return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
            {tenant?.status === 'PENDING_DNS' && (
                <div style={{ backgroundColor: '#fffbe6', border: '1px solid #ffe58f', padding: '1rem', marginBottom: '1rem', borderRadius: '8px' }}>
                    <strong>Action Required:</strong> Your domain is not yet connected. Please configure your DNS records.
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>Admin Dashboard</h1>
                <span>Welcome, {session.user.email}</span>
            </div>
            <hr />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0' }}>
                <h2>Posts</h2>
                <Link href="/admin/posts/new">
                    <button style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>Create New Post</button>
                </Link>
            </div>
            
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f0f0f0' }}>
                        <th style={{ padding: '0.5rem', textAlign: 'left' }}>Title</th>
                        <th style={{ padding: '0.5rem', textAlign: 'left' }}>Status</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {posts.map(post => (
                        <tr key={post.id} style={{ borderBottom: '1px solid #ddd' }}>
                            <td style={{ padding: '0.5rem' }}>{post.title}</td>
                            <td style={{ padding: '0.5rem' }}>{post.status}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                <PostActions post={{ id: post.id, tenant_id: post.tenant_id }} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {posts.length === 0 && <p style={{ marginTop: '1rem' }}>No posts found.</p>}
        </div>
    );
}
