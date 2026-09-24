// admin.js — controller for every admin page: the verification queue plus the
// users / partners / rewards / content / analytics dashboard. One module, and
// the page's root hook decides which section boots.
import { requireAuthOrRedirect, logout } from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { t } from "./language.js";
import { iconMarkup } from "./icons.js";

const ADMIN_ROLES = ["admin", "super_admin"];

const ROLE_LABELS = {
  user: "admin.roleUser",
  admin: "admin.roleAdmin",
  super_admin: "admin.roleSuperAdmin",
};

const CATEGORY_LABELS = {
  restaurant: "rewards.catRestaurant",
  courses: "rewards.catCourses",
  supplies: "rewards.catSupplies",
  university: "rewards.catUniversity",
  "food-seed-recycling": "greenHub.filterSeed",
  "home-gardening": "greenHub.filterGarden",
  "plant-care": "greenHub.filterCare",
  "iraq-climate": "greenHub.filterClimate",
  soil: "greenHub.filterSoil",
  water: "greenHub.filterWater",
  "planting-strategies": "greenHub.filterStrategy",
};

const VERDICT_LABELS = {
  approved: "garden.verificationApproved",
  pending: "admin.pending",
  rejected: "garden.verificationRejected",
};

let me = null;
let renderCurrent = () => {};
const modal = { root: null, body: null };

/* ---------------------------------------------------------------- utils */
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function categoryLabel(category) {
  return t(CATEGORY_LABELS[category] || category || "");
}

function toLogin() {
  window.location.href = "login.html";
}

const isAuthError = (err) => err instanceof ApiError && err.status === 401;
const isForbidden = (err) => err instanceof ApiError && err.status === 403;

function errorText(err) {
  return err instanceof ApiError ? err.message : t("common.errorGeneric");
}

function host(selector) {
  return document.querySelector(selector);
}

function setContent(selector, html) {
  const el = host(selector);
  if (el) el.innerHTML = html;
}

function loadingState(icon) {
  return `<div class="loading-state">${iconMarkup(icon)}${escapeHtml(t("common.loading"))}</div>`;
}

function errorState() {
  return `<div class="error-state">${escapeHtml(t("admin.dashboardLoadError"))}</div>`;
}

function emptyState() {
  return `<div class="empty-state">${iconMarkup("inbox")}${escapeHtml(t("admin.emptyTable"))}</div>`;
}

function denyAccess() {
  const denied = host("[data-admin-denied]");
  if (denied) denied.hidden = false;
  document.querySelectorAll("[data-admin-host]").forEach((el) => {
    el.hidden = true;
  });
}

function pill(text, variant) {
  return `<span class="pill ${variant}">${escapeHtml(text)}</span>`;
}

/** Runs an action, disabling the button while it is in flight. */
async function withBusy(button, fn) {
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (err) {
    if (isAuthError(err)) return toLogin();
    if (isForbidden(err)) return denyAccess();
    window.alert(errorText(err));
  } finally {
    if (button && document.body.contains(button)) button.disabled = false;
  }
}

function readField(form, name) {
  const el = form.querySelector(`[name="${name}"]`);
  return el ? el.value.trim() : "";
}

/* ---------------------------------------------------------------- modal */
function openModal(html) {
  if (!modal.root) return;
  modal.body.innerHTML = html;
  modal.root.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  if (!modal.root) return;
  modal.root.hidden = true;
  modal.body.innerHTML = "";
  document.body.style.overflow = "";
}

/* --------------------------------------------------------- verification */
function reviewItemHTML(v) {
  const score = Math.round((v.ai_confidence_score || 0) * 100);
  const plant = v.plant_type || t("admin.unknownPlant");
  const id = escapeHtml(v.verification_id);
  const thumb = v.image_url
    ? `<img class="history-thumb" src="${escapeHtml(v.image_url)}" alt="" />`
    : `<div class="history-thumb" aria-hidden="true"></div>`;

  return `
    <div class="tx-item review-item">
      ${thumb}
      <div class="review-main">
        <span class="tx-label">${escapeHtml(plant)}</span>
        <span class="tx-date">${escapeHtml(t("admin.submitted"))}: ${escapeHtml(fmtDateTime(v.created_at))} · ${escapeHtml(t("admin.confidence"))} ${score}%</span>
      </div>
      <div class="review-actions">
        <button type="button" class="btn btn-primary" data-approve="${id}">${escapeHtml(t("admin.approve"))}</button>
        <button type="button" class="btn btn-secondary" data-reject="${id}">${escapeHtml(t("admin.reject"))}</button>
      </div>
    </div>
  `;
}

function initQueue() {
  let queue = null;
  let notice = null;

  const render = () => {
    if (notice) {
      setContent("[data-admin-queue]", `<p class="form-status is-error">${escapeHtml(notice)}</p>`);
      notice = null;
    }
    if (queue === null) return setContent("[data-admin-queue]", loadingState("search"));
    if (!queue.length) return setContent("[data-admin-queue]", `<div class="empty-state">${iconMarkup("check")}${escapeHtml(t("admin.empty"))}</div>`);
    setContent("[data-admin-queue]", `<div class="tx-list">${queue.map(reviewItemHTML).join("")}</div>`);
  };

  const load = async () => {
    queue = null;
    render();
    try {
      queue = await api.get("/admin/verifications");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return denyAccess();
      queue = [];
      setContent("[data-admin-queue]", errorState());
      return;
    }
    render();
  };

  const decide = (id, action, body) =>
    withBusy(null, async () => {
      await api.post(`/admin/verifications/${encodeURIComponent(id)}/${action}`, body || {});
      queue = (queue || []).filter((v) => v.verification_id !== id);
      closeModal();
      render();
    });

  const body = host("[data-admin-host]");
  if (body) {
    body.addEventListener("click", (e) => {
      const approve = e.target.closest("[data-approve]");
      if (approve) return decide(approve.getAttribute("data-approve"), "approve");

      const reject = e.target.closest("[data-reject]");
      if (!reject) return;
      const id = reject.getAttribute("data-reject");
      openModal(`
        <h2 class="heading-md" id="admin-modal-title">${escapeHtml(t("admin.rejectTitle"))}</h2>
        <div class="form-field">
          <label for="rejectReason">${escapeHtml(t("admin.reasonLabel"))}</label>
          <textarea id="rejectReason" rows="3" placeholder="${escapeHtml(t("admin.reasonPlaceholder"))}"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-modal-close>${escapeHtml(t("admin.cancel"))}</button>
          <button type="button" class="btn btn-accent" data-confirm-reject>${escapeHtml(t("admin.confirmReject"))}</button>
        </div>
      `);
      const confirm = modal.body.querySelector("[data-confirm-reject]");
      confirm.addEventListener("click", () => {
        const reason = (modal.body.querySelector("#rejectReason") || {}).value || "";
        decide(id, "reject", { reason });
      });
    });
  }

  renderCurrent = render;
  return load();
}

/* ----------------------------------------------------------------- users */
function userRowHTML(user) {
  const isSelf = me && user.user_id === me.user_id;
  const suspended = user.status !== "active";
  return `
    <tr>
      <td>${escapeHtml(user.full_name)}${isSelf ? ` <span class="pill is-off">${escapeHtml(t("admin.you"))}</span>` : ""}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(t(ROLE_LABELS[user.role] || "admin.roleUser"))}</td>
      <td>${Number(user.total_points || 0).toLocaleString()}</td>
      <td>${suspended ? pill(t("admin.statusSuspended"), "is-warn") : pill(t("admin.statusActive"), "is-on")}</td>
      <td class="actions">
        <button type="button" class="btn btn-secondary" data-user="${escapeHtml(user.user_id)}" data-status="${suspended ? "active" : "suspended"}"${isSelf ? " disabled" : ""}>
          ${escapeHtml(suspended ? t("admin.activate") : t("admin.suspend"))}
        </button>
      </td>
    </tr>
  `;
}

function initUsers() {
  let users = null;

  const render = () => {
    if (users === null) return setContent("[data-admin-users]", loadingState("users"));
    if (!users.length) return setContent("[data-admin-users]", emptyState());
    setContent(
      "[data-admin-users]",
      `<div class="table-wrap"><table class="admin-table">
        <thead><tr>
          <th>${escapeHtml(t("admin.colName"))}</th>
          <th>${escapeHtml(t("admin.colEmail"))}</th>
          <th>${escapeHtml(t("admin.colRole"))}</th>
          <th>${escapeHtml(t("admin.colPoints"))}</th>
          <th>${escapeHtml(t("admin.colStatus"))}</th>
          <th><span class="visually-hidden">${escapeHtml(t("admin.colActions"))}</span></th>
        </tr></thead>
        <tbody>${users.map(userRowHTML).join("")}</tbody>
      </table></div>`
    );
  };

  const load = async () => {
    users = null;
    render();
    try {
      users = await api.get("/admin/users");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return denyAccess();
      return setContent("[data-admin-users]", errorState());
    }
    render();
  };

  host("[data-admin-host]").addEventListener("click", (e) => {
    const button = e.target.closest("[data-user]");
    if (!button) return;
    withBusy(button, async () => {
      const updated = await api.patch(`/admin/users/${encodeURIComponent(button.getAttribute("data-user"))}`, {
        status: button.getAttribute("data-status"),
      });
      users = users.map((u) => (u.user_id === updated.user_id ? updated : u));
      render();
    });
  });

  renderCurrent = render;
  return load();
}

/* -------------------------------------------------------------- partners */
function partnerRowHTML(partner) {
  return `
    <tr>
      <td>${escapeHtml(partner.name)}</td>
      <td>${partner.website ? `<a href="${escapeHtml(partner.website)}" target="_blank" rel="noopener">${escapeHtml(partner.website)}</a>` : "—"}</td>
      <td>${escapeHtml(partner.contact_email || "—")}</td>
      <td>${partner.is_active ? pill(t("admin.statusActive"), "is-on") : pill(t("admin.statusInactive"), "is-off")}</td>
      <td class="actions">
        <button type="button" class="btn btn-secondary" data-partner="${escapeHtml(partner.partner_id)}" data-active="${partner.is_active ? "false" : "true"}">
          ${escapeHtml(partner.is_active ? t("admin.deactivate") : t("admin.activate"))}
        </button>
      </td>
    </tr>
  `;
}

function initPartners() {
  let partners = null;

  const render = () => {
    if (partners === null) return setContent("[data-admin-partners]", loadingState("store"));
    if (!partners.length) return setContent("[data-admin-partners]", emptyState());
    setContent(
      "[data-admin-partners]",
      `<div class="table-wrap"><table class="admin-table">
        <thead><tr>
          <th>${escapeHtml(t("admin.colName"))}</th>
          <th>${escapeHtml(t("admin.website"))}</th>
          <th>${escapeHtml(t("admin.contactEmail"))}</th>
          <th>${escapeHtml(t("admin.colStatus"))}</th>
          <th><span class="visually-hidden">${escapeHtml(t("admin.colActions"))}</span></th>
        </tr></thead>
        <tbody>${partners.map(partnerRowHTML).join("")}</tbody>
      </table></div>`
    );
  };

  const load = async () => {
    partners = null;
    render();
    try {
      partners = await api.get("/admin/partners");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return denyAccess();
      return setContent("[data-admin-partners]", errorState());
    }
    render();
  };

  const root = host("[data-admin-host]");
  const form = root.querySelector("[data-partner-form]");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const status = form.querySelector("[data-form-status]");
    withBusy(form.querySelector('button[type="submit"]'), async () => {
      await api.post("/admin/partners", {
        name: readField(form, "name"),
        website: readField(form, "website") || null,
        contactEmail: readField(form, "contactEmail") || null,
      });
      form.reset();
      status.className = "form-status is-success";
      status.textContent = t("admin.saved");
      await load();
    });
  });

  root.addEventListener("click", (e) => {
    const button = e.target.closest("[data-partner]");
    if (!button) return;
    withBusy(button, async () => {
      const updated = await api.patch(`/admin/partners/${encodeURIComponent(button.getAttribute("data-partner"))}`, {
        isActive: button.getAttribute("data-active") === "true",
      });
      partners = partners.map((p) => (p.partner_id === updated.partner_id ? updated : p));
      render();
    });
  });

  renderCurrent = render;
  return load();
}

/* --------------------------------------------------------------- rewards */
function rewardRowHTML(reward) {
  return `
    <tr>
      <td>${escapeHtml(reward.title)}</td>
      <td>${escapeHtml(reward.partner)}</td>
      <td>${escapeHtml(categoryLabel(reward.category))}</td>
      <td>${Number(reward.points_required || 0).toLocaleString()}</td>
      <td>${reward.is_active ? pill(t("admin.statusActive"), "is-on") : pill(t("admin.statusInactive"), "is-off")}</td>
      <td class="actions">
        <button type="button" class="btn btn-secondary" data-reward="${escapeHtml(reward.reward_id)}" data-active="${reward.is_active ? "false" : "true"}">
          ${escapeHtml(reward.is_active ? t("admin.deactivate") : t("admin.activate"))}
        </button>
      </td>
    </tr>
  `;
}

function initRewards() {
  let rewards = null;

  const render = () => {
    if (rewards === null) return setContent("[data-admin-rewards]", loadingState("gift"));
    if (!rewards.length) return setContent("[data-admin-rewards]", emptyState());
    setContent(
      "[data-admin-rewards]",
      `<div class="table-wrap"><table class="admin-table">
        <thead><tr>
          <th>${escapeHtml(t("admin.rewardTitle"))}</th>
          <th>${escapeHtml(t("admin.colPartner"))}</th>
          <th>${escapeHtml(t("admin.colCategory"))}</th>
          <th>${escapeHtml(t("admin.pointsRequired"))}</th>
          <th>${escapeHtml(t("admin.colActive"))}</th>
          <th><span class="visually-hidden">${escapeHtml(t("admin.colActions"))}</span></th>
        </tr></thead>
        <tbody>${rewards.map(rewardRowHTML).join("")}</tbody>
      </table></div>`
    );
  };

  const load = async () => {
    rewards = null;
    render();
    try {
      rewards = await api.get("/admin/rewards");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return denyAccess();
      return setContent("[data-admin-rewards]", errorState());
    }
    render();
  };

  const root = host("[data-admin-host]");
  const form = root.querySelector("[data-reward-form]");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const status = form.querySelector("[data-form-status]");
    withBusy(form.querySelector('button[type="submit"]'), async () => {
      await api.post("/admin/rewards", {
        partner: readField(form, "partner"),
        category: readField(form, "category"),
        title: readField(form, "title"),
        pointsRequired: Number(readField(form, "pointsRequired")),
      });
      form.reset();
      status.className = "form-status is-success";
      status.textContent = t("admin.saved");
      await load();
    });
  });

  root.addEventListener("click", (e) => {
    const button = e.target.closest("[data-reward]");
    if (!button) return;
    withBusy(button, async () => {
      const updated = await api.patch(`/admin/rewards/${encodeURIComponent(button.getAttribute("data-reward"))}`, {
        isActive: button.getAttribute("data-active") === "true",
      });
      rewards = rewards.map((r) => (r.reward_id === updated.reward_id ? updated : r));
      render();
    });
  });

  renderCurrent = render;
  return load();
}

/* --------------------------------------------------------------- content */
function contentRowHTML(article) {
  return `
    <tr>
      <td>${escapeHtml(article.title)}</td>
      <td>${escapeHtml(categoryLabel(article.category))}</td>
      <td>${article.readingTime ? `${article.readingTime} ${escapeHtml(t("greenHub.minRead"))}` : "—"}</td>
      <td>${article.isPublished ? pill(t("admin.colPublished"), "is-on") : pill(t("admin.statusDraft"), "is-off")}</td>
      <td class="actions">
        <button type="button" class="btn btn-secondary" data-article="${escapeHtml(article.id)}" data-publish="${article.isPublished ? "false" : "true"}">
          ${escapeHtml(article.isPublished ? t("admin.unpublish") : t("admin.publish"))}
        </button>
        <button type="button" class="btn btn-ghost" data-delete="${escapeHtml(article.id)}">${escapeHtml(t("admin.delete"))}</button>
      </td>
    </tr>
  `;
}

function initContent() {
  let articles = null;

  const render = () => {
    if (articles === null) return setContent("[data-admin-content]", loadingState("file"));
    if (!articles.length) return setContent("[data-admin-content]", emptyState());
    setContent(
      "[data-admin-content]",
      `<div class="table-wrap"><table class="admin-table">
        <thead><tr>
          <th>${escapeHtml(t("admin.articleTitle"))}</th>
          <th>${escapeHtml(t("admin.colCategory"))}</th>
          <th>${escapeHtml(t("admin.readingTime"))}</th>
          <th>${escapeHtml(t("admin.colPublished"))}</th>
          <th><span class="visually-hidden">${escapeHtml(t("admin.colActions"))}</span></th>
        </tr></thead>
        <tbody>${articles.map(contentRowHTML).join("")}</tbody>
      </table></div>`
    );
  };

  const load = async () => {
    articles = null;
    render();
    try {
      articles = await api.get("/admin/content");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return denyAccess();
      return setContent("[data-admin-content]", errorState());
    }
    render();
  };

  const root = host("[data-admin-host]");
  const form = root.querySelector("[data-content-form]");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const status = form.querySelector("[data-form-status]");
    withBusy(form.querySelector('button[type="submit"]'), async () => {
      await api.post("/admin/content", {
        slug: readField(form, "slug"),
        title: readField(form, "title"),
        category: readField(form, "category"),
        body: readField(form, "body")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      form.reset();
      status.className = "form-status is-success";
      status.textContent = t("admin.saved");
      await load();
    });
  });

  root.addEventListener("click", (e) => {
    const publish = e.target.closest("[data-publish]");
    if (publish) {
      return withBusy(publish, async () => {
        const updated = await api.patch(`/admin/content/${encodeURIComponent(publish.getAttribute("data-article"))}`, {
          isPublished: publish.getAttribute("data-publish") === "true",
        });
        articles = articles.map((a) => (a.id === updated.id ? updated : a));
        render();
      });
    }

    const remove = e.target.closest("[data-delete]");
    if (!remove) return;
    withBusy(remove, async () => {
      await api.delete(`/admin/content/${encodeURIComponent(remove.getAttribute("data-delete"))}`);
      articles = articles.filter((a) => a.id !== remove.getAttribute("data-delete"));
      render();
    });
  });

  renderCurrent = render;
  return load();
}

/* ------------------------------------------------------------- analytics */
/** Numbers are formatted for display; strings (e.g. "50%") are passed through. */
function statCard(value, label) {
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return `<div class="card stat-card"><strong>${escapeHtml(display)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function chartHTML(byDay) {
  if (!byDay || !byDay.length) {
    return `<div class="empty-state">${iconMarkup("chart")}${escapeHtml(t("admin.noActivity"))}</div>`;
  }
  const max = Math.max(...byDay.map((d) => d.count), 1);
  const bars = byDay
    .map((d) => {
      const height = Math.round((d.count / max) * 100);
      const label = String(d.day).slice(5);
      return `<div class="bar" style="height:${Math.max(height, 3)}%" title="${escapeHtml(d.day)}: ${d.count}"><span>${escapeHtml(label)}</span></div>`;
    })
    .join("");
  return `<div class="bar-chart">${bars}</div>`;
}

function initAnalytics() {
  let data = null;

  const render = () => {
    if (data === null) return setContent("[data-admin-analytics]", loadingState("chart"));

    setContent(
      "[data-admin-analytics]",
      `
      <div class="stat-grid" style="margin-bottom:28px;">
        ${statCard(data.users.total, t("admin.members"))}
        ${statCard(data.users.admins, t("admin.roleAdmin"))}
        ${statCard(data.plants.total, t("admin.plantsLabel"))}
        ${statCard(data.verifications.total, t("admin.verificationsLabel"))}
        ${statCard(`${data.verifications.approvalRate || 0}%`, t("admin.approvalRate"))}
        ${statCard(data.redemptions.total, t("admin.redemptionsLabel"))}
        ${statCard(data.points.earned, t("admin.pointsEarned"))}
        ${statCard(data.points.spent, t("admin.pointsSpent"))}
        ${statCard(data.points.outstanding, t("admin.pointsOutstanding"))}
        ${statCard(data.rewards.active, t("admin.rewardsLabel"))}
        ${statCard(data.partners.active, t("admin.partnersLabel"))}
        ${statCard(data.content.published, t("admin.articlesLabel"))}
        ${statCard(data.waitlist.total, t("admin.waitlistLabel"))}
      </div>

      <h2 class="heading-md">${escapeHtml(t("admin.activityTitle"))}</h2>
      <div class="chart-wrap">${chartHTML(data.verificationsByDay)}</div>

      <div class="table-wrap"><table class="admin-table">
        <thead><tr>
          <th>${escapeHtml(t("admin.verificationsLabel"))}</th>
          <th>${escapeHtml(t("admin.colStatus"))}</th>
        </tr></thead>
        <tbody>
          <tr><td>${escapeHtml(t("admin.pending"))}</td><td>${data.verifications.pending}</td></tr>
          <tr><td>${escapeHtml(t("admin.approved"))}</td><td>${data.verifications.approved}</td></tr>
          <tr><td>${escapeHtml(t("admin.rejected"))}</td><td>${data.verifications.rejected}</td></tr>
          <tr><td>${escapeHtml(t("admin.redemptionsLabel"))} (${escapeHtml(t("admin.activate"))})</td><td>${data.redemptions.used}</td></tr>
        </tbody>
      </table></div>
      `
    );
  };

  const load = async () => {
    data = null;
    render();
    try {
      data = await api.get("/admin/analytics");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return denyAccess();
      return setContent("[data-admin-analytics]", errorState());
    }
    render();
  };

  renderCurrent = render;
  return load();
}

/* --------------------------------------------------------------- shell */
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

function initModal() {
  modal.root = host("[data-admin-modal]");
  if (!modal.root) return;
  modal.body = modal.root.querySelector("[data-modal-body]");

  modal.root.addEventListener("click", (e) => {
    if (e.target.closest("[data-modal-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.root.hidden) closeModal();
  });
}

/** Auth + admin-role gate, then the page's own initialiser. */
async function boot(init) {
  if (!requireAuthOrRedirect("login.html")) return;

  try {
    me = await api.get("/auth/me");
  } catch (err) {
    if (isAuthError(err)) return toLogin();
    return denyAccess();
  }

  if (!ADMIN_ROLES.includes(me.role)) return denyAccess();

  wireLogout();
  initModal();
  await init();
}

document.addEventListener("DOMContentLoaded", () => {
  if (host("[data-admin-queue]")) return boot(initQueue);
  if (host("[data-admin-users]")) return boot(initUsers);
  if (host("[data-admin-partners]")) return boot(initPartners);
  if (host("[data-admin-rewards]")) return boot(initRewards);
  if (host("[data-admin-content]")) return boot(initContent);
  if (host("[data-admin-analytics]")) return boot(initAnalytics);
});

document.addEventListener("greenomy:translated", () => renderCurrent());
