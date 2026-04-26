import type { NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";

export const authConfig: NextAuthConfig = {
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: `noreply@${process.env.RESEND_DOMAIN ?? "resend.dev"}`,
      name: "Restaurant Queue",
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnQueue = nextUrl.pathname.startsWith("/queue");
      if (isOnQueue) return isLoggedIn;
      return true;
    },
  },
};
