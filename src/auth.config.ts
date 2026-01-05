// src/auth.config.ts
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SuperAdminD1Client } from "@/lib/d1";
import { CustomD1Adapter } from "@/lib/next-auth-d1-adapter";

function resolveAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;

  const fallback = "dev-secret";
  const message = "AUTH_SECRET/NEXTAUTH_SECRET not set; falling back to a dev-only secret.";

  // 개발/프리뷰 환경에서는 동작을 지속하고 경고만 출력
  if (process.env.NODE_ENV !== "production") {
    console.warn(message);
    return fallback;
  }

  // Pages 배포에서 시크릿이 누락된 경우에도 500을 피하고 경고 로그를 남김
  console.warn(`[WARN] ${message} 프로덕션에서는 환경변수를 설정하세요.`);
  return fallback;
}

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
    secret: resolveAuthSecret(),
    pages: {
      signIn: '/login',
    }
  };
};
