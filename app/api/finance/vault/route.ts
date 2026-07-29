import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { financeVault } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(financeVault)
    .where(eq(financeVault.userId, session.user.id));

  const row = rows[0];
  if (!row) return Response.json(null);
  return Response.json({
    salt: row.salt,
    encryptedSettings: row.encryptedSettings,
    iv: row.iv,
    updatedAt: row.updatedAt,
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { salt, encryptedSettings, iv } = body as {
    salt: string;
    encryptedSettings: string;
    iv: string;
  };
  if (!salt || !encryptedSettings || !iv) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const now = new Date();
  const existing = await db
    .select()
    .from(financeVault)
    .where(eq(financeVault.userId, session.user.id));

  if (existing.length > 0) {
    // The stored salt is authoritative and never rotates — a rotated salt would
    // orphan every already-encrypted month blob. Ignore whatever the client sent.
    await db
      .update(financeVault)
      .set({ encryptedSettings, iv, updatedAt: now })
      .where(eq(financeVault.id, existing[0].id));
    return Response.json({ salt: existing[0].salt, updatedAt: now.toISOString() });
  }

  await db.insert(financeVault).values({
    id: crypto.randomUUID(),
    userId: session.user.id,
    salt,
    encryptedSettings,
    iv,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ salt, updatedAt: now.toISOString() });
}
