// Server Component shell for the diner chatbot page (D-01, D-09).
// Reads Edge Config server-side (single fetch + props handoff) and passes
// the palette to the client island — Edge Config reads in client-side code
// are no-ops on Vercel (the value is only set at server request time).
import { DinerChat } from "@/components/chat/diner-chat-island";
import { getTypedConfig } from "@/lib/edge-config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const colorsByPartySize = await getTypedConfig<Record<string, string>>(
    "colors_by_party_size",
    { "1-2": "#A8E6CF", "3-4": "#FFD3B6", "5-6": "#FFAAA5", "7+": "#D5AAFF" },
  );

  return <DinerChat colorsByPartySize={colorsByPartySize} />;
}
