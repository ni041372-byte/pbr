// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { D1Client, getD1Binding, SuperAdminD1Client } from "@/lib/d1";
import { CustomD1Adapter } from "@/lib/next-auth-d1-adapter";

// Initialize a D1 client. 
// For auth operations, we might need broader access than a single tenant,
// so using SuperAdminD1Client or a specifically configured client is necessary.
const db = getD1Binding();
const d1Client = new SuperAdminD1Client(db);

export const authOptions: NextAuthOptions = {
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
        const user = await d1Client.getUserByEmail(credentials.email);

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

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }