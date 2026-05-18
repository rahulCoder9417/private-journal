import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { journalContent, journalMetadata } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

// Combined metadata+content save in a single request.
// Previously the client called POST /metadata then POST /content separately —
// if the second call failed, the DB would have a new salt but old ciphertext,
// making all subsequent loads fail with an apparent "wrong password" error.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { date, wordCount, salt, encryptedData, iv } = body as {
    date: string;
    wordCount: number;
    salt: string;
    encryptedData: string;
    iv: string;
  };

  if (!date || !salt || !encryptedData || !iv) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const now = new Date();
  const userId = session.user.id;

  const existingMeta = await db
    .select()
    .from(journalMetadata)
    .where(and(eq(journalMetadata.userId, userId), eq(journalMetadata.date, date)));

  let metaId: string;

  if (existingMeta.length > 0) {
    metaId = existingMeta[0].id;
    await db
      .update(journalMetadata)
      .set({ wordCount: wordCount ?? 0, salt, updatedAt: now })
      .where(eq(journalMetadata.id, metaId));
  } else {
    metaId = crypto.randomUUID();
    await db.insert(journalMetadata).values({
      id: metaId,
      userId,
      date,
      wordCount: wordCount ?? 0,
      salt,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Salt and content saved in the same request — they are always in sync.
  const existingContent = await db
    .select()
    .from(journalContent)
    .where(eq(journalContent.metadataId, metaId));

  if (existingContent.length > 0) {
    await db
      .update(journalContent)
      .set({ encryptedData, iv })
      .where(eq(journalContent.metadataId, metaId));
  } else {
    await db.insert(journalContent).values({
      id: crypto.randomUUID(),
      metadataId: metaId,
      encryptedData,
      iv,
    });
  }

  return Response.json({ updatedAt: now.toISOString() });
}
