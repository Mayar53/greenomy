// app.js — controller for the signed-in app pages: wallet.html and garden.html.
// One module drives both; a page's root container decides what gets rendered.
// Data comes from the service layer (plants/verifications) and the shared API
// client (wallet, which is account-scoped like the /users/me calls in onboarding.js).
import { requireAuthOrRedirect, logout, getCurrentUser } from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { listMyPlants, listJourneys } from "./serviseplant.js";
import { listVerifications } from "./verifyservice.js";
import { t, localized, currentLanguage, stageLabel } from "./language.js";
import { getGreenHubArticles } from "./contentservice.js";
import { iconMarkup, plantIcon, SYMBOLS } from "./icons.js";

// Where a shared story image is 1080x1920 (9:16), the size Instagram wants.
// CO2_KG_PER_PLANT mirrors the server constant (users.controller getMyImpact),
// so the number on the card matches what the API reports.
const STORY_W = 1080;
const STORY_H = 1920;
const CO2_KG_PER_PLANT = 1.8;
const SITE_URL = "greenomy.app";
const CONTACT_EMAIL = "Greenomyofficial@gmail.com";
const SHARE_FILE = "greenomy-impact.png";

const state = {
  wallet: null,
  walletError: false,
  transactions: [],
  notifications: [],
  notificationsLoaded: false,
  plants: [],
  verifications: [],
  journeys: [],
  gardenLoaded: false,
  gardenError: false,
};

const STAGE_KEYS = { seed: "garden.stageSeed", sprout: "garden.stageSprout", plant: "garden.stagePlant" };
const TX_KEYS = {
  verification_approved: "wallet.txVerification",
  reward_earned: "wallet.txRewardEarned",
  reward_redeemed: "wallet.txReward",
};
const NOTIFICATION_KEYS = {
  verification_approved: "notifications.verification_approved",
  verification_pending: "notifications.verification_pending",
  verification_rejected: "notifications.verification_rejected",
  reward_redeemed: "notifications.reward_redeemed",
};
const VERDICT_KEYS = {
  approved: "garden.verificationApproved",
  pending: "garden.verificationPending",
  rejected: "garden.verificationRejected",
  none: "garden.neverVerified",
};

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function isAuthError(err) {
  return err instanceof ApiError && err.status === 401;
}

function gotoLogin() {
  window.location.href = "login.html";
}

/* ---------------------------------------------------------------- Wallet */
function renderWallet() {
  const summary = document.querySelector("[data-wallet-summary]");
  if (!summary) return;

  if (state.walletError) {
    summary.innerHTML = `<div class="error-state">${escapeHtml(t("wallet.loadError"))}</div>`;
    const history = document.querySelector("[data-wallet-history]");
    if (history) history.innerHTML = "";
    return;
  }
  if (!state.wallet) {
    summary.innerHTML = `<div class="loading-state">${iconMarkup("trophy")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }

  const { currentPoints, totalEarned, totalSpent } = state.wallet;
  summary.innerHTML = `
    <div class="card wallet-stat">
      <strong class="is-balance">${Number(currentPoints || 0).toLocaleString()}</strong>
      <span>${escapeHtml(t("wallet.balance"))}</span>
    </div>
    <div class="card wallet-stat">
      <strong>${Number(totalEarned || 0).toLocaleString()}</strong>
      <span>${escapeHtml(t("wallet.earned"))}</span>
    </div>
    <div class="card wallet-stat">
      <strong>${Number(totalSpent || 0).toLocaleString()}</strong>
      <span>${escapeHtml(t("wallet.spent"))}</span>
    </div>
  `;
  renderHistory();
}

function txItemHTML(tx) {
  const positive = tx.amount >= 0;
  const label = t(TX_KEYS[tx.transaction_type] || "wallet.txAdjustment");
  const amount = Number(Math.abs(tx.amount || 0)).toLocaleString();
  return `
    <div class="tx-item">
      <div>
        <span class="tx-label">${escapeHtml(label)}</span>
        <span class="tx-date">${escapeHtml(fmtDate(tx.created_at))}</span>
      </div>
      <span class="tx-amount ${positive ? "is-plus" : "is-minus"}">${positive ? "+" : "−"}${amount}</span>
    </div>
  `;
}

function renderHistory() {
  const host = document.querySelector("[data-wallet-history]");
  if (!host) return;

  if (!state.transactions.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("trophy")}${escapeHtml(t("wallet.empty"))}</div>`;
    return;
  }

  const rows = [...state.transactions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  host.innerHTML = `<div class="tx-list">${rows.map(txItemHTML).join("")}</div>`;
}

/* --------------------------------------------------------- Notifications */
/** The stored title/message are English; `type` is the localisable key. */
function notificationItemHTML(notification) {
  const key = NOTIFICATION_KEYS[notification.type];
  return `
    <div class="tx-item">
      <div class="history-main">
        <span class="tx-label">${escapeHtml(key ? t(key) : notification.title)}</span>
        <span class="tx-date">${escapeHtml(notification.message || "")} · ${escapeHtml(fmtDate(notification.created_at))}</span>
      </div>
      ${notification.is_read ? "" : `<span class="status-badge is-pending">${escapeHtml(t("notifications.unread"))}</span>`}
    </div>
  `;
}

function renderNotifications() {
  const host = document.querySelector("[data-notifications]");
  if (!host) return;

  if (!state.notificationsLoaded) {
    host.innerHTML = `<div class="loading-state">${iconMarkup("bell")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.notifications.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("bell")}${escapeHtml(t("notifications.empty"))}</div>`;
    return;
  }

  const unread = state.notifications.filter((n) => !n.is_read).length;
  const banner = unread
    ? `<div class="app-actions">
         <button type="button" class="btn btn-secondary" data-mark-all-read>${escapeHtml(t("notifications.markAll"))}</button>
         <span class="form-note">${unread} ${escapeHtml(t("notifications.unread"))}</span>
       </div>`
    : "";

  host.innerHTML = `${banner}<div class="tx-list">${state.notifications.map(notificationItemHTML).join("")}</div>`;
}

/* ---------------------------------------------------------------- Garden */
function latestVerification(plantId) {
  const forPlant = state.verifications.filter((v) => v.plant_id === plantId);
  if (!forPlant.length) return null;
  return forPlant.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

function plantCardHTML(plant) {
  const verification = latestVerification(plant.plant_id);
  const status = verification ? verification.approval_status : "none";
  const stage = t(STAGE_KEYS[plant.stage] || "garden.stageSeed");

  return `
    <article class="card plant-card">
      <div class="plant-card-top">
        <div class="plant-card-icon" aria-hidden="true">${iconMarkup(plantIcon(plant))}</div>
        <div class="plant-card-id">
          <strong>${escapeHtml(plant.plant_name || plant.plant_type)}</strong>
          <p class="plant-card-loc">${escapeHtml(plant.location || t("garden.notSet"))}</p>
        </div>
        <span class="status-badge is-${status}">${escapeHtml(t(VERDICT_KEYS[status] || "garden.neverVerified"))}</span>
      </div>
      <div class="plant-card-meta">
        <span>${escapeHtml(t("garden.stage"))}: ${escapeHtml(stage)}</span>
        <span>${escapeHtml(t("garden.planted"))}: ${escapeHtml(fmtDate(plant.planting_date))}</span>
      </div>
      <a href="camera.html" class="btn btn-secondary btn-block">${escapeHtml(t("garden.verify"))}</a>
    </article>
  `;
}

function renderGarden() {
  const grid = document.querySelector("[data-garden-grid]");
  if (!grid) return;

  if (state.gardenError) {
    grid.innerHTML = `<div class="error-state">${escapeHtml(t("garden.loadError"))}</div>`;
    return;
  }
  if (!state.gardenLoaded) {
    grid.innerHTML = `<div class="loading-state">${iconMarkup("sprout")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.plants.length) {
    grid.innerHTML = `
      <div class="empty-state">
        ${iconMarkup("sprout")}
        <p>${escapeHtml(t("garden.empty"))}</p>
        <a href="new-seed.html" class="btn btn-primary">${escapeHtml(t("garden.emptyCta"))}</a>
        <p class="form-note" style="margin-top: 10px;">${escapeHtml(t("garden.emptyNote"))}</p>
      </div>`;
    return;
  }

  grid.innerHTML = state.plants.map(plantCardHTML).join("");
}

function historyItemHTML(verification) {
  const plant = state.plants.find((p) => p.plant_id === verification.plant_id);
  const name = plant ? plant.plant_name || plant.plant_type : t("garden.title");
  const status = verification.approval_status || "none";
  const score = Math.round((verification.ai_confidence_score || 0) * 100);
  const thumb = verification.image_url
    ? `<img class="history-thumb" src="${escapeHtml(verification.image_url)}" alt="" />`
    : `<div class="history-thumb" aria-hidden="true"></div>`;

  return `
    <div class="tx-item history-item">
      ${thumb}
      <div class="history-main">
        <span class="tx-label">${escapeHtml(name)}</span>
        <span class="tx-date">${escapeHtml(fmtDate(verification.created_at))} · ${score}%</span>
      </div>
      <span class="status-badge is-${status}">${escapeHtml(t(VERDICT_KEYS[status] || "garden.neverVerified"))}</span>
    </div>
  `;
}

function renderVerificationHistory() {
  const host = document.querySelector("[data-verification-history]");
  if (!host) return;

  if (state.gardenError) {
    host.innerHTML = "";
    return;
  }
  if (!state.gardenLoaded) {
    host.innerHTML = `<div class="loading-state">${iconMarkup("camera")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.verifications.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("camera")}${escapeHtml(t("garden.historyEmpty"))}</div>`;
    return;
  }

  const rows = [...state.verifications].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  host.innerHTML = `<div class="tx-list">${rows.map(historyItemHTML).join("")}</div>`;
}

/* ------------------------------------------------------------- Journeys */
// Journey cards (with their milestones, rewards and care actions) are rendered
// by engagement.js from /api/journeys, which now carries the plant-specific
// reward data. app.js still loads journeys for the share card's milestone count.

function renderAll() {
  renderWallet();
  renderGarden();
  renderVerificationHistory();
  renderNotifications();
}

/* ------------------------------------------------------- Share card (story) */
// A 1080x1920 Instagram-story image of the member's planting milestones, plus
// the brand. Composed with the Canvas API, so nothing is uploaded anywhere and
// it works with no build step and no third-party library. Colours and the logo
// come from style.css and the header, so the card looks like the product.
// `subject` is the journey being shared, or null for the whole garden, so one
// modal serves both cards.
const shareModal = {
  root: null,
  title: null,
  lead: null,
  preview: null,
  status: null,
  canvas: null,
  subject: null,
  filename: SHARE_FILE,
};

/** A filename safe on every platform, e.g. "greenomy-tomato.png". */
function shareFilename(subject) {
  if (!subject) return SHARE_FILE;
  const slug = String(subject.plant_type || "plant")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `greenomy-${slug || "plant"}.png`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** One icon from the app's own sprite, drawn as an image — so the card uses the
 * same icon set as the UI instead of an emoji. */
function iconImage(name, size, color) {
  const body = SYMBOLS[name] || SYMBOLS.leaf;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Text on the card. Centred by default (so it reads the same in LTR and RTL);
 * the plant card's milestone rows pass `align` to sit on the correct side. */
function drawText(ctx, text, x, y, { size, weight = 700, color = "#FFFFFF", font, letterSpacing = 0, align = "center" }) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${letterSpacing}px`;
  ctx.fillText(String(text), x, y);
  ctx.restore();
}

/** Trims to fit a width, so a long list of plant names can't overflow. */
function fitText(ctx, text, maxWidth, font, size, weight = 600) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  ctx.restore();
  return out === text ? text : `${out}…`;
}

/** The webfont the page itself is set in, for the canvases. It mirrors the
 * per-language choice the stylesheet makes (`--font-en` / `--font-ar` /
 * `--font-ku`), so an exported card is drawn in the font the page uses.
 * Kurdish needs its own stack: Cairo has no Kurdish letters, so they fell back
 * to a system font and a Kurdish word came out in two typefaces. */
function canvasFont() {
  const lang = currentLanguage();
  if (lang === "ku") return "'Noto Sans Arabic', sans-serif";
  if (lang === "ar") return "'Cairo', sans-serif";
  return "'Inter', sans-serif";
}

function shareCardData() {
  const user = getCurrentUser() || {};
  const rtl = ["ar", "ku"].includes(currentLanguage());
  const milestones = state.journeys.reduce(
    (acc, journey) => {
      const list = journey.milestones || [];
      acc.total += list.length;
      acc.done += list.filter((milestone) => milestone.completed_at).length;
      return acc;
    },
    { done: 0, total: 0 }
  );

  return {
    font: canvasFont(),
    member: [user.fullName, user.city].filter(Boolean).join(" · "),
    plants: state.plants.length,
    verified: state.verifications.filter((v) => v.approval_status === "approved").length,
    co2: Math.round(state.plants.length * CO2_KG_PER_PLANT),
    points: state.wallet ? Number(state.wallet.totalEarned || 0) : null,
    milestonesDone: milestones.done,
    milestonesTotal: milestones.total,
    plantNames: state.plants.map((plant) => plant.plant_name || plant.plant_type).filter(Boolean).slice(0, 4),
  };
}

async function drawStatTile(ctx, x, y, w, h, { icon, value, label, font }) {
  roundRect(ctx, x, y, w, h, 26);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const image = await iconImage(icon, 104, "#A9C48C");
  ctx.drawImage(image, x + w / 2 - 26, y + 32, 52, 52);
  drawText(ctx, value, x + w / 2, y + 158, { size: 68, weight: 800, font });
  drawText(ctx, label, x + w / 2, y + 202, { size: 29, weight: 600, color: "rgba(255,255,255,0.7)", font });
}

/** The backdrop both story cards share: the dark band from the home page as a
 * soft vertical gradient, plus a sage glow behind the header. */
function paintStoryBackground(ctx) {
  const CX = STORY_W / 2;
  const bg = ctx.createLinearGradient(0, 0, STORY_W * 0.15, STORY_H);
  bg.addColorStop(0, "#25332A");
  bg.addColorStop(0.5, "#1A2A20");
  bg.addColorStop(1, "#122019");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  const glow = ctx.createRadialGradient(CX, 380, 40, CX, 380, 720);
  glow.addColorStop(0, "rgba(135,169,107,0.34)");
  glow.addColorStop(1, "rgba(135,169,107,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STORY_W, 1120);
}

/** The shared header: the faint brand watermark, the mark above the wordmark,
 * and an eyebrow pill. */
async function drawStoryHeader(ctx, { font, eyebrow }) {
  const CX = STORY_W / 2;
  const mark = await loadImage("logo-mark-light.png").catch(() => null);

  // The brand mark as a faint watermark — exactly how style.css uses it on dark.
  if (mark) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.drawImage(mark, CX - 380, 800, 760, 760);
    ctx.restore();

    const scale = 150 / Math.max(mark.naturalWidth, mark.naturalHeight);
    ctx.drawImage(mark, CX - (mark.naturalWidth * scale) / 2, 150, mark.naturalWidth * scale, mark.naturalHeight * scale);
  } else {
    ctx.drawImage(await iconImage("leaf", 150, "#FFFFFF"), CX - 75, 150, 150, 150);
  }

  drawText(ctx, "Greenomy", CX, 400, { size: 84, weight: 800, font, letterSpacing: 1 });

  ctx.font = `700 32px ${font}`;
  const pill = ctx.measureText(eyebrow).width + 60;
  roundRect(ctx, CX - pill / 2, 452, pill, 62, 31);
  ctx.fillStyle = "rgba(212,175,55,0.16)";
  ctx.fill();
  drawText(ctx, eyebrow, CX, 494, { size: 32, weight: 700, color: "#E8CB6A", font, letterSpacing: 3 });
}

async function drawShareCard() {
  const data = shareCardData();
  const { font } = data;
  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  const CX = STORY_W / 2;
  const M = 96;

  // Wait for the brand fonts so Arabic/Kurdish doesn't render in a fallback.
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([
        document.fonts.load(`800 120px ${font}`),
        document.fonts.load(`600 40px ${font}`),
      ]);
    } catch {
      /* a missing font just falls back */
    }
  }

  paintStoryBackground(ctx);
  await drawStoryHeader(ctx, { font, eyebrow: t("share.eyebrow") });

  drawText(ctx, t("share.title"), CX, 618, { size: 72, weight: 800, font });
  if (data.member) {
    drawText(ctx, fitText(ctx, data.member, STORY_W - M * 2, font, 40), CX, 682, {
      size: 40,
      weight: 600,
      color: "rgba(255,255,255,0.72)",
      font,
    });
  }

  // Hero number: plants grown.
  drawText(ctx, data.plants.toLocaleString(), CX, 900, { size: 200, weight: 800, color: "#E8CB6A", font });
  drawText(ctx, t("share.plants"), CX, 968, { size: 46, weight: 600, color: "rgba(255,255,255,0.82)", font, letterSpacing: 1 });

  // Four milestone tiles, 2x2.
  const tileW = (STORY_W - M * 2 - 40) / 2;
  const tileH = 230;
  const tiles = [
    { icon: "camera", value: data.verified.toLocaleString(), label: t("share.verifiedPhotos") },
    {
      icon: "check",
      value: data.milestonesTotal ? `${data.milestonesDone}/${data.milestonesTotal}` : "0",
      label: t("share.milestones"),
    },
    {
      icon: "trophy",
      value: data.points == null ? "—" : data.points.toLocaleString(),
      label: t("share.points"),
    },
    { icon: "globe", value: data.co2.toLocaleString(), label: t("share.co2") },
  ];
  for (let i = 0; i < tiles.length; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    await drawStatTile(ctx, M + col * (tileW + 40), 1064 + row * (tileH + 36), tileW, tileH, { ...tiles[i], font });
  }

  if (data.plantNames.length) {
    const line = `${t("share.growing")}: ${data.plantNames.join(", ")}`;
    drawText(ctx, fitText(ctx, line, STORY_W - M * 2, font, 36), CX, 1650, {
      size: 36,
      weight: 600,
      color: "rgba(255,255,255,0.66)",
      font,
    });
  }

  // Footer: the tagline, then where to find Greenomy.
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(M, 1712, STORY_W - M * 2, 2);
  drawText(ctx, fitText(ctx, t("hero.title"), STORY_W - M * 2, font, 38), CX, 1782, {
    size: 38,
    weight: 600,
    color: "rgba(255,255,255,0.7)",
    font,
  });
  drawText(ctx, `${SITE_URL} · ${CONTACT_EMAIL}`, CX, 1848, { size: 36, weight: 700, color: "#FFFFFF", font });

  return canvas;
}

/**
 * A story card for ONE plant: its name, how long it has been growing, and its
 * own milestone list — completed, current and upcoming — exactly as that
 * plant's journey defines it, so a tomato and a basil read differently.
 */
async function drawPlantCard(journey) {
  const user = getCurrentUser() || {};
  const rtl = ["ar", "ku"].includes(currentLanguage());
  const font = canvasFont();
  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  const CX = STORY_W / 2;
  const M = 96;

  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all([
        document.fonts.load(`800 120px ${font}`),
        document.fonts.load(`600 40px ${font}`),
      ]);
    } catch {
      /* a missing font just falls back */
    }
  }

  paintStoryBackground(ctx);
  await drawStoryHeader(ctx, { font, eyebrow: t("share.plantEyebrow") });

  // The plant's own icon, ringed — the same icon the garden shows for it.
  ctx.beginPath();
  ctx.arc(CX, 640, 92, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();
  const glyph = await iconImage(plantIcon({ icon: journey.plant_icon, plant_type: journey.plant_type }), 108, "#A9C48C");
  ctx.drawImage(glyph, CX - 54, 640 - 54, 108, 108);

  drawText(ctx, fitText(ctx, journey.plant_name || journey.plant_type, STORY_W - M * 2, font, 92, 800), CX, 832, {
    size: 92,
    weight: 800,
    font,
  });

  const member = [user.fullName, user.city].filter(Boolean).join(" · ");
  if (member) {
    drawText(ctx, fitText(ctx, member, STORY_W - M * 2, font, 40), CX, 894, {
      size: 40,
      weight: 600,
      color: "rgba(255,255,255,0.72)",
      font,
    });
  }

  // Hero number: how long this plant has been growing.
  drawText(ctx, journey.age_days == null ? "—" : String(journey.age_days), CX, 1022, {
    size: 140,
    weight: 800,
    color: "#E8CB6A",
    font,
  });
  drawText(ctx, t("share.daysGrowing"), CX, 1076, {
    size: 38,
    weight: 600,
    color: "rgba(255,255,255,0.82)",
    font,
    letterSpacing: 1,
  });

  // Development: this plant's own milestones, in its own order.
  const milestones = journey.milestones || [];
  const done = journey.milestones_done || 0;
  const total = journey.milestones_total || milestones.length;
  const heading = `${t("share.development")} · ${done}/${total}`;
  drawText(ctx, fitText(ctx, heading, STORY_W - M * 2, font, 40), CX, 1162, {
    size: 40,
    weight: 700,
    color: "#A9C48C",
    font,
    letterSpacing: 2,
  });

  const next = journey.next_milestone || null;
  const rows = milestones.slice(0, 8);
  const rowH = 60;
  const firstY = 1226;
  const markerX = rtl ? STORY_W - M - 20 : M + 20;
  const labelX = rtl ? STORY_W - M - 56 : M + 56;
  const align = rtl ? "right" : "left";
  const windowX = rtl ? M + 20 : STORY_W - M - 20;
  const windowAlign = rtl ? "left" : "right";

  for (let i = 0; i < rows.length; i += 1) {
    const milestone = rows[i];
    const y = firstY + i * rowH;
    const isDone = Boolean(milestone.completed_at);
    const isCurrent = !isDone && next && next.milestone_id === milestone.milestone_id;

    ctx.beginPath();
    ctx.arc(markerX, y - 12, 16, 0, Math.PI * 2);
    ctx.fillStyle = isDone ? "#87A96B" : isCurrent ? "#E8CB6A" : "rgba(255,255,255,0.10)";
    ctx.fill();

    if (isDone) {
      const check = await iconImage("check", 22, "#122019");
      ctx.drawImage(check, markerX - 11, y - 23, 22, 22);
    }

    drawText(ctx, fitText(ctx, stageLabel(milestone), STORY_W - M * 2 - 220, font, 38, 600), labelX, y, {
      size: 38,
      weight: 600,
      align,
      color: isDone ? "#FFFFFF" : isCurrent ? "#E8CB6A" : "rgba(255,255,255,0.55)",
      font,
    });

    if (milestone.recommended_window) {
      drawText(ctx, milestone.recommended_window, windowX, y, {
        size: 28,
        weight: 600,
        color: "rgba(255,255,255,0.42)",
        font,
        align: windowAlign,
      });
    }
  }

  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(M, 1712, STORY_W - M * 2, 2);
  drawText(ctx, fitText(ctx, t("hero.title"), STORY_W - M * 2, font, 38), CX, 1782, {
    size: 38,
    weight: 600,
    color: "rgba(255,255,255,0.7)",
    font,
  });
  drawText(ctx, `${SITE_URL} · ${CONTACT_EMAIL}`, CX, 1848, { size: 36, weight: 700, color: "#FFFFFF", font });

  return canvas;
}

function setShareStatus(message, kind) {
  if (!shareModal.status) return;
  shareModal.status.textContent = message || "";
  shareModal.status.className = kind ? `form-status is-${kind}` : "form-status";
}

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadCanvas(canvas, filename = SHARE_FILE) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}

function closeShare() {
  if (!shareModal.root) return;
  shareModal.root.hidden = true;
  shareModal.canvas = null;
  shareModal.preview.innerHTML = "";
  document.body.style.overflow = "";
  setShareStatus("");
}

/** Opens the story modal for one plant, or for the whole garden when no
 * `subject` is given. The modal chrome and the filename follow the subject. */
async function openShare(subject = null) {
  if (!shareModal.root) return;

  shareModal.subject = subject;
  shareModal.filename = shareFilename(subject);
  if (shareModal.title) shareModal.title.textContent = subject ? t("share.plantTitle") : t("share.modalTitle");
  if (shareModal.lead) shareModal.lead.textContent = subject ? t("share.plantLead") : t("share.lead");

  shareModal.root.hidden = false;
  document.body.style.overflow = "hidden";
  setShareStatus("");
  shareModal.preview.innerHTML = `<div class="loading-state">${iconMarkup("share")}${escapeHtml(t("share.rendering"))}</div>`;

  // Only the garden card carries points, and the garden page doesn't load the
  // wallet, so fetch it on demand — but never for a single plant.
  if (!subject && !state.wallet) {
    try {
      state.wallet = await api.get("/wallet");
    } catch (err) {
      if (isAuthError(err)) {
        closeShare();
        return gotoLogin();
      }
    }
  }

  try {
    const canvas = subject ? await drawPlantCard(subject) : await drawShareCard();
    shareModal.canvas = canvas;
    shareModal.preview.innerHTML = "";
    shareModal.preview.appendChild(canvas);
    setShareStatus(t("share.ready"), "success");
  } catch (err) {
    shareModal.preview.innerHTML = "";
    setShareStatus(t("share.error"), "error");
  }
}

async function sendShare() {
  const canvas = shareModal.canvas;
  if (!canvas) return;

  const blob = await canvasBlob(canvas);
  const file = blob ? new File([blob], shareModal.filename, { type: "image/png" }) : null;

  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Greenomy", text: t("share.shareText") });
    } catch {
      // The member dismissed the share sheet — nothing to report.
    }
    return;
  }

  downloadCanvas(canvas);
  setShareStatus(t("share.noShare"), "success");
}

function wireShare() {
  shareModal.root = document.querySelector("[data-share-modal]");
  if (!shareModal.root) return;
  shareModal.title = shareModal.root.querySelector("[data-share-title]");
  shareModal.lead = shareModal.root.querySelector("[data-share-lead]");
  shareModal.preview = shareModal.root.querySelector("[data-share-preview]");
  shareModal.status = shareModal.root.querySelector("[data-share-status]");

  const openButton = document.querySelector("[data-share-open]");
  if (openButton) openButton.addEventListener("click", () => openShare());

  // engagement.js renders a "share this plant" button on every journey card; one
  // delegated listener covers them all, including cards drawn after this runs.
  document.addEventListener("click", (event) => {
    const plantButton = event.target.closest("[data-share-plant]");
    if (!plantButton) return;
    const journey = state.journeys.find(
      (entry) => entry.journey_id === plantButton.getAttribute("data-share-plant")
    );
    if (journey) openShare(journey);
  });

  shareModal.root.addEventListener("click", (e) => {
    if (e.target.closest("[data-share-close]")) return closeShare();
    if (e.target.closest("[data-share-download]")) {
      if (shareModal.canvas) downloadCanvas(shareModal.canvas, shareModal.filename);
      return;
    }
    if (e.target.closest("[data-share-send]")) sendShare();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !shareModal.root.hidden) closeShare();
  });
}

/* ------------------------------------------------------------------ Boot */
function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await logout();
      } finally {
        window.location.href = "index.html";
      }
    });
  });
}

function wireNotifications() {
  const host = document.querySelector("[data-notifications]");
  if (!host) return;

  host.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-mark-all-read]");
    if (!button) return;

    button.disabled = true;
    try {
      await api.post("/notifications/read-all", {});
      state.notifications = state.notifications.map((n) => ({ ...n, is_read: true }));
      renderNotifications();
    } catch (err) {
      if (isAuthError(err)) return gotoLogin();
      button.disabled = false;
    }
  });
}

async function loadWallet() {
  if (!document.querySelector("[data-wallet-summary]")) return;
  try {
    const [wallet, transactions] = await Promise.all([
      api.get("/wallet"),
      api.get("/wallet/transactions"),
    ]);
    state.wallet = wallet;
    state.transactions = Array.isArray(transactions) ? transactions : [];
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.walletError = true;
  }
}

async function loadGarden() {
  if (!document.querySelector("[data-garden-grid]")) return;
  try {
    const [plants, verifications, journeys] = await Promise.all([
      listMyPlants(),
      listVerifications(),
      listJourneys(),
    ]);
    state.plants = Array.isArray(plants) ? plants : [];
    state.verifications = Array.isArray(verifications) ? verifications : [];
    state.journeys = Array.isArray(journeys) ? journeys : [];
    state.gardenLoaded = true;
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.gardenError = true;
  }
}

async function loadNotifications() {
  if (!document.querySelector("[data-notifications]")) return;
  try {
    state.notifications = await api.get("/notifications");
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.notifications = [];
  }
  state.notificationsLoaded = true;
}

async function init() {
  if (!requireAuthOrRedirect("login.html")) return;
  wireLogout();
  wireNotifications();
  wireShare();
  renderAll(); // paint loading states immediately
  await Promise.all([loadWallet(), loadGarden(), loadNotifications()]);
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("greenomy:translated", () => {
  renderAll();
  // A language switch changes the card's text, so redraw whatever is open.
  if (shareModal.root && !shareModal.root.hidden) openShare(shareModal.subject);
});
