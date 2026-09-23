// controllers/ai.controller.js — the optional AI features: reading a plant from
// a photo, and a gardening assistant that knows what the member is growing.
//
// Both degrade predictably when no AI key is configured: AiNotConfiguredError
// carries a 503 and a message the UI can show, rather than failing obscurely.
//
// The assistant is GROUNDED: before it answers, the relevant Green Hub articles
// and catalog facts are retrieved and put in front of the model, so it answers
// from Greenomy's own content instead of its general memory.
const ai = require("../services/ai.service");
const plantModel = require("../models/plant.model");
const catalogModel = require("../models/plant-catalog.model");
const greenHubModel = require("../models/green-hub.model");
const userModel = require("../models/user.model");
const weather = require("../services/weather.service");

const IDENTIFY_PROMPT = `Identify the plant in this photo.
Reply with ONLY this JSON shape:
{"plantType": "<common name, e.g. Tomato>", "confidence": <0-1>, "alternatives": ["<name>", "<name>"]}
If you cannot identify a plant, use plantType "" and confidence 0.`;

const MAX_MESSAGE_LENGTH = 1000;
const MAX_SOURCES = 3;
const MAX_PLANTS = 3;

// ---------------------------------------------------------------------------
// Retrieval — the corpus is small (a few dozen Green Hub articles plus a
// 32-plant catalog), so plain keyword/synonym matching is enough. No
// embeddings and no vector store: retrieval stays deterministic and testable.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "do", "does",
  "did", "how", "what", "when", "where", "why", "which", "my", "i", "you", "me", "it", "its",
  "this", "that", "these", "those", "with", "can", "should", "would", "be", "at", "from", "if",
  "not", "no", "have", "has", "get", "got", "need", "want", "please",
  "في", "من", "على", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "هل", "ما", "كيف",
  "متى", "لماذا", "أين", "أنا", "أنت", "هو", "هي", "أو", "لا", "إذا", "كان", "عندي", "لدي",
  "لە", "بۆ", "چۆن", "کەنگی", "بۆچی", "کوێ", "ئەم", "ئەو", "من", "تۆ", "بێ", "لەگەڵ", "نە",
]);

// Word families that should reach each other: a question about "irrigation"
// must find an article that only ever says "water".
const SYNONYM_GROUPS = [
  ["water", "watering", "watered", "irrigate", "irrigation", "moisture", "سقي", "ري", "ماء", "ئاو", "ئاودان"],
  ["soil", "earth", "ground", "تربة", "تراب", "خاک", "زەوی"],
  ["seed", "sowing", "sow", "seedling", "plant", "planting", "planted", "grow", "growing", "grows", "saving", "save", "storage", "fermentation", "ferment", "winnow", "بذور", "بذرة", "زراعة", "حفظ", "تخزين", "تۆو", "چاندن", "نەمام", "پاراستن"],
  ["climate", "weather", "مناخ", "طقس", "ئاووهەوا", "کەشوهەوا"],
  ["season", "seasons", "موسم", "مواسم", "وەرز", "وەرزەکان"],
  ["frost", "freeze", "freezing", "صقيع", "برد", "بەستەڵەک", "سەرما"],
  ["heat", "hot", "summer", "حرارة", "حار", "صيف", "گەرمی", "هاوین"],
  ["sand", "sandy", "رمل", "رملية", "لمی"],
  ["salt", "saline", "salinity", "ملح", "ملوحة", "مالحة", "خوێ", "سوێر"],
  ["container", "pot", "pots", "balcony", "أصص", "وعاء", "شرفة", "قاپ", "بەلکۆن"],
  ["pest", "insect", "insects", "aphid", "aphids", "whitefly", "mite", "mites", "grub", "حشرات", "آفات", "ئافت", "مێشوولە"],
  ["yellow", "yellowing", "pale", "chlorosis", "اصفرار", "شحوب", "زەرد"],
  ["wilt", "wilting", "wilted", "droop", "drooping", "limp", "ذبول", "ذابل", "ڕەنجور"],
  ["sun", "sunburn", "scorch", "scorched", "shade", "شمس", "حروق", "ظل", "خۆر", "سێبەر"],
  ["root", "roots", "جذور", "ڕەگ"],
];

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const word of group) SYNONYMS.set(word, canonical);
}

/** A light English stem, so "tomatoes" meets "tomato" and "pots" meets "pot".
 * Scripts without this pattern (Arabic, Kurdish) are left alone. */
function stem(word) {
  if (!/^[a-z]+$/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

/** Searchable terms from a string: any script, lowercased, with stopwords
 * dropped and synonyms folded to one canonical word. */
function terms(text) {
  const found = new Set();
  for (const raw of String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    const word = stem(raw);
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    found.add(word);
    const canonical = SYNONYMS.get(word);
    if (canonical) found.add(canonical);
  }
  return found;
}

/** An article's fields, weighted: a title match matters more than a body one.
 * Every locale is searched, so a question asked in Arabic matches an Arabic
 * translation. */
function articleFields(article) {
  const fields = [
    { text: article.title, weight: 3 },
    { text: article.description, weight: 2 },
    { text: (article.body || []).join(" "), weight: 1 },
  ];
  for (const locale of Object.values(article.i18n || {})) {
    if (!locale) continue;
    if (locale.title) fields.push({ text: locale.title, weight: 3 });
    if (locale.description) fields.push({ text: locale.description, weight: 2 });
    if (Array.isArray(locale.body)) fields.push({ text: locale.body.join(" "), weight: 1 });
  }
  return fields;
}

function scoreArticle(article, questionTerms) {
  const articleTerms = new Set();
  let score = 0;
  for (const { text, weight } of articleFields(article)) {
    for (const term of terms(text)) {
      if (articleTerms.has(term)) continue;
      articleTerms.add(term);
      if (questionTerms.has(term)) score += weight;
    }
  }
  return score;
}

/** The published Green Hub articles most relevant to a question, best first. */
async function selectKnowledge(question, { limit = MAX_SOURCES } = {}) {
  const questionTerms = terms(question);
  if (!questionTerms.size) return [];

  const articles = await greenHubModel.list();
  return articles
    .map((article) => ({ article, score: scoreArticle(article, questionTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.article);
}

/** Catalog rows for any plant the question names ("tomato", "basil", ...). */
async function mentionedPlants(question, { limit = MAX_PLANTS } = {}) {
  const questionTerms = terms(question);
  if (!questionTerms.size) return [];

  const catalog = await catalogModel.listActive();
  return catalog
    .filter((plant) => {
      const names = [plant.slug, plant.name, plant.i18n && plant.i18n.ar && plant.i18n.ar.name, plant.i18n && plant.i18n.ku && plant.i18n.ku.name];
      return names.some((name) => {
        if (!name) return false;
        for (const term of terms(name)) if (questionTerms.has(term)) return true;
        return false;
      });
    })
    .slice(0, limit);
}

/** The CONTEXT block the model is told to answer from. */
function groundingContext({ knowledge, plants, conditions, memberPlants }) {
  const parts = [];

  if (knowledge.length) {
    parts.push(
      "GREENOMY GUIDES (our own researched content — prefer this over general knowledge):\n" +
        knowledge.map((a) => `## ${a.title}\n${a.description}\n${(a.body || []).join("\n")}`).join("\n\n")
    );
  }

  if (plants.length) {
    parts.push(
      "PLANT CATALOG FACTS:\n" +
        plants
          .map(
            (p) =>
              `- ${p.name}: ${p.days_to_harvest} days to harvest, ${p.difficulty} difficulty, ` +
              `${p.sun} sun, ${p.water} water, ${p.indoor ? "indoor " : ""}${p.outdoor ? "outdoor" : ""}` +
              `${p.notes ? `. ${p.notes}` : ""}`
          )
          .join("\n")
    );
  }

  if (conditions) {
    parts.push(
      `CURRENT CONDITIONS: climate ${conditions.climate}, season ${conditions.season}, month ${conditions.month}` +
        (conditions.city ? `, at ${conditions.city}` : "") +
        (conditions.approximate ? " (approximate — from the climate table)" : "")
    );
  }

  if (memberPlants.length) {
    parts.push(
      "WHAT THIS MEMBER IS GROWING:\n" +
        memberPlants
          .map((p) => `- ${p.plant_type} (stage: ${p.stage}${p.location ? `, at ${p.location}` : ""})`)
          .join("\n")
    );
  }

  return parts.join("\n\n");
}

/** A per-record translation, falling back to the English base — the same idea
 * as `localized()` in language.js. */
function localizedField(article, field, lang) {
  const translation = lang && article.i18n && article.i18n[lang];
  return (translation && translation[field]) || article[field];
}

const FALLBACK_MAX_CHARS = 700;

/** When the model cannot answer — no key, a spent daily quota, an outage — the
 * backend answers from the guide it retrieved, so the feature still works. It is
 * labelled as a guide excerpt rather than passed off as a model reply. */
function guideAnswer(article, lang) {
  if (!article) return null;

  const description = localizedField(article, "description", lang);
  const body = localizedField(article, "body", lang);
  const parts = [description, ...(Array.isArray(body) ? body : [body])].filter(Boolean);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const trimmed =
    text.length > FALLBACK_MAX_CHARS ? `${text.slice(0, FALLBACK_MAX_CHARS).replace(/\s+\S*$/, "")}…` : text;
  return `${trimmed}\n\n— ${localizedField(article, "title", lang)}`;
}

/** POST /api/ai/identify — read the species from an uploaded photo. */
exports.identify = async (req, res) => {
  const { imageUrl } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

  const reply = await ai.chat({
    messages: [
      { role: "system", content: "You identify plants from photos. Reply with JSON only." },
      { role: "user", content: ai.userContent(IDENTIFY_PROMPT, imageUrl) },
    ],
    maxTokens: 1000,
  });

  const parsed = ai.parseJson(reply);
  const confidence = Number(parsed.confidence);

  res.json({
    plantType: typeof parsed.plantType === "string" ? parsed.plantType.trim().slice(0, 60) : "",
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    alternatives: Array.isArray(parsed.alternatives)
      ? parsed.alternatives.filter((a) => typeof a === "string").slice(0, 3).map((a) => a.slice(0, 60))
      : [],
  });
};

/** POST /api/ai/assistant — answer a gardening question from Greenomy's own
 * content, with the member's garden and their local conditions for context. */
exports.assistant = async (req, res) => {
  const { message, lang } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  // requireAuth only puts { id, role } on req.user, so the member is loaded for
  // their city (which drives the conditions shown below).
  const user = await userModel.findById(req.user.id);
  const [memberPlants, conditions, knowledge, plants] = await Promise.all([
    plantModel.listByUser(req.user.id),
    weather.getConditions(user ? user.city : null),
    selectKnowledge(message),
    mentionedPlants(message),
  ]);

  const context = groundingContext({ knowledge, plants, conditions, memberPlants });

  let reply;
  let answeredBy = "ai";
  try {
    reply = await ai.chat({
      messages: [
        {
          role: "system",
          content: [
            "You are Greenomy's gardening assistant: practical, encouraging and concise.",
            "Answer ONLY from the CONTEXT below — it is Greenomy's own researched content and the member's own garden.",
            "If the CONTEXT does not cover the question, say briefly that you don't have that information yet and point at the closest topic it does cover. Never invent harvest times, dates, dosages or plant names.",
            "Answer in 2-4 short sentences. If the question is unrelated to plants, gardening or sustainability, say so briefly and steer back.",
            "",
            "CONTEXT:",
            context || "(no matching Greenomy content was found for this question)",
          ].join("\n"),
        },
        { role: "user", content: message.slice(0, MAX_MESSAGE_LENGTH) },
      ],
      maxTokens: 2000,
    });
  } catch (err) {
    // No key, a spent daily quota or a provider outage must not leave a member
    // with nothing: if we hold content for this question, answer from it.
    const fromGuides = guideAnswer(knowledge[0], lang);
    if (!fromGuides) throw err;
    console.warn(`Assistant answering from our own guides instead — ${err.message}`);
    reply = fromGuides;
    answeredBy = "guide";
  }

  // The slugs of the guides that grounded this answer, for the UI to link.
  res.json({ reply, sources: knowledge.map((a) => a.slug), answeredBy });
};

// Exported for tests.
exports._selectKnowledge = selectKnowledge;
exports._mentionedPlants = mentionedPlants;
exports._terms = terms;
