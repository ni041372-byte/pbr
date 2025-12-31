// src/lib/next-auth-d1-adapter.ts
import { Adapter, AdapterUser } from "next-auth/adapters";
import { D1Client, SuperAdminD1Client } from "./d1";
import { User } from "@/types/db";

// The official D1 adapter uses a schema that is incompatible with our multi-tenant setup.
// This custom adapter maps the NextAuth user model to our existing D1 schema.
// Note: This adapter is designed for a JWT session strategy and does not implement session-related methods.
// It also only implements the methods required for a CredentialsProvider and basic user management.
// OAuth-specific methods (`linkAccount`, etc.) are not implemented.

const formatAdapterUser = (user: User | null): AdapterUser | null => {
    if (!user) return null;
    // The adapter needs `emailVerified` to be a Date or null. Our schema doesn't have it.
    return {
        ...user,
        id: user.id,
        email: user.email,
        emailVerified: null, 
    };
};

export function CustomD1Adapter(db: SuperAdminD1Client): Adapter {
  return {
    // We expect the `db` instance here to be a SuperAdminD1Client to operate across tenants if needed.
    
    async createUser(data) {
        // NextAuth user data doesn't include tenant_id or role, so we set defaults.
        // A real sign-up flow would need to handle this more gracefully.
        await db.createUser({
            email: data.email,
            role: 'EDITOR', // Default role
            tenant_id: null, // Or assign to a default tenant, depending on logic
            // name and image are not in our custom schema, so we ignore them.
        });
        const newUser = await db.getUserByEmail(data.email);
        return formatAdapterUser(newUser)!; // Assert non-null as we just created it.
    },

    async getUser(id) {
        const user = await db.getUserById(id);
        return formatAdapterUser(user);
    },

    async getUserByEmail(email) {
        // The D1Client needs to be a SuperAdmin client to search across all tenants.
        const user = await db.getUserByEmail(email);
        return formatAdapterUser(user);
    },

    async updateUser(user) {
        if (!user.id) {
            throw new Error("User ID is required to update.");
        }
        await db.updateUser(user.id, {
            // Our schema doesn't have name or image, but you could add them.
            // email: user.email,
        });
        const updatedUser = await db.getUserById(user.id);
        return formatAdapterUser(updatedUser)!;
    },

    async deleteUser(userId) {
        await db.deleteUser(userId);
    },

    // --- Methods below are not implemented for this project's scope (JWT + Credentials only) ---

    async getUserByAccount({ providerAccountId, provider }) {
      return null;
    },
    async linkAccount(account) {
      // Not implemented
    },
    async unlinkAccount({ providerAccountId, provider }) {
      // Not implemented
    },
    async createSession({ sessionToken, userId, expires }) {
      throw new Error("Database sessions are not used. Use JWT strategy.");
    },
    async getSessionAndUser(sessionToken) {
      return null;
    },
    async updateSession({ sessionToken }) {
      throw new Error("Database sessions are not used. Use JWT strategy.");
    },
    async deleteSession(sessionToken) {
      // Not implemented
    },
    async createVerificationToken(verificationToken) {
      // Not implemented for email provider
      return;
    },
    async useVerificationToken({ identifier, token }) {
      // Not implemented for email provider
      return null;
    },
  };
}