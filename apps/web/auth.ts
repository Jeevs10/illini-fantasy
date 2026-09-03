import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PostgresAdapter } from "./lib/adapter.ts";
import { db } from "./lib/db.ts";

/**
 * Magic-link sign-in.
 *
 * A private twenty-person league has no use for passwords or an OAuth app: the
 * invite and the sign-in are the same mechanism, an email to an address the
 * commissioner already named.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(db),
  session: { strategy: "database" },
  pages: { signIn: "/signin", verifyRequest: "/signin/sent", error: "/signin" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY ?? "development",
      from: process.env.AUTH_EMAIL_FROM ?? "Illini Fantasy <onboarding@resend.dev>",

      /**
       * With no mail credentials the link goes to the server log instead.
       *
       * Development would otherwise be blocked on a Resend account and a
       * verified sending domain, which is a lot of setup to stand between you
       * and looking at a page.
       */
      async sendVerificationRequest({ identifier, url, provider }) {
        if (!process.env.AUTH_RESEND_KEY) {
          console.log(`\n  sign-in link for ${identifier}\n  ${url}\n`);
          return;
        }
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from,
            to: identifier,
            subject: "Your Illini Fantasy sign-in link",
            text: `Sign in to Illini Fantasy Hoops:\n\n${url}\n\n`
              + `The link works once and expires in 24 hours.`,
          }),
        });
        if (!response.ok) {
          throw new Error(`Resend refused the message: ${await response.text()}`);
        }
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
