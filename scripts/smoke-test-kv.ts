import { Redis } from "@upstash/redis";

async function smokeTestKV() {
  const redis = Redis.fromEnv();
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error(`KV ping failed: ${pong}`);

  await redis.set("smoke:test:key", "hello", { ex: 60 });
  const val = await redis.get("smoke:test:key");
  if (val !== "hello") throw new Error(`KV set/get failed: ${val}`);

  await redis.del("smoke:test:key");
  console.log("KV smoke test passed");
}

smokeTestKV().catch((err) => { console.error(err); process.exit(1); });
