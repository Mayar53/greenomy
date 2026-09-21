// controllers/verifications.controller.js
// Verification confidence >= 85% auto-approves; below that, it queues for
// admin review. The actual scoring is delegated to a swappable provider
// (see services/verification-provider.js) so the AI vendor isn't hardcoded.
const db = require("../database/mock-data");
const { getVerificationProvider } = require("../services/verification-provider");

const AUTO_APPROVE_THRESHOLD = 0.85;
const POINTS_PER_VERIFIED_PHOTO = 30;

exports.submit = async (req, res) => {
  const { plantId, imageUrl, gpsLat, gpsLong } = req.body || {};
  if (!plantId || !imageUrl) return res.status(400).json({ error: "plantId and imageUrl are required" });

  const plant = db.plants.find((p) => p.plant_id === plantId && p.user_id === req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });

  const provider = getVerificationProvider();
  const { confidence } = await provider.score({ imageUrl });

  const approval_status = confidence >= AUTO_APPROVE_THRESHOLD ? "approved" : "pending";

  const verification = {
    verification_id: `v_${Date.now()}`,
    plant_id: plantId,
    user_id: req.user.id,
    image_url: imageUrl,
    gps_lat: gpsLat ?? null,
    gps_long: gpsLong ?? null,
    captured_at: new Date().toISOString(),
    ai_confidence_score: confidence,
    approval_status,
    created_at: new Date().toISOString(),
  };
  db.verifications.push(verification);

  if (approval_status === "approved") {
    const user = db.users.find((u) => u.user_id === req.user.id);
    if (user) user.total_points += POINTS_PER_VERIFIED_PHOTO;
    db.pointTransactions.push({
      transaction_id: `t_${Date.now()}`,
      user_id: req.user.id,
      amount: POINTS_PER_VERIFIED_PHOTO,
      transaction_type: "verification_approved",
      reference_id: verification.verification_id,
      created_at: new Date().toISOString(),
    });
  }

  res.status(201).json(verification);
};

exports.getOne = (req, res) => {
  const v = db.verifications.find((v) => v.verification_id === req.params.id && v.user_id === req.user.id);
  if (!v) return res.status(404).json({ error: "Verification not found" });
  res.json(v);
};

exports.history = (req, res) => {
  res.json(db.verifications.filter((v) => v.user_id === req.user.id));
};
