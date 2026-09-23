// services/ai.service.js — provider-agnostic AI client (text + vision).
//
// Speaks the OpenAI-compatible chat-completions API, which OpenAI, Google
// (Gemini's compatibility endpoint), OpenRouter, Groq, Together and a local
// Ollama all expose — so changing provider is configuration, not code.
//
// Configure with:
//   AI_API_KEY   required to enable any AI feature
//   AI_API_URL   default https://api.openai.com/v1
//   AI_MODEL     default gpt-4o-mini
//
// The key lives here, server-side only. It must never reach the browser.

const DEFAULT_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 30000;

function config() {
  // AI_VERIFICATION_API_KEY is still honoured: it predates this service.
  const key = (process.env.AI_API_KEY || process.env.AI_VERIFICATION_API_KEY || "").trim();
  return {
    key,
    url: (process.env.AI_API_URL || DEFAULT_URL).trim().replace(/\/+$/, ""),
    model: (process.env.AI_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

const isConfigured = () => Boolean(config().key);

/** Thrown when a feature needs AI but no key is set. Carries a 503 so the
 * central error handler turns it into a clear response. */
class AiNotConfiguredError extends Error {
  constructor() {
    super("AI features are not configured yet — set AI_API_KEY in backend/.env to enable them.");
    this.name = "AiNotConfiguredError";
    this.status = 503;
  }
}

/**
 * One chat completion. `messages` uses the OpenAI shape; for vision, a user
 * message's content is an array of {type:"text"} and {type:"image_url"} parts.
 */
async function chat({ messages, maxTokens = 400, temperature = 0 }) {
  const { key, url, model, timeoutMs } = config();
  if (!key) throw new AiNotConfiguredError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err.name === "AbortError" ? "The AI request timed out" : `AI request failed: ${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `AI provider responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content === "") {
    throw new Error("The AI provider returned an empty response");
  }

  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("").trim();
  }
  return String(content).trim();
}

/** Pulls a JSON object out of a model reply, tolerating ```json fences and
 * any surrounding prose. */
function parseJson(text) {
  const withoutFences = String(text).replace(/```json/gi, "").replace(/```/g, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("The AI reply was not JSON");
  }
  return JSON.parse(withoutFences.slice(start, end + 1));
}

/** Builds a multimodal user message: a prompt plus one image. */
function userContent(prompt, imageUrl) {
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: imageUrl } },
  ];
}

module.exports = { chat, parseJson, userContent, isConfigured, config, AiNotConfiguredError };
