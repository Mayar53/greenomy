// controllers/waitlist.controller.js
const waitlistModel = require("../models/waitlist.model");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.join = async (req, res) => {
  const { fullName, email, city, gardeningInterests } = req.body || {};
  if (!fullName || !email || !city) {
    return res.status(400).json({ error: "fullName, email, and city are required" });
  }
  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address" });
  }
  if (await waitlistModel.findByEmail(email)) {
    return res.status(409).json({ error: "This email is already on the waitlist" });
  }

  try {
    await waitlistModel.create({ fullName, email, city, gardeningInterests });
  } catch (err) {
    // Race between the check above and the insert: the unique index is the
    // authority, so a duplicate-key error is the same 409.
    if (err && err.code === "23505") {
      return res.status(409).json({ error: "This email is already on the waitlist" });
    }
    throw err;
  }

  res.status(201).json({ success: true });
};
