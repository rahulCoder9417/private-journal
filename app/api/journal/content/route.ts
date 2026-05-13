import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { journalContent, journalMetadata } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) return Response.json({ error: "Missing date" }, { status: 400 });

  const meta = await db
    .select()
    .from(journalMetadata)
    .where(
      and(
        eq(journalMetadata.userId, session.user.id),
        eq(journalMetadata.date, date)
      )
    );

  if (!meta.length) return Response.json(null);

  const content = await db
    .select()
    .from(journalContent)
    .where(eq(journalContent.metadataId, meta[0].id));

  if (!content.length) return Response.json(null);

  return Response.json({
    salt: meta[0].salt,
    encryptedData: content[0].encryptedData,
    iv: content[0].iv,
  });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { date, encryptedData, iv } = body as {
    date: string;
    encryptedData: string;
    iv: string;
  };

  if (!date || !encryptedData || !iv) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  // Reject updates to already-synced past entries
  const todayStr = new Date().toISOString().slice(0, 10);
  if (date < todayStr) {
    const existingMeta = await db.select().from(journalMetadata).where(
      and(eq(journalMetadata.userId, session.user.id), eq(journalMetadata.date, date))
    );
    if (existingMeta.length > 0) {
      const existingContent = await db.select().from(journalContent)
        .where(eq(journalContent.metadataId, existingMeta[0].id));
      if (existingContent.length > 0) {
        return Response.json({ error: "Past entries cannot be modified once synced." }, { status: 403 });
      }
    }
  }

  const meta = await db
    .select()
    .from(journalMetadata)
    .where(
      and(
        eq(journalMetadata.userId, session.user.id),
        eq(journalMetadata.date, date)
      )
    );

  if (!meta.length) {
    return Response.json(
      { error: "Metadata not found. Save metadata first." },
      { status: 404 }
    );
  }

  const existing = await db
    .select()
    .from(journalContent)
    .where(eq(journalContent.metadataId, meta[0].id));

  if (existing.length > 0) {
    await db
      .update(journalContent)
      .set({ encryptedData, iv })
      .where(eq(journalContent.metadataId, meta[0].id));
  } else {
    await db.insert(journalContent).values({
      id: crypto.randomUUID(),
      metadataId: meta[0].id,
      encryptedData,
      iv,
    });
  }

  return Response.json({ ok: true });
}
