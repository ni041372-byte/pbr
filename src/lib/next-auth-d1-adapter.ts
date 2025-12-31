// src/lib/next-auth-d1-adapter.ts
import { Adapter } from "next-auth/adapters";
import { D1Client } from "./d1";

/**
 * This is a custom NextAuth.js adapter for Cloudflare D1.
 * It's designed to work with the existing custom 'users' table schema,
 * which includes multi-tenant support.
 */
export function CustomD1Adapter(db: D1Client): Adapter {
  return {
    async createUser(user) {
      // TODO: Implement
      console.log("ADAPTER: createUser", user);
      throw new Error("Adapter method not implemented: createUser");
    },
    async getUser(id) {
      // TODO: Implement
      console.log("ADAPTER: getUser", id);
      return null;
    },
    async getUserByEmail(email) {
      console.log("ADAPTER: getUserByEmail", email);
      // For credential-based login, we need to find the user.
      // This assumes a Super Admin is logging in for now, as tenant context is not available here.
      // A more robust solution is needed for tenant-specific logins.
      const user = await db.getUserByEmail(email);
      if (!user) return null;
      
      // The adapter expects a specific return format.
      return {
        ...user,
        id: user.id,
        email: user.email,
        emailVerified: null, // D1 schema doesn't have this
      };
    },
    async getUserByAccount({ providerAccountId, provider }) {
      // TODO: Implement for OAuth providers
      console.log("ADAPTER: getUserByAccount", providerAccountId, provider);
      return null;
    },
    async updateUser(user) {
      // TODO: Implement
      console.log("ADAPTER: updateUser", user);
      throw new Error("Adapter method not implemented: updateUser");
    },
    async deleteUser(userId) {
      // TODO: Implement
      console.log("ADAPTER: deleteUser", userId);
      throw new Error("Adapter method not implemented: deleteUser");
    },
    async linkAccount(account) {
      // TODO: Implement for OAuth providers
      console.log("ADAPTER: linkAccount", account);
      throw new Error("Adapter method not implemented: linkAccount");
    },
    async unlinkAccount({ providerAccountId, provider }) {
      // TODO: Implement for OAuth providers
      console.log("ADAPTER: unlinkAccount", providerAccountId, provider);
      throw new Error("Adapter method not implemented: unlinkAccount");
    },
    async createSession({ sessionToken, userId, expires }) {
      // D1 is not suitable for session management due to latency.
      // next-auth with JWT sessions is the recommended approach for serverless.
      // This method can be left unimplemented if using JWT sessions.
      console.log("ADAPTER: createSession", sessionToken, userId, expires);
      throw new Error("Adapter method not implemented: createSession. Use JWT sessions.");
    },
    async getSessionAndUser(sessionToken) {
      // See createSession. Use JWT sessions.
      console.log("ADAPTER: getSessionAndUser", sessionToken);
      return null;
    },
    async updateSession({ sessionToken }) {
      // See createSession. Use JWT sessions.
      console.log("ADAPTER: updateSession", sessionToken);
      throw new Error("Adapter method not implemented: updateSession. Use JWT sessions.");
    },
    async deleteSession(sessionToken) {
      // See createSession. Use JWT sessions.
      console.log("ADAPTER: deleteSession", sessionToken);
      throw new Error("Adapter method not implemented: deleteSession. Use JWT sessions.");
    },
    async createVerificationToken(verificationToken) {
      // TODO: Implement for email provider
      console.log("ADAPTER: createVerificationToken", verificationToken);
      return;
    },
    async useVerificationToken({ identifier, token }) {
      // TODO: Implement for email provider
      console.log("ADAPTER: useVerificationToken", identifier, token);
      return null;
    },
  };
}
