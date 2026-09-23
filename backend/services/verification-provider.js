// services/verification-provider.js — pluggable AI verification abstraction.
// The rest of the app calls getVerificationProvider().score(...) and never
// talks to a specific AI vendor directly, so swapping providers or running
// a mock in development doesn't touch any controller code.

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

class MockVerificationProvider {
  // Development stand-in: returns a plausible-looking confidence score
  // without calling any external AI service.
  async score({ imageUrl }) {
    const confidence = 0.7 + Math.random() * 0.3; // 0.70–1.00
    return { confidence: Number(confidence.toFixed(2)), provider: "mock", metrics: null };
  }
}

class HeuristicVerificationProvider {
  // Offline scorer: no external service and no API key. The client measures
  // the photo on a canvas and sends the numbers; scoring policy lives here.
  //
  //   greenRatio — share of pixels that read as foliage (0–1)
  //   sharpness  — mean luminance gradient; low values mean a blurry photo
  //   brightness — mean luminance (0–1)
  async score({ pixelStats }) {
    if (!pixelStats) {
      const confidence = 0.7 + Math.random() * 0.3;
      return { confidence: Number(confidence.toFixed(2)), provider: "mock", metrics: null };
    }

    const greenRatio = Number(pixelStats.greenRatio) || 0;
    const sharpness = Number(pixelStats.sharpness) || 0;
    const brightness = Number(pixelStats.brightness) || 0;

    const greenScore = clamp01((greenRatio - 0.08) / 0.35);
    const sharpScore = clamp01((sharpness - 5) / 20);
    const brightScore = clamp01(1 - Math.abs(brightness - 0.55) / 0.45);

    const confidence = 0.6 * greenScore + 0.2 * sharpScore + 0.2 * brightScore;
    return {
      confidence: Number(confidence.toFixed(2)),
      provider: "heuristic",
      metrics: {
        greenRatio: Number(greenRatio.toFixed(4)),
        sharpness: Number(sharpness.toFixed(2)),
        brightness: Number(brightness.toFixed(4)),
      },
    };
  }
}

const ai = require("./ai.service");

const VERIFY_SYSTEM_PROMPT =
  "You verify photos for a plant-growing challenge. Reply with JSON only — no prose, no code fences.";

const VERIFY_PROMPT = `Does this photo show a real, living plant being grown?
Look for leaves, stems, soil, a pot, a container or a growing space.
Reply with ONLY this JSON shape:
{"confidence": <number between 0 and 1>, "reason": "<one short sentence>"}
confidence is how certain you are that this is a genuine photo of a growing plant.`;

class AIVerificationProvider {
  // Sends the image to a vision model (see services/ai.service.js) and turns
  // its judgement into a 0–1 confidence score.
  async score({ imageUrl }) {
    if (!ai.isConfigured()) {
      throw new Error("AI_API_KEY is not configured");
    }

    const reply = await ai.chat({
      messages: [
        { role: "system", content: VERIFY_SYSTEM_PROMPT },
        { role: "user", content: ai.userContent(VERIFY_PROMPT, imageUrl) },
      ],
      maxTokens: 1000,
    });

    const parsed = ai.parseJson(reply);
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) {
      throw new Error("The AI reply contained no usable confidence");
    }

    return {
      confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(2)),
      provider: "ai",
      metrics: { reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : null },
    };
  }
}

function getVerificationProvider() {
  const configured = (process.env.VERIFICATION_PROVIDER || "").trim().toLowerCase();
  if (configured === "mock") return new MockVerificationProvider();
  if (configured === "ai") {
    if (ai.isConfigured()) return new AIVerificationProvider();
    console.warn(
      "VERIFICATION_PROVIDER=ai but no AI key is set — falling back to the heuristic scorer."
    );
    return new HeuristicVerificationProvider();
  }
  // Default: the offline heuristic scorer. The AI provider is only used when
  // explicitly selected and configured, so a deploy can never route
  // submissions into an unconfigured AI path by accident.
  return new HeuristicVerificationProvider();
}

module.exports = {
  getVerificationProvider,
  MockVerificationProvider,
  HeuristicVerificationProvider,
  AIVerificationProvider,
};
