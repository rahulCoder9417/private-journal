import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { account } from "@/lib/schema";
import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { password } = await request.json() as { password: string };
  if (!password) return Response.json({ error: "Missing password" }, { status: 400 });

  const accounts = await db
    .select()
    .from(account)
    .where(
      and(
        eq(account.userId, session.user.id),
        eq(account.providerId, "credential")
      )
    );

  const hash = accounts[0]?.password;
  if (!hash) return Response.json({ error: "No password account found" }, { status: 404 });

  const ok = await verifyPassword({ hash, password });
  if (!ok) return Response.json({ error: "Wrong password" }, { status: 401 });

  return Response.json({ ok: true });
}
