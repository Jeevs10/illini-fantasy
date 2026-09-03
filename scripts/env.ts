import { readFileSync } from "node:fs";

/**
 * Minimal .env loader.
 *
 * Written because the obvious `line.split("=")` version silently keeps quotes,
 * and `neon link` writes quoted values — which produced a connection attempt
 * against a host literally named `base`. Shell `source` strips quotes, so it
 * only fails from Node.
 *
 * Existing environment variables win, so CI and shell exports override the file.
 */
export function loadEnv(path = ".env.local"): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // env may legitimately come from the environment instead
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    process.env[key] ??= value;
  }
}
