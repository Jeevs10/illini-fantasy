import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession } from "../lib/auth.ts";

/**
 * Signing out, in one place.
 *
 * The session is a row, so this deletes it rather than only dropping a cookie:
 * a browser left signed in on somebody else's machine stops being signed in
 * everywhere, not just here.
 */
export async function signOutAction(): Promise<void> {
  "use server";
  await endSession();
  revalidatePath("/", "layout");
  redirect("/signin");
}

export function SignOut({ name }: { name: string }) {
  return (
    <form className="whoami" action={signOutAction}>
      <span className="whoami-name">{name}</span>
      <button type="submit" className="linkish">Sign out</button>
    </form>
  );
}
