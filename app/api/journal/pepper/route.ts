import { auth } from "@/lib/auth";
import { createHmac } from "crypto";
import { headers } from "next/headers";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Derives a user-specific pepper from the server secret.
  // Attacker needs both the user password AND ENCRYPTION_SECRET to decrypt.
  const pepper = createHmac("sha256", process.env.ENCRYPTION_SECRET!)
    .update(session.user.id)
    .digest("hex");

  return Response.json({ pepper });
}
