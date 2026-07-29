import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { financeMonth } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const month = new URL(request.url).searchParams.get("month");
  if (!month) return Response.json({ error: "Provide month" }, { status: 400 });

  const rows = await db
    .select()
    .from(financeMonth)
    .where(
      and(eq(financeMonth.userId, session.user.id), eq(financeMonth.month, month))
    );

  const row = rows[0];
  if (!row) return Response.json(null);
  return Response.json({
    month: row.month,
    encryptedData: row.encryptedData,
    iv: row.iv,
    updatedAt: row.updatedAt,
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { month, encryptedData, iv } = body as {
    month: string;
    encryptedData: string;
    iv: string;
  };
  if (!month || !encryptedData || !iv) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const now = new Date();
  const existing = await db
    .select()
    .from(financeMonth)
    .where(
      and(eq(financeMonth.userId, session.user.id), eq(financeMonth.month, month))
    );

  if (existing.length > 0) {
    await db
      .update(financeMonth)
      .set({ encryptedData, iv, updatedAt: now })
      .where(eq(financeMonth.id, existing[0].id));
  } else {
    await db.insert(financeMonth).values({
      id: crypto.randomUUID(),
      userId: session.user.id,
      month,
      encryptedData,
      iv,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Response.json({ updatedAt: now.toISOString() });
}
