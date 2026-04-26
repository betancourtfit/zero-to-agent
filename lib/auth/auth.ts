import NextAuth from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import Resend from "next-auth/providers/resend";
import { authConfig } from "./auth.config";
import { pool } from "@/lib/db/pool";
import { sql } from "@/lib/db/neon";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(pool),
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: `noreply@${process.env.RESEND_DOMAIN}`,
      async sendVerificationRequest({ identifier: email, url, provider }) {
        const { Resend: ResendClient } = await import("resend");
        const resend = new ResendClient(provider.apiKey);
        await resend.emails.send({
          from: provider.from!,
          to: email,
          subject: "Tu link para entrar al panel",
          html: `<p>Hacé clic para entrar al panel:</p><p><a href="${url}">Ingresar</a></p><p>Este link expira en 24 horas.</p>`,
        });
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, email }) {
      if (email?.verificationRequest) {
        if (!user.email) return false;
        const rows = await sql`
          SELECT id, active FROM employees WHERE email = ${user.email}
        `;
        if (rows.length === 0 || !rows[0].active) return false;
      }
      return true;
    },

    async session({ session, user }) {
      if (!session.user?.email) return session;
      const rows = await sql`
        SELECT active FROM employees WHERE email = ${session.user.email}
      `;
      if (rows.length === 0 || !rows[0].active) {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      return session;
    },
  },
});
