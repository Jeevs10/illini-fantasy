import type { NextConfig } from "next";

const config: NextConfig = {
  // The workspace packages ship TypeScript source rather than a build step, so
  // Next has to compile them the way it compiles the app.
  transpilePackages: ["@illini/db", "@illini/league", "@illini/scoring"],
  serverExternalPackages: ["pg"],
  typescript: { ignoreBuildErrors: false },
  // Next writes AGENTS.md and CLAUDE.md into the app on dev start. This repo
  // documents itself in the README; a second, generated set would drift.
  agentRules: false,
};

export default config;
