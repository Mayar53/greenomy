// models/green-hub.model.js
// Unlike the other models this one maps to camelCase, because greenhub.js and
// the per-record `i18n` lookup in language.js already read those keys.
const { query } = require("../config/db");

const COLUMNS = `content_id, slug, title, description, category, content_type,
                 body, image_url, video_url, reading_time, is_published, i18n`;

const FIELD_MAP = {
  slug: "slug",
  title: "title",
  description: "description",
  category: "category",
  contentType: "content_type",
  body: "body",
  imageUrl: "image_url",
  videoUrl: "video_url",
  readingTime: "reading_time",
  isPublished: "is_published",
  i18n: "i18n",
};

const JSON_FIELDS = new Set(["body", "i18n"]);

function toApi(row) {
  return {
    id: row.content_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    contentType: row.content_type,
    body: row.body,
    imageUrl: row.image_url,
    videoUrl: row.video_url,
    readingTime: row.reading_time,
    isPublished: row.is_published,
    i18n: row.i18n,
  };
}

async function list({ category } = {}) {
  const filtered = category && category !== "all";
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM green_hub_content
      WHERE is_published = true ${filtered ? "AND category = $1" : ""}
      ORDER BY created_at DESC`,
    filtered ? [category] : []
  );
  return rows.map(toApi);
}

/** Admin list — includes unpublished drafts. */
async function listAll() {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM green_hub_content ORDER BY created_at DESC`
  );
  return rows.map(toApi);
}

async function findBySlug(slug) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM green_hub_content WHERE slug = $1 AND is_published = true`,
    [slug]
  );
  return rows[0] ? toApi(rows[0]) : null;
}

async function create({ slug, title, description, category, contentType, body, imageUrl, readingTime, isPublished, i18n }) {
  const { rows } = await query(
    `INSERT INTO green_hub_content
       (slug, title, description, category, content_type, body, image_url, reading_time, is_published, i18n)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      slug,
      title,
      description || null,
      category,
      contentType || "article",
      JSON.stringify(body || []),
      imageUrl || null,
      readingTime || null,
      isPublished !== false,
      i18n ? JSON.stringify(i18n) : null,
    ]
  );
  return toApi(rows[0]);
}

async function update(contentId, changes) {
  const sets = [];
  const values = [contentId];

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (changes[key] === undefined) continue;
    const value = JSON_FIELDS.has(key) && changes[key] ? JSON.stringify(changes[key]) : changes[key];
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) return null;

  sets.push("updated_at = now()");
  const { rows } = await query(
    `UPDATE green_hub_content SET ${sets.join(", ")} WHERE content_id = $1 RETURNING ${COLUMNS}`,
    values
  );
  return rows[0] ? toApi(rows[0]) : null;
}

async function remove(contentId) {
  const { rowCount } = await query(
    "DELETE FROM green_hub_content WHERE content_id = $1",
    [contentId]
  );
  return rowCount > 0;
}

module.exports = { list, listAll, findBySlug, create, update, remove };
