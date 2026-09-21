// services/verification-provider.js — pluggable AI verification abstraction.
// The rest of the app calls getVerificationProvider().score(...) and never
// talks to a specific AI vendor directly, so swapping providers or running
// a mock in development doesn't touch any controller code.

class MockVerificationProvider {
  // Development stand-in: returns a plausible-looking confidence score
  // without calling any external AI service.
  async score({ imageUrl }) {
    const confidence = 0.7 + Math.random() * 0.3; // 0.70–1.00
    return { confidence: Number(confidence.toFixed(2)), provider: "mock" };
  }
}

class AIVerificationProvider {
  // Production implementation: send the image to a real computer-vision /
  // AI verification API (configured via AI_VERIFICATION_API_KEY) and check
  // for visual evidence of green leaves, soil, a container, and a growing
  // plant in an appropriate context. Returns a 0–1 confidence score.
  async score({ imageUrl }) {
    if (!process.env.AI_VERIFICATION_API_KEY) {
      throw new Error("AI_VERIFICATION_API_KEY is not configured");
    }
    // TODO: integrate the chosen vision/AI provider here.
    throw new Error("AIVerificationProvider is not yet implemented");
  }
}

function getVerificationProvider() {
  return process.env.NODE_ENV === "production"
    ? new AIVerificationProvider()
    : new MockVerificationProvider();
}

module.exports = { getVerificationProvider, MockVerificationProvider, AIVerificationProvider };
