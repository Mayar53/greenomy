// services/continuity.service.js — does this photo plausibly continue the SAME
// plant's journey?
//
// The second question the audit asked for. Plant identification answers "is this
// a tomato?"; it cannot answer "is this the tomato this member has been
// photographing?" — an internet photo of a tomato passes the first and fails the
// second. This service answers the second with the evidence we actually have:
// how close the new frame is to the member's OWN earlier photos of this plant.
//
// Two deliberate limits:
//
//   * it is a SIGNAL, never a verdict. A seedling and a fruiting plant of the
//     same plant look nothing alike, so a large distance is normal. Only a
//     distance so large that the images are essentially unrelated raises a
//     flag, and that flag sends the submission to a human — it never rejects.
//   * it compares against this member's own history for this one plant. Reuse
//     across plantings or across accounts is duplicate.service's job.
const verificationModel = require("../models/verification.model");
const { hammingDistance } = require("./image.service");

// Bits of 64. Conservative on purpose: below this the frames share structure
// (same pot, same corner, same leaves at different ages). Above it they are
// close to unrelated, which is worth a human look — not a rejection.
const FAR_DISTANCE = Number(process.env.CONTINUITY_FAR_DISTANCE || 30);
const HISTORY_LIMIT = Number(process.env.CONTINUITY_HISTORY_LIMIT || 40);

/**
 * @returns {Promise<{status: 'first'|'consistent'|'inconsistent', distance: number|null, compared: number}>}
 *   'first'     no earlier photo of this plant — nothing to compare against
 *   'consistent' the closest earlier frame is within FAR_DISTANCE (or we had no
 *               usable hashes, in which case we do NOT accuse)
 *   'inconsistent' every earlier frame is far away: flagged for review
 */
async function assess({ userId, plantId, analysis, excludeVerificationId = null }) {
  const earlier = await verificationModel.hashesForPlant(userId, plantId, {
    limit: HISTORY_LIMIT,
    excludeVerificationId,
  });
  if (!earlier.length) return { status: "first", distance: null, compared: 0 };

  let closest = Infinity;
  for (const row of earlier) {
    for (const [mine, theirs] of [
      [analysis.phash, row.phash],
      [analysis.dhash, row.dhash],
      [analysis.ahash, row.ahash],
    ]) {
      const distance = hammingDistance(mine, theirs);
      if (Number.isFinite(distance) && distance < closest) closest = distance;
    }
  }

  // No usable hashes on either side: say so rather than implying a judgement.
  if (!Number.isFinite(closest)) return { status: "consistent", distance: null, compared: earlier.length };

  return {
    status: closest > FAR_DISTANCE ? "inconsistent" : "consistent",
    distance: closest,
    compared: earlier.length,
  };
}

module.exports = { assess, FAR_DISTANCE, HISTORY_LIMIT };
