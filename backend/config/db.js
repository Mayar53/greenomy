// config/db.js — database access behind one small interface.
//
// Two drivers, chosen by DB_DRIVER:
//   pg      a real PostgreSQL server over TCP (production; the default)
//   pglite  PostgreSQL 18 compiled to WASM, running in-process with no server
//           to install. For local development and tests only — it is a single
//           connection, so it is not suitable for production concurrency.
//
// Only this file knows which driver is active: models and controllers see the
// same { pool, query, withTransaction, ping, assertConfigured } either way.
const DRIVER = (process.env.DB_DRIVER || "pg").trim().toLowerCase();

/* ------------------------------------------------------------------- pg --- */
function createPgDriver() {
  const { Pool } = require("pg");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Managed providers (Neon, Supabase, RDS) require TLS but present certs
    // Node doesn't trust by default, hence rejectUnauthorized: false.
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DB_POOL_MAX || 10),
  });

  pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL error", err);
  });

  const query = (text, params) => pool.query(text, params);

  /** Runs fn(client) inside BEGIN/COMMIT and rolls back on any throw. This is
   * what makes the points paths atomic: a failure halfway through must leave
   * the balance untouched rather than half-applied. */
  async function withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection already gone; nothing useful to do
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return { pool, query, withTransaction, ping: () => pool.query("SELECT 1") };
}

/* --------------------------------------------------------------- pglite --- */
function createPgliteDriver() {
  let PGlite;
  try {
    ({ PGlite } = require("@electric-sql/pglite"));
  } catch {
    // A raw MODULE_NOT_FOUND stack trace here tells you nothing actionable.
    throw new Error(
      "DB_DRIVER=pglite but @electric-sql/pglite is not installed.\n" +
        "  Fix: run `npm install` in backend/, or set DB_DRIVER=pg with a DATABASE_URL."
    );
  }

  const dataDir = process.env.PGLITE_DIR || ".pgdata";
  const db = new PGlite(dataDir);

  // pg exposes `rowCount`, PGlite exposes `affectedRows`; models read
  // `rowCount` (e.g. plant.model.remove checks it after a DELETE).
  const normalize = (result) => ({
    ...result,
    rows: result.rows || [],
    rowCount:
      typeof result.affectedRows === "number"
        ? result.affectedRows
        : result.rows
          ? result.rows.length
          : 0,
  });

  // PGlite's query() prepares a single statement and rejects multiples with
  // "cannot insert multiple commands into a prepared statement", so the
  // multi-statement migration files have to go through exec().
  const isMultiStatement = (sql) =>
    sql.replace(/--[^\n]*/g, "").replace(/;+\s*$/, "").includes(";");

  const executor = (target) => async (text, params) => {
    if (params && params.length) return normalize(await target.query(text, params));
    if (isMultiStatement(text)) {
      await target.exec(text);
      return normalize({ rows: [] });
    }
    return normalize(await target.query(text));
  };

  const root = executor(db);

  return {
    // Shaped like the pg driver's surface, so migrate.js/seed.js can call
    // pool.end() without caring which driver is live.
    //
    // NOTE: PGlite is a single connection. Inside withTransaction ONLY the
    // provided client may be used — issuing a root query while a transaction
    // is open deadlocks rather than erroring. On the pg driver that mistake
    // silently reads from a different connection instead.
    pool: { query: root, end: () => db.close() },
    query: root,
    withTransaction: (fn) => db.transaction(async (tx) => fn({ query: executor(tx) })),
    ping: () => db.query("SELECT 1"),
  };
}

/* ---------------------------------------------------------------------- */
// Driver construction is deferred: throwing here would surface as a bare stack
// trace from the `require` itself, before the app's boot sequence can explain
// it. assertConfigured() rethrows it with guidance instead.
let impl = null;
let startupError = null;

try {
  impl = DRIVER === "pglite" ? createPgliteDriver() : createPgDriver();
} catch (err) {
  startupError = err;
}

function assertConfigured() {
  if (startupError) throw startupError;
  if (DRIVER === "pglite") return;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — add it to backend/.env (see .env.example).");
  }
}

const query = (text, params) => {
  if (startupError) throw startupError;
  return impl.query(text, params);
};

const withTransaction = (fn) => {
  if (startupError) throw startupError;
  return impl.withTransaction(fn);
};

const ping = () => {
  if (startupError) throw startupError;
  return impl.ping();
};

module.exports = {
  driver: DRIVER,
  pool: { query, end: () => (impl ? impl.pool.end() : Promise.resolve()) },
  query,
  withTransaction,
  ping,
  assertConfigured,
};
