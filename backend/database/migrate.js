// database/migrate.js — applies database/migrations/*.sql in filename order.
// Deliberately no migration library: each file runs in its own transaction and
// is then recorded in schema_migrations, so re-running is a no-op.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool, withTransaction, assertConfigured } = require("../config/db");

const DIR = path.join(__dirname, "migrations");

async function main() {
  assertConfigured();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename)
  );

  const files = fs
    .readdirSync(DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(DIR, file), "utf8");
    try {
      // Schema + migration record commit together, so a failure can't leave a
      // half-applied file marked as done.
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      });
    } catch (err) {
      throw new Error(`migration ${file} failed: ${err.message}`);
    }

    ran += 1;
    console.log(`apply ${file}`);
  }

  console.log(ran ? `\n${ran} migration(s) applied.` : "\nNothing to apply — schema is up to date.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(`\nMigration failed: ${err.message}`);
    pool.end().finally(() => process.exit(1));
  });
