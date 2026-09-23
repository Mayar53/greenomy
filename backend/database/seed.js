// database/seed.js — idempotent reference data: admin account, partners,
// rewards and Green Hub articles. Safe to re-run; everything upserts.
require("dotenv").config();
const path = require("path");
const bcrypt = require("bcrypt");
const { pool, withTransaction, assertConfigured } = require("../config/db");

const rewardsSeed = require(path.join(__dirname, "../../rewards.json"));
const greenHubSeed = require(path.join(__dirname, "../../greenhub.json"));

const DEV_ADMIN_EMAIL = "admin@greenomy.app";
const DEV_ADMIN_PASSWORD = "admin12345";

async function seedAdmin(client) {
  const isProd = process.env.NODE_ENV === "production";
  const email = process.env.ADMIN_SEED_EMAIL || (isProd ? null : DEV_ADMIN_EMAIL);
  const password = process.env.ADMIN_SEED_PASSWORD || (isProd ? null : DEV_ADMIN_PASSWORD);

  if (!email || !password) {
    console.warn("No admin configured (ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD) — skipping admin.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO users (full_name, email, password_hash, role, status)
     VALUES ('Greenomy Admin', $1, $2, 'admin', 'active')
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role          = 'admin',
           status        = 'active'`,
    [email, passwordHash]
  );
  console.log(`admin     ${email}`);
}

async function seedPartners(client) {
  const names = [...new Set(rewardsSeed.map((r) => r.partner))];
  for (const name of names) {
    await client.query(
      `INSERT INTO partners (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }
  console.log(`partners  ${names.length}`);
}

async function seedRewards(client) {
  for (const reward of rewardsSeed) {
    await client.query(
      `INSERT INTO rewards (reward_id, partner_id, partner, category, title, description,
                            points_required, expires_at, is_active, i18n)
       VALUES ($1, (SELECT partner_id FROM partners WHERE name = $2), $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (reward_id) DO UPDATE
         SET partner_id      = EXCLUDED.partner_id,
             partner         = EXCLUDED.partner,
             category        = EXCLUDED.category,
             title           = EXCLUDED.title,
             description     = EXCLUDED.description,
             points_required = EXCLUDED.points_required,
             expires_at      = EXCLUDED.expires_at,
             is_active       = EXCLUDED.is_active,
             i18n            = EXCLUDED.i18n,
             updated_at      = now()`,
      [
        reward.id,
        reward.partner,
        reward.category,
        reward.title,
        reward.description,
        reward.pointsRequired,
        reward.expiresAt || null,
        reward.isActive !== false,
        reward.i18n ? JSON.stringify(reward.i18n) : null,
      ]
    );
  }
  console.log(`rewards   ${rewardsSeed.length}`);
}

async function seedGreenHub(client) {
  for (const article of greenHubSeed) {
    await client.query(
      `INSERT INTO green_hub_content (slug, title, description, category, content_type,
                                      body, image_url, reading_time, is_published, i18n)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO UPDATE
         SET title        = EXCLUDED.title,
             description  = EXCLUDED.description,
             category     = EXCLUDED.category,
             content_type = EXCLUDED.content_type,
             body         = EXCLUDED.body,
             image_url    = EXCLUDED.image_url,
             reading_time = EXCLUDED.reading_time,
             is_published = EXCLUDED.is_published,
             i18n         = EXCLUDED.i18n,
             updated_at   = now()`,
      [
        article.slug,
        article.title,
        article.description,
        article.category,
        article.contentType || "article",
        JSON.stringify(article.body || []),
        article.imageUrl || null,
        article.readingTime || null,
        article.isPublished !== false,
        article.i18n ? JSON.stringify(article.i18n) : null,
      ]
    );
  }
  console.log(`green hub ${greenHubSeed.length}`);
}

async function main() {
  assertConfigured();

  await withTransaction(async (client) => {
    await seedAdmin(client);
    await seedPartners(client);
    await seedRewards(client);
    await seedGreenHub(client);
  });
  console.log("\nSeed complete.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(`\nSeed failed: ${err.message}`);
    pool.end().finally(() => process.exit(1));
  });
