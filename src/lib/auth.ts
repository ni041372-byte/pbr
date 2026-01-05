// src/lib/auth.ts
import { getServerSession } from "next-auth/next"
import { buildAuthOptions } from "@/auth.config";
import { D1Client, getD1Binding, SuperAdminD1Client } from "@/lib/d1";
import { D1Database } from "@cloudflare/workers-types";

// This new getSession requires the env to be passed in from the runtime context.
export const getSession = async (env: { DB: D1Database }) => {
    const db = getD1Binding(env);
    const d1Client = new SuperAdminD1Client(db);
    const authOptions = buildAuthOptions(d1Client);
    return await getServerSession(authOptions);
}

/**
 * Retrieves the tenantId for the currently authenticated user.
 * It's a convenience function to be used in Server Actions and Components.
 */
export const getTenantId = async (db: D1Client, env: { DB: D1Database }): Promise<string | null> => {
    const session = await getSession(env);

    if (!session?.user?.email) {
        // Not authenticated
        return null;
    }
    
    // In a real multi-tenant app, the user's tenantId would be part of the session
    // or fetched from the DB based on their user ID/email.
    const user = await db.getUserByEmail(session.user.email);
    
    // For now, we assume the user object in the DB has a tenant_id.
    // If the user is a super-admin, their tenant_id might be null.
    return user?.tenant_id ?? null;
}