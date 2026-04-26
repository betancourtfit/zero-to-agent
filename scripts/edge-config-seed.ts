import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { get } from "@vercel/edge-config";

const FORCE = process.argv.includes("--force");

async function seedEdgeConfig() {
  const token = process.env.VERCEL_TOKEN;
  const edgeConfigConnectionString = process.env.EDGE_CONFIG;

  if (!token) throw new Error("VERCEL_TOKEN is required (local only — do not commit)");
  if (!edgeConfigConnectionString) throw new Error("EDGE_CONFIG is required");

  const url = new URL(edgeConfigConnectionString);
  const edgeConfigId = url.pathname.replace(/^\//, "");

  const seedPath = join(process.cwd(), "edge-config", "seed.json");
  const seed = JSON.parse(await readFile(seedPath, "utf-8"));

  const items = [];
  for (const [key, value] of Object.entries(seed)) {
    if (!FORCE) {
      const current = await get(key);
      if (JSON.stringify(current) === JSON.stringify(value)) {
        console.log(`[skip] ${key} (unchanged)`);
        continue;
      }
    }
    items.push({ operation: "upsert", key, value });
  }

  if (items.length === 0) {
    console.log("All keys up to date. Run with --force to overwrite.");
    return;
  }

  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(`Edge Config seed failed: ${JSON.stringify(result)}`);
  console.log(`[seeded] ${items.map((i: { key: string }) => i.key).join(", ")}`);
}

seedEdgeConfig().catch((err) => { console.error(err); process.exit(1); });
