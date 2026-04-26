import { Pool } from "pg";
import { neon } from "@neondatabase/serverless";

async function loadTest() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const sql = neon(process.env.DATABASE_URL!);

  const start = Date.now();

  const poolQueries = Array.from({ length: 10 }, () =>
    pool.query("SELECT 1 AS ok")
  );
  const neonQueries = Array.from({ length: 10 }, () =>
    sql`SELECT 1 AS ok`
  );

  const [poolResults, neonResults] = await Promise.all([
    Promise.all(poolQueries),
    Promise.all(neonQueries),
  ]);

  const elapsed = Date.now() - start;
  console.log(`Pool: ${poolResults.length} OK, Neon: ${neonResults.length} OK`);
  console.log(`Wall time: ${elapsed}ms`);

  if (elapsed > 5000) {
    throw new Error(`Load test exceeded 5s wall time: ${elapsed}ms`);
  }

  await pool.end();
}

loadTest().catch((err) => { console.error(err); process.exit(1); });
