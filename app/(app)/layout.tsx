import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppNav } from "./nav";
import { MiniCalendar } from "@/components/mini-calendar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <AppNav userName={session.user.name} />
      <div className="flex-1 container max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-8 items-start">
          <main className="min-w-0">{children}</main>
          <aside>
            <MiniCalendar />
          </aside>
        </div>
      </div>
    </div>
  );
}
