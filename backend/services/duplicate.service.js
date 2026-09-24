// services/duplicate.service.js — is this photo one we have already seen?
//
// Two layers, both over the WHOLE verification_images table (every user), not
// just the submitter's own history:
//
//   exact  same sha256 — the identical bytes
//   near   perceptual hashes within a small Hamming distance — catches a
//          resized, recompressed, cropped or brightness-shifted copy
//
// A near match is reported, never auto-declared fraud: the caller marks the
// submission for review. A false "this is a duplicate" that rejects a genuine
// photo is worse than a duplicate that reaches a human.
const imageModel = require("../models/verification-image.model");
const { hammingDistance } = require("./image.service");

// Bits of Hamming distance still considered "the same picture". Small on
// purpose — 0 is identical, ~4 tolerates recompression, and raising it starts
// matching genuinely different photos of the same plant.
const NEAR_DISTANCE = Number(process.env.IMAGE_PHASH_DISTANCE || 4);
const SCAN_LIMIT = Number(process.env.IMAGE_DUPLICATE_SCAN_LIMIT || 2000);

/**
 * Looks the submitted hashes up against every stored image.
 * Returns { status, matches } where status is 'none' | 'exact' | 'near'.
 */
async function findDuplicates({ sha256, phash, dhash, ahash }) {
  const [exact, candidates] = await Promise.all([
    imageModel.findBySha256(sha256),
    imageModel.listHashes(SCAN_LIMIT),
  ]);

  if (exact.length) {
    return {
      status: "exact",
      matches: exact.map((image) => ({
        image_id: image.image_id,
        user_id: image.user_id,
        verification_id: image.verification_id,
        distance: 0,
      })),
    };
  }

  const near = [];
  for (const candidate of candidates) {
    if (candidate.sha256 === sha256) continue;

    const distances = [
      hammingDistance(phash, candidate.phash),
      hammingDistance(dhash, candidate.dhash),
      hammingDistance(ahash, candidate.ahash),
    ].filter((distance) => Number.isFinite(distance));
    if (!distances.length) continue;

    const best = Math.min(...distances);
    if (best <= NEAR_DISTANCE) {
      near.push({
        image_id: candidate.image_id,
        user_id: candidate.user_id,
        verification_id: candidate.verification_id,
        distance: best,
      });
    }
  }

  near.sort((a, b) => a.distance - b.distance);
  return { status: near.length ? "near" : "none", matches: near.slice(0, 5) };
}

module.exports = { findDuplicates, NEAR_DISTANCE, SCAN_LIMIT };
