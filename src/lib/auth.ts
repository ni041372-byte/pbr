// src/lib/auth.ts
import { getServerSession } from "next-auth/next"
import { handler } from "@/app/api/auth/[...nextauth]/route"
import { D1Client } from "./d1";

/**
 * Retrieves the current session from the server-side.
 * This is the new source of truth for authentication, replacing the old mock function.
 */
export const getSession = async () => {
    return await getServerSession(handler);
}

/**
 * Retrieves the tenantId for the currently authenticated user.
 * It's a convenience function to be used in Server Actions and Components.
 */
export const getTenantId = async (db: D1Client): Promise<string | null> => {
    const session = await getSession();

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