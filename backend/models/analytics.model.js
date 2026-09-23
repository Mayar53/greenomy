// models/analytics.model.js
// Read-only aggregates for the admin dashboard. Not a table — it composes
// counts across the others, which is why it has no matching migration.
const { query } = require("../config/db");

const DAYS = 14;

/** One row of platform-wide counters. */
async function summary() {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM users)                                        AS users_total,
       (SELECT count(*)::int FROM users WHERE role <> 'user')                   AS users_admins,
       (SELECT count(*)::int FROM users WHERE status = 'suspended')             AS users_suspended,
       (SELECT count(*)::int FROM plants)                                       AS plants_total,
       (SELECT count(*)::int FROM plants p WHERE EXISTS (
          SELECT 1 FROM verifications v
           WHERE v.plant_id = p.plant_id AND v.approval_status = 'approved'))   AS plants_grown,
       (SELECT count(*)::int FROM verifications)                                AS verifications_total,
       (SELECT count(*)::int FROM verifications WHERE approval_status = 'pending')  AS verifications_pending,
       (SELECT count(*)::int FROM verifications WHERE approval_status = 'approved') AS verifications_approved,
       (SELECT count(*)::int FROM verifications WHERE approval_status = 'rejected') AS verifications_rejected,
       (SELECT count(*)::int FROM redemptions)                                  AS redemptions_total,
       (SELECT count(*)::int FROM redemptions WHERE is_used)                    AS redemptions_used,
       (SELECT COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::int FROM point_transactions)  AS points_earned,
       (SELECT COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0)::int FROM point_transactions) AS points_spent,
       (SELECT count(*)::int FROM rewards)                                      AS rewards_total,
       (SELECT count(*)::int FROM rewards WHERE is_active)                      AS rewards_active,
       (SELECT count(*)::int FROM partners)                                     AS partners_total,
       (SELECT count(*)::int FROM partners WHERE is_active)                     AS partners_active,
       (SELECT count(*)::int FROM green_hub_content)                            AS content_total,
       (SELECT count(*)::int FROM green_hub_content WHERE is_published)         AS content_published,
       (SELECT count(*)::int FROM waitlist)                                     AS waitlist_total`
  );
  return rows[0];
}

/** Daily verification counts for the dashboard chart. */
async function verificationsByDay() {
  const { rows } = await query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(*)::int AS count
       FROM verifications
      WHERE created_at >= now() - ($1::int - 1) * interval '1 day'
      GROUP BY 1
      ORDER BY 1`,
    [DAYS]
  );
  return rows;
}

module.exports = { summary, verificationsByDay, DAYS };
