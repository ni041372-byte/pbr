// src/auth.config.ts
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SuperAdminD1Client } from "@/lib/d1";
import { CustomD1Adapter } from "@/lib/next-auth-d1-adapter";

export const buildAuthOptions = (d1Client: SuperAdminD1Client): NextAuthOptions => {
  return {
    // @ts-ignore
    adapter: CustomD1Adapter(d1Client),
    session: {
      strategy: "jwt",
    },
    providers: [
      CredentialsProvider({
        name: 'Credentials',
        credentials: {
          email: { label: "Email", type: "text" },
          password: { label: "Password", type: "password" }
        },
        async authorize(credentials, req) {
          if (!credentials?.email || !credentials?.password) {
            throw new Error("Email and password required");
          }
          const user = await d1Client.getUserByEmailAny(credentials.email);
          if (user && credentials.password === "password") { // MOCK PASSWORD CHECK
            return {
              id: user.id,
              email: user.email,
              role: user.role,
              tenant_id: user.tenant_id
            };
          }
          return null;
        }
      })
    ],
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          token.role = user.role;
          token.tenant_id = user.tenant_id;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.id as string;
          session.user.role = token.role as string;
          session.user.tenant_id = token.tenant_id as string | null;
        }
        return session;
      }
    },
    secret: process.env.AUTH_SECRET,
    pages: {
      signIn: '/login',
    }
  };
};
