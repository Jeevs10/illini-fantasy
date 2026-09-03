import { signOut } from "../auth.ts";

export function SignOut({ name }: { name: string }) {
  return (
    <form
      className="whoami"
      action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}
    >
      <span className="whoami-name">{name}</span>
      <button type="submit" className="linkish">Sign out</button>
    </form>
  );
}
