import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { financeMonth } from "@/lib/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { headers } from "next/headers";

// Metadata only — which months exist and when each was last written.
// Used for the mount-time "what changed in the cloud?" check.
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const filters = [eq(financeMonth.userId, session.user.id)];
  if (from) filters.push(gte(financeMonth.month, from));
  if (to) filters.push(lte(financeMonth.month, to));

  const rows = await db
    .select({ month: financeMonth.month, updatedAt: financeMonth.updatedAt })
    .from(financeMonth)
    .where(and(...filters));

  return Response.json(rows);
}
