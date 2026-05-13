import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

// Collect every possible URL this deployment might be accessed from.
// VERCEL_PROJECT_PRODUCTION_URL = custom domain (jounal-private.vercel.app)
// VERCEL_URL = raw deployment URL (project-hash.vercel.app)
// BETTER_AUTH_URL = manually set override
function buildOrigins(): string[] {
  const raw = [
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    "http://localhost:3000",
  ];
  return raw
    .filter(Boolean)
    .map((u) => (u!.startsWith("http") ? u! : `https://${u!}`));
}

const origins = buildOrigins();
// Prefer the production/custom domain as the canonical baseURL
const baseURL = origins[0];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  baseURL,
  trustedOrigins: origins,
});
