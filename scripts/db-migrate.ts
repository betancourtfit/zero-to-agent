import { Client } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
  });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const migrationsDir = join(process.cwd(), "db", "migrations");
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const { rows } = await client.query(
        "SELECT filename FROM _migrations WHERE filename = $1",
        [filename]
      );

      if (rows.length > 0) {
        console.log(`[skip] ${filename}`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, filename), "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`[applied] ${filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed: ${err}`);
      }
    }
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
