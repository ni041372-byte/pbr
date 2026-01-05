// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { getD1Binding, SuperAdminD1Client } from "@/lib/d1";
import { buildAuthOptions } from "@/auth.config";
import { D1Database } from "@cloudflare/workers-types";

async function authHandler(req: Request, context: { params: string[], env: { DB: D1Database } }) {
  const db = getD1Binding(context.env);
  const d1Client = new SuperAdminD1Client(db);
  const authOptions = buildAuthOptions(d1Client);
  return NextAuth(req as any, context as any, authOptions);
}

export { authHandler as GET, authHandler as POST }
