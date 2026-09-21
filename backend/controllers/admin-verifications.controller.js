const db = require("../database/mock-data");

exports.queue = (req, res) => {
  res.json(db.verifications.filter((v) => v.approval_status === "pending"));
};

exports.approve = (req, res) => {
  const v = db.verifications.find((v) => v.verification_id === req.params.id);
  if (!v) return res.status(404).json({ error: "Verification not found" });
  v.approval_status = "approved";
  v.admin_reviewed_by = req.user.id;
  v.reviewed_at = new Date().toISOString();

  const user = db.users.find((u) => u.user_id === v.user_id);
  if (user) user.total_points += 30;
  db.pointTransactions.push({
    transaction_id: `t_${Date.now()}`,
    user_id: v.user_id,
    amount: 30,
    transaction_type: "verification_approved",
    reference_id: v.verification_id,
    created_at: new Date().toISOString(),
  });

  res.json(v);
};

exports.reject = (req, res) => {
  const v = db.verifications.find((v) => v.verification_id === req.params.id);
  if (!v) return res.status(404).json({ error: "Verification not found" });
  v.approval_status = "rejected";
  v.admin_reviewed_by = req.user.id;
  v.rejection_reason = (req.body && req.body.reason) || null;
  v.reviewed_at = new Date().toISOString();
  res.json(v);
};
