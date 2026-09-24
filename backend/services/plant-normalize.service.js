// services/plant-normalize.service.js — one place that turns the many names a
// member might use into a canonical term.
//
// This is deliberately NOT an LLM and NOT embeddings: the catalog is small
// enough (a few hundred plants) that deterministic, testable text folding beats
// a vector store. It is the single implementation used by the assistant's
// retrieval, the catalog search and the `plants.json` seeder, so a name folds
// the same way everywhere.
//
// Covers English, Modern Standard Arabic, Iraqi Arabic and Kurdish (Sorani),
// including the letter-form and definite-article variations each script uses.

/** Words that describe the question rather than the subject. Checked before
 * and after stemming, in every supported language. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "do", "does",
  "did", "how", "what", "when", "where", "why", "which", "my", "i", "you", "me", "it", "its",
  "this", "that", "these", "those", "with", "can", "should", "would", "be", "at", "from", "if",
  "not", "no", "have", "has", "get", "got", "need", "want", "please", "about", "much", "many",
  // MSA / Iraqi Arabic
  "في", "من", "على", "إلى", "الي", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "هل",
  "ما", "ماذا", "كيف", "متى", "لماذا", "أين", "اين", "أنا", "انا", "أنت", "انت", "هو", "هي", "أو",
  "او", "لا", "إذا", "اذا", "كان", "عندي", "لدي", "شنو", "شلون", "ليش", "وين", "هواية", "چي", "چان",
  "اكو", "ماكو", "اريد", "أريد", "اني", "اني", "هسه", "هسە",
  // Kurdish (Sorani)
  "لە", "بۆ", "چۆن", "کەنگی", "بۆچی", "کوێ", "ئەم", "ئەو", "من", "تۆ", "بێ", "لەگەڵ", "نە", "چی",
  "چۆنیەتی", "بە", "سەر", "لەو",
]);

// Word families that should reach each other. A question about "irrigation"
// must find an article that only ever says "water". Iraqi/Kurdish gardening
// vocabulary is folded in here: مي (Iraqi) and ئاو (Kurdish) both reach water,
// تراب reaches soil, سماد/زبل reach fertilizer, شتلة/نەمام reach seedling.
const SYNONYM_GROUPS = [
  ["water", "watering", "watered", "irrigate", "irrigation", "moisture", "wet", "dry", "drought",
    "سقي", "اسقي", "سقاية", "يسقي", "نسقي", "سقى", "ري", "ماء", "موية", "مي", "عطش", "ئاو", "ئاودان",
    "تینووی"],
  ["soil", "earth", "ground", "loam", "compost", "تربة", "تراب", "طينة", "خاک", "زەوی", "قوڕ"],
  ["fertilizer", "fertiliser", "fertilize", "nutrient", "manure", "npk", "سماد", "زبل", "سماد عضوي",
    "تسميد", "غذاء", "پەین", "پیت", "سەپاندن"],
  ["seed", "seeds", "sowing", "sow", "sown", "seedling", "seedlings", "sprout", "germinate",
    "germination", "save", "saving", "saved", "storage", "storing", "fermentation", "ferment",
    "winnow", "thresh", "بذور", "بذرة", "شتلة", "شتلات", "غراسة", "حفظ", "تخزين", "تۆو", "نەمام",
    "پاراستن", "ڕواندن"],
  ["climate", "weather", "temperature", "مناخ", "طقس", "جو", "ئاووهەوا", "کەشوهەوا", "گەرما"],
  ["season", "seasons", "موسم", "مواسم", "وەرز", "وەرزەکان"],
  ["frost", "freeze", "freezing", "cold", "صقيع", "برد", "برودة", "بەستەڵەک", "سەرما", "سارد"],
  ["heat", "hot", "summer", "حرارة", "حار", "صيف", "گەرمی", "هاوین", "گەرم"],
  ["sand", "sandy", "رمل", "رملية", "لمی", "لم"],
  ["salt", "saline", "salinity", "ملح", "ملوحة", "مالحة", "خوێ", "سوێر"],
  ["container", "pot", "pots", "balcony", "planter", "أصص", "اصيص", "وعاء", "شرفة", "قاپ", "بەلکۆن", "گوڵدان"],
  ["pest", "insect", "insects", "aphid", "aphids", "whitefly", "mite", "mites", "grub", "worm",
    "حشرات", "آفات", "حشرة", "دودة", "ئافت", "مێشوولە", "کرم"],
  ["disease", "fungus", "fungal", "mildew", "rot", "blight", "مرض", "فطر", "تعفن", "ذبول", "نەخۆشی", "کەڵەکە"],
  ["yellow", "yellowing", "pale", "chlorosis", "اصفرار", "شحوب", "أصفر", "زەرد"],
  ["wilt", "wilting", "wilted", "droop", "drooping", "limp", "ذبول", "ذابل", "ڕەنجور", "شۆڕ"],
  ["sun", "sunlight", "sunburn", "scorch", "scorched", "shade", "shady", "شمس", "حروق", "ظل", "ئفتاب",
    "خۆر", "سێبەر"],
  ["root", "roots", "جذور", "جذر", "ڕەگ", "ڕەگەکان"],
  ["harvest", "pick", "picking", "reap", "حصد", "حصاد", "جني", "قطف", "بەرهەم", "کۆکردنەوە"],
  // NOTE: deliberately no "plant"/"planting" here — folding them would make
  // every *-plant slug match any question about growing. The original
  // vocabulary never had such a group; only the additive terms are new.
  ["grow", "growing", "cultivate", "cultivation", "زراعة", "نمو", "شتل", "چاندن", "گەشە"],
  ["prune", "pruning", "trim", "cutting", "تقليم", "قص", "قلم", "هەڵبڕین"],
  ["flower", "flowering", "bloom", "blossom", "fruit", "fruiting", "زهر", "إزهار", "ثمر", "ثمار",
    "گەڵا", "گوڵ", "بەرهەم"],
];

// Colloquial Arabic and Kurdish names mapped to the English word, so a question
// phrased locally still matches both the catalog row and the English guides.
// Keys are folded through the same letter unification as lookups (see below).
const PLANT_ALIASES = {
  // tomato
  "طماطم": "tomato", "طماطة": "tomato", "بندورة": "tomato", "تماتة": "tomato",
  "تەماتە": "tomato", "تەماته": "tomato", "تماته": "tomato",
  // cucumber
  "خيار": "cucumber", "خەیار": "cucumber",
  // zucchini / courgette
  "كوسة": "zucchini", "كوسا": "zucchini", "كوسى": "zucchini", "کۆسا": "zucchini", "کەلەک": "zucchini",
  // pumpkin / squash
  "يقطين": "pumpkin", "قرع": "pumpkin", "کەدوو": "pumpkin", "کادوو": "pumpkin",
  // eggplant / aubergine
  "باذنجان": "eggplant", "باذنجانة": "eggplant", "بادنجان": "eggplant", "بێنجان": "eggplant",
  // pepper
  "فلفل": "pepper", "فليفلة": "pepper", "بیبەر": "pepper",
  // onion / garlic
  "بصل": "onion", "بيقەز": "onion", "پیاز": "onion", "ثوم": "garlic", "سیر": "garlic",
  "توم": "garlic", "سير": "garlic",
  // leafy
  "خس": "lettuce", "کاهوو": "lettuce", "سبانخ": "spinach", "ئیسپاناخ": "spinach",
  "ملوخية": "mallow", "جرجير": "arugula", "روكا": "arugula", "بقدونس": "parsley", "معدنوس": "parsley",
  "مەعدەنۆس": "parsley", "كزبرة": "coriander", "کەشنیز": "coriander", "شبت": "dill", "شەبەت": "dill",
  "ريحان": "basil", "حبق": "basil", "ڕەیحان": "basil", "نعنع": "mint", "نعناع": "mint",
  "نەعناع": "mint", "زعتر": "thyme", "زەعتەر": "thyme", "إكليل الجبل": "rosemary", "روزماري": "rosemary",
  "ڕۆزماری": "rosemary",
  // root
  "جزر": "carrot", "گێزەر": "carrot", "فجل": "radish", "تورپ": "radish", "شمندر": "beetroot",
  "لفت": "turnip", "بطاطا": "potato", "پەتاتە": "potato",
  // fruit trees
  "ليمون": "lemon", "لیمۆ": "lemon", "برتقال": "orange", "برتقان": "orange", "پرتەقاڵ": "orange",
  "تين": "fig", "هەنجیر": "fig", "زيتون": "olive", "زەیتوون": "olive", "رمان": "pomegranate",
  "هەنار": "pomegranate", "عنب": "grape", "ترێ": "grape", "مشمش": "apricot", "قەیسی": "apricot",
  "تفاح": "apple", "سێو": "apple", "خوخ": "peach", "قۆخ": "peach",
  // houseplants
  "صبار": "aloe", "ألوفيرا": "aloe", "بوتس": "pothos", "پۆتۆس": "pothos", "ثعبان": "snake",
  "ثیران": "snake", "الحية": "snake", "زنبق": "lily", "مونستيرا": "monstera", "مۆنستێرا": "monstera",
  // other
  "فراولة": "strawberry", "فڕاوەڵە": "strawberry", "بامية": "okra", "بامیە": "okra",
  "باقلاء": "broad-bean", "بازلاء": "pea", "باقڵا": "pea", "ذرة": "corn", "گەنم": "wheat",
};

/** Unifies the letter forms that vary between writers of Arabic script, so
 * "طماطة" and "طماطه" are the same word. Applied to stored aliases AND to
 * lookups, which is what makes matching reliable. */
function unifyArabic(text) {
  return String(text || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // tashkeel + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/ک/g, "ك") // Persian/Kurdish kaf -> Arabic kaf
    .replace(/ی/g, "ي"); // Persian yeh -> Arabic yeh
}

// Fold one word through the synonym groups, then the plant aliases. Both maps
// are keyed by the UNIFIED form so a lookup only needs one normalisation pass.
const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  const canonical = unifyArabic(group[0]);
  for (const word of group) SYNONYMS.set(unifyArabic(word), canonical);
}

const FOLDED_ALIASES = new Map();
for (const [alias, canonical] of Object.entries(PLANT_ALIASES)) {
  FOLDED_ALIASES.set(unifyArabic(alias), canonical);
}

/** A light English stem, so "tomatoes" meets "tomato" and "pots" meets "pot".
 * Non-Latin scripts are left alone. */
function stem(word) {
  if (!/^[a-z]+$/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

/** One word -> its canonical term, or the word itself. */
function foldWord(word) {
  return SYNONYMS.get(word) || FOLDED_ALIASES.get(word) || word;
}

/** Searchable terms from a string: any script, lowercased, letter-unified,
 * stopwords dropped and synonyms folded to one canonical word. A word and its
 * canonical are the same term, so a question never counts twice for one word. */
function terms(text) {
  const found = new Set();
  for (const raw of String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    const base = stem(unifyArabic(raw));
    // Stopwords are checked before and after folding, since stemming/unifying
    // can change a stopword into a non-stopword ("this" -> "thi").
    if (base.length < 2 || STOPWORDS.has(raw) || STOPWORDS.has(base)) continue;

    // Arabic writes the definite article onto the noun — "الطماطم" is "tomato" —
    // so the bare form is a term too.
    const variants = [base];
    if (base.startsWith("ال") && base.length > 3) variants.push(base.slice(2));

    for (const variant of variants) found.add(foldWord(variant));
  }
  return found;
}

/** Tokens for display/search, without synonym folding. */
function tokenize(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/** A single folded key for an alias or a query — used for exact alias lookup
 * and for the normalized_alias column. */
function normalizeAlias(text) {
  const unified = unifyArabic(String(text || "").trim().toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (unified.startsWith("ال") && unified.length > 3) return unified.slice(2).trim();
  return unified;
}

const KURDISH_LETTERS = /[\u06CE\u06C6\u0695\u06B5\u06D5]/; // ێ ۆ ڕ ڵ ە
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Best-effort language of a message: 'ku', 'ar' or 'en'. Kurdish-specific
 * letters win; otherwise any Arabic-script letter means Arabic. The client also
 * sends its own `lang`, which is preferred when present. */
function detectLanguage(text) {
  const value = String(text || "");
  if (KURDISH_LETTERS.test(value)) return "ku";
  if (ARABIC_SCRIPT.test(value)) return "ar";
  return "en";
}

/** Whether an alias already exists for a term, for tests/inspection. */
function isKnownTerm(word) {
  const base = stem(unifyArabic(word));
  return SYNONYMS.has(base) || FOLDED_ALIASES.has(base);
}

module.exports = {
  STOPWORDS,
  SYNONYM_GROUPS,
  PLANT_ALIASES,
  SYNONYMS,
  FOLDED_ALIASES,
  unifyArabic,
  stem,
  foldWord,
  terms,
  tokenize,
  normalizeAlias,
  detectLanguage,
  isKnownTerm,
};
