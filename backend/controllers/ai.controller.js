// controllers/ai.controller.js — the optional AI features: reading a plant from
// a photo, and a gardening assistant that knows what the member is growing.
//
// Both degrade predictably when no AI key is configured: AiNotConfiguredError
// carries a 503 and a message the UI can show, rather than failing obscurely.
const ai = require("../services/ai.service");
const plantModel = require("../models/plant.model");

const IDENTIFY_PROMPT = `Identify the plant in this photo.
Reply with ONLY this JSON shape:
{"plantType": "<common name, e.g. Tomato>", "confidence": <0-1>, "alternatives": ["<name>", "<name>"]}
If you cannot identify a plant, use plantType "" and confidence 0.`;

const MAX_MESSAGE_LENGTH = 1000;

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

/** POST /api/ai/assistant — answer a gardening question with the member's own
 * plants as context, so the advice is about their garden. */
exports.assistant = async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  // Give the model something concrete to work with.
  const plants = await plantModel.listByUser(req.user.id);
  const context = plants.length
    ? `They are growing: ${plants
        .map((p) => `${p.plant_type} (stage: ${p.stage}${p.location ? `, at ${p.location}` : ""})`)
        .join("; ")}.`
    : "They have not planted anything yet.";

  const reply = await ai.chat({
    messages: [
      {
        role: "system",
        content: [
          "You are Greenomy's gardening assistant: practical, encouraging and concise.",
          "Answer in 2-4 short sentences. If the question is unrelated to plants, gardening or sustainability, say so briefly and steer back.",
          context,
        ].join(" "),
      },
      { role: "user", content: message.slice(0, MAX_MESSAGE_LENGTH) },
    ],
    maxTokens: 2000,
  });

  res.json({ reply });
};
