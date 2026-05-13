import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { journalMetadata } from "@/lib/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (date) {
    const rows = await db
      .select()
      .from(journalMetadata)
      .where(
        and(
          eq(journalMetadata.userId, session.user.id),
          eq(journalMetadata.date, date)
        )
      );
    return Response.json(rows[0] ?? null);
  }

  if (from && to) {
    const rows = await db
      .select()
      .from(journalMetadata)
      .where(
        and(
          eq(journalMetadata.userId, session.user.id),
          gte(journalMetadata.date, from),
          lte(journalMetadata.date, to)
        )
      );
    return Response.json(rows);
  }

  return Response.json({ error: "Provide date or from+to" }, { status: 400 });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { date, wordCount, salt } = body as {
    date: string;
    wordCount: number;
    salt: string;
  };

  if (!date || !salt) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(journalMetadata)
    .where(
      and(
        eq(journalMetadata.userId, session.user.id),
        eq(journalMetadata.date, date)
      )
    );

  const now = new Date();

  if (existing.length > 0) {
    await db
      .update(journalMetadata)
      .set({ wordCount: wordCount ?? 0, updatedAt: now })
      .where(eq(journalMetadata.id, existing[0].id));
    return Response.json({ ...existing[0], wordCount, updatedAt: now });
  }

  const id = crypto.randomUUID();
  const row = {
    id,
    userId: session.user.id,
    date,
    wordCount: wordCount ?? 0,
    salt,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(journalMetadata).values(row);
  return Response.json(row, { status: 201 });
}
