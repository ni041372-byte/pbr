import 'next-auth';
import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  /**
   * Extends the built-in session.user type to include our custom properties.
   */
  interface Session {
    user?: {
      id: string;
      role: string;
      tenant_id: string | null;
    } & DefaultSession['user']; // Keep the original properties
  }
}

declare module 'next-auth/jwt' {
  /**
   * Extends the built-in JWT type to include our custom properties.
   */
  interface JWT {
    id: string;
    role: string;
    tenant_id: string | null;
  }
}
