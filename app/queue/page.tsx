import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { sql } from "@/lib/db/neon";
import { getActiveQueue } from "@/lib/services/queue";
import { getTypedConfig } from "@/lib/edge-config";
import { QueueGrid } from "@/components/queue/queue-grid";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  // Defense-in-depth re-check (mirrors app/api/events/queue/route.ts lines 58-65).
  // proxy.ts already gates /queue/:path*, but employees may have been deactivated
  // since the cookie was issued.
  const empRows = (await sql`
    SELECT active FROM employees WHERE email = ${session.user.email} LIMIT 1
  `) as Array<{ active: boolean }>;
  if (empRows.length === 0 || !empRows[0].active) redirect("/login");

  const initial = await getActiveQueue();
  const colorsByPartySize = await getTypedConfig<Record<string, string>>(
    "colors_by_party_size",
    { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" },
  );

  return <QueueGrid initial={initial} colorsByPartySize={colorsByPartySize} />;
}
