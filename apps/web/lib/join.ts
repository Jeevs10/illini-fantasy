/** Where an invite or join link points. Same pin the sign-in links use. */
export function joinUrl(token: string): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/join/${token}`;
}
