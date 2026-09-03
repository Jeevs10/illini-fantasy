import { signIn } from "../../auth.ts";

export default async function SignIn({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className="narrow">
      <div className="panel"><div className="panel-body">
        <h1>Illini Fantasy Hoops</h1>
        <p className="muted" style={{ marginBottom: "1.25rem" }}>
          Sign in with the address your commissioner invited. No password — a
          link arrives by email and works once.
        </p>

        {error ? (
          <p className="notice bad">
            That link did not work. It may have been used already, or expired.
            Ask for a new one below.
          </p>
        ) : null}

        <form
          action={async (formData: FormData) => {
            "use server";
            await signIn("resend", {
              email: String(formData.get("email") ?? "").trim().toLowerCase(),
              redirectTo: "/league",
            });
          }}
          style={{ display: "flex", gap: ".5rem" }}
        >
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
            style={{ flex: 1 }}
          />
          <button className="primary" type="submit">Send link</button>
        </form>
      </div>
    </div></div>
  );
}
