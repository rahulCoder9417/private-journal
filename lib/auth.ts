import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

// Vercel automatically sets VERCEL_URL to the deployment hostname (no protocol).
// Use it so better-auth trusts the correct origin without manual env var config.
const productionURL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

const baseURL =
  process.env.BETTER_AUTH_URL ||
  productionURL ||
  "http://localhost:3000";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  baseURL,
  trustedOrigins: [
    baseURL,
    "http://localhost:3000",
    ...(productionURL ? [productionURL] : []),
  ],
});
