import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const headerStore = await headers();

  return NextResponse.json({
    env: {
      VERCEL_URL: process.env.VERCEL_URL ?? null,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? null,
      NODE_ENV: process.env.NODE_ENV,
    },
    cookies: cookieStore.getAll().map(c => ({ name: c.name, hasValue: !!c.value })),
    origin: headerStore.get("origin"),
    host: headerStore.get("host"),
  });
}
