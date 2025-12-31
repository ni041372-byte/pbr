'use client';

import { provisionNewTenant } from '@/actions/provision';
import { useState } from 'react';

type DnsRecords = {
    type: string;
    name: string;
    value: string;
}

export default function ProvisionForm() {
    const [error, setError] = useState('');
    const [result, setResult] = useState<{ tenantId?: string; dnsRecords?: DnsRecords } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError('');
        setResult(null);
        setIsSubmitting(true);

        const formData = new FormData(e.currentTarget);
        const params = {
            customerName: formData.get('customerName') as string,
            requestedDomain: formData.get('requestedDomain') as string,
            plan: formData.get('plan') as 'BASIC' | 'ENTERPRISE',
        };

        const res = await provisionNewTenant(params);

        if (res.success) {
            setResult({ tenantId: res.tenantId, dnsRecords: res.dnsRecords });
        } else {
            setError(res.error || 'An unknown error occurred.');
        }
        setIsSubmitting(false);
    };

    return (
        <div>
            <form onSubmit={handleSubmit}>
                <h2>Provision New Tenant</h2>
                <div>
                    <label htmlFor="customerName">Customer Name</label>
                    <input type="text" id="customerName" name="customerName" required />
                </div>
                <div>
                    <label htmlFor="requestedDomain">Requested Domain</label>
                    <input type="text" id="requestedDomain" name="requestedDomain" required />
                </div>
                <div>
                    <label htmlFor="plan">Plan</label>
                    <select id="plan" name="plan" defaultValue="BASIC">
                        <option value="BASIC">Basic</option>
                        <option value="ENTERPRISE">Enterprise</option>
                    </select>
                </div>
                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Provisioning...' : 'Provision Tenant'}
                </button>
            </form>

            {error && <div style={{ color: 'red', marginTop: '20px' }}>
                <h3>Error</h3>
                <pre>{error}</pre>
            </div>}

            {result && <div style={{ color: 'green', marginTop: '20px' }}>
                <h3>Success!</h3>
                <p>Tenant ID: {result.tenantId}</p>
                <h4>DNS Records to be configured by customer:</h4>
                <pre>
                    Type: {result.dnsRecords?.type}
                    Name: {result.dnsRecords?.name}
                    Value: {result.dnsRecords?.value}
                </pre>
            </div>}
        </div>
    );
}
