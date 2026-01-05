// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { D1Client, getD1Binding, SuperAdminD1Client } from "@/lib/d1";
import { CustomD1Adapter } from "@/lib/next-auth-d1-adapter";
import { D1Database } from "@cloudflare/workers-types";

// This function builds the NextAuth options dynamically based on the D1 client.
const buildAuthOptions = (d1Client: SuperAdminD1Client): NextAuthOptions => {
  return {
    // @ts-ignore
    adapter: CustomD1Adapter(d1Client),
    session: {
      strategy: "jwt", // Use JSON Web Tokens for session management
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
          
          // This is a mock authorization.
          // In a real app, you'd hash and compare the password.
          const user = await d1Client.getUserByEmailAny(credentials.email);

          if (user && credentials.password === "password") { // MOCK PASSWORD CHECK
            // Return the user object that NextAuth will use to create the JWT.
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
        // The 'user' object is available on the first sign-in.
        // We persist the custom properties to the token here.
        if (user) {
          token.id = user.id;
          token.role = user.role;
          token.tenant_id = user.tenant_id;
        }
        return token;
      },
      async session({ session, token }) {
        // We retrieve the custom properties from the token and add them to the session object.
        // This makes them available on the client-side via useSession() or getServerSession().
        if (session.user) {
          session.user.id = token.id as string;
          session.user.role = token.role as string;
          session.user.tenant_id = token.tenant_id as string | null;
        }
        return session;
      }
    },
    secret: process.env.AUTH_SECRET, // IMPORTANT: Set this in your Cloudflare Pages environment variables
    pages: {
      signIn: '/login', // A custom login page will need to be created
    }
  };
};

// The handler needs to be defined in a way that it can access runtime environment variables.
// In Cloudflare Pages, the 'env' is passed as the second argument to the fetch handler,
// which is abstracted away here but can be accessed via `context.env`.
async function authHandler(req: Request, context: { params: string[], env: { DB: D1Database } }) {
  // 1. Get the D1 binding from the runtime environment.
  // The `getD1Binding` function is now "smart" - it provides a mock for build time
  // and uses the real binding when `env` is passed at runtime.
  const db = getD1Binding(context.env);
  const d1Client = new SuperAdminD1Client(db);

  // 2. Build the auth options dynamically with the real D1 client.
  const authOptions = buildAuthOptions(d1Client);

  // 3. Call NextAuth with the dynamic options.
  // We need to pass both req and context to NextAuth.
  // The context contains the route parameters, e.g., [...nextauth].
  return NextAuth(req as any, context as any, authOptions);
}

export { authHandler as GET, authHandler as POST }
