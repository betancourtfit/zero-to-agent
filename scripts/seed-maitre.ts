import { Client } from "pg";

async function seedMaitre() {
  const email = process.env.MAITRE_EMAIL;
  if (!email) throw new Error("MAITRE_EMAIL env var is required");

  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
  });

  await client.connect();

  try {
    await client.query(
      `INSERT INTO employees (email, active)
       VALUES ($1, true)
       ON CONFLICT (email) DO UPDATE SET active = true`,
      [email]
    );
    console.log(`[seeded] maitre: ${email}`);
  } finally {
    await client.end();
  }
}

seedMaitre().catch((err) => {
  console.error(err);
  process.exit(1);
});
