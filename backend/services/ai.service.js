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
  const primary = (process.env.AI_MODEL || DEFAULT_MODEL).trim();
  // A single model is not always available — providers shed load per model — so
  // a deploy can list stand-ins to try when the primary is overloaded.
  const fallbacks = (process.env.AI_FALLBACK_MODELS || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return {
    key,
    url: (process.env.AI_API_URL || DEFAULT_URL).trim().replace(/\/+$/, ""),
    model: primary,
    models: [primary, ...fallbacks.filter((name) => name !== primary)],
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

const isConfigured = () => Boolean(config().key);

// Providers shed load with these; a short retry usually gets through. Gemini's
// free tier answers 503 "high demand" often enough that this matters.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Provider problems are the caller's to fix (a bad key, a retired model, a
 * timeout), so they carry a 502 and a readable message instead of surfacing as
 * an opaque "Internal server error". */
function providerError(message, retryable = false, tryNextModel = false) {
  const err = new Error(message);
  err.status = 502;
  err.retryable = retryable;
  err.tryNextModel = tryNextModel;
  return err;
}

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
async function chatOnce({ messages, maxTokens = 400, temperature = 0, model: requestedModel }) {
  const { key, url, model: configuredModel, timeoutMs } = config();
  const model = requestedModel || configuredModel;
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
    // A timeout is not retried: it would just double the wait.
    throw providerError(
      err.name === "AbortError"
        ? `The AI request timed out after ${timeoutMs}ms`
        : `Could not reach the AI provider at ${url}: ${err.message}`,
      err.name !== "AbortError"
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`AI provider responded ${response.status}: ${detail.slice(0, 500)}`);

    // Capacity problems are not the caller's fault, so say so plainly rather
    // than echoing the provider's JSON at a member. A DAILY quota and a
    // momentary capacity spike need very different messages: telling someone
    // to "try again in a moment" when their daily allowance is gone is a lie.
    if (response.status === 429 || response.status === 503) {
      const dailyQuota = /PerDay/i.test(detail);
      if (dailyQuota) {
        throw providerError(
          "The free AI allowance for today is used up. It resets with a new day — or add billing to the AI provider, or set VERIFICATION_PROVIDER=heuristic to score photos without AI.",
          false, // retrying the same model cannot help a daily cap
          true // ...but the cap is per model, so a sibling model may still have room
        );
      }
      throw providerError("The AI provider is busy right now — please try again in a moment.", true);
    }

    // A 401/403 almost always means the key is wrong or belongs to another provider.
    const hint =
      response.status === 401 || response.status === 403
        ? " — check AI_API_KEY (and that AI_API_URL matches the provider the key came from)"
        : "";
    throw providerError(
      `The AI provider rejected the request (${response.status}${hint}).${detail ? ` ${detail.slice(0, 200)}` : ""}`,
      RETRYABLE_STATUSES.has(response.status)
    );
  }

  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content === "") {
    throw providerError(
      "The AI provider returned an empty response — the model may need a larger token budget, or the model name may be wrong."
    );
  }

  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("").trim();
  }
  return String(content).trim();
}

/**
 * A chat completion. Retries a briefly unavailable provider, then moves on to
 * the next configured model — providers overload one model at a time, so a
 * stand-in usually answers immediately. Retries only happen after a failed
 * call, so a successful (billable) call is never repeated.
 */
async function chat({ messages, maxTokens = 400, temperature = 0 }) {
  const attempts = Math.max(1, Number(process.env.AI_MAX_ATTEMPTS || 3));
  const models = config().models;
  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await chatOnce({ messages, maxTokens, temperature, model });
      } catch (err) {
        lastError = err;

        // A bad key or a retired model won't be fixed by another model name.
        if (!err.retryable && !err.tryNextModel) throw err;
        // A daily quota is per model, so don't waste attempts on this one.
        if (!err.retryable) break;
        if (attempt === attempts) break;

        const waitMs = 500 * 2 ** (attempt - 1);
        console.warn(`AI model ${model} unavailable (attempt ${attempt}/${attempts}) — retrying in ${waitMs}ms.`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    if (models.indexOf(model) < models.length - 1) {
      console.warn(`AI model ${model} is overloaded — trying the next model.`);
    }
  }

  throw lastError;
}

/** Pulls a JSON object out of a model reply, tolerating ```json fences and
 * any surrounding prose. */
function parseJson(text) {
  const withoutFences = String(text).replace(/```json/gi, "").replace(/```/g, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    console.error(`AI reply was not JSON: ${withoutFences.slice(0, 300)}`);
    throw providerError("The AI replied in an unexpected format — please try again.");
  }

  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    console.error(`AI reply was malformed JSON: ${withoutFences.slice(start, start + 300)}`);
    throw providerError("The AI replied in an unexpected format — please try again.");
  }
}

/** Builds a multimodal user message: a prompt plus one image. */
function userContent(prompt, imageUrl) {
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: imageUrl } },
  ];
}

module.exports = { chat, parseJson, userContent, isConfigured, config, AiNotConfiguredError };
