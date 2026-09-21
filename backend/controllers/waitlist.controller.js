const db = require("../database/mock-data");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.join = (req, res) => {
  const { fullName, email, city, gardeningInterests } = req.body || {};
  if (!fullName || !email || !city) {
    return res.status(400).json({ error: "fullName, email, and city are required" });
  }
  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address" });
  }
  if (db.waitlist.some((w) => w.email === email)) {
    return res.status(409).json({ error: "This email is already on the waitlist" });
  }

  const entry = {
    waitlist_id: `w_${Date.now()}`,
    full_name: fullName,
    email,
    city,
    gardening_interests: gardeningInterests || null,
    created_at: new Date().toISOString(),
  };
  db.waitlist.push(entry);
  res.status(201).json({ success: true });
};
