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
// The member panel can change a row that the users page is showing, so the page
// registers a reloader here (set in the boot below) rather than the panel
// reaching into a section's private state.
let refreshUserViews = () => {};
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

/** Staff, but not for THIS area. Kept apart from denyAccess(): saying "you don't
 * have admin access" to an admin who merely lacks one permission would be wrong. */
function forbiddenState() {
  return `<div class="empty-state">${iconMarkup("lock")}${escapeHtml(t("admin.needsPermission"))}</div>`;
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
    window.alert(errorText(err));
  } finally {
    if (button && document.body.contains(button)) button.disabled = false;
  }
}

function readField(form, name) {
  const el = form.querySelector(`[name="${name}"]`);
  return el ? el.value.trim() : "";
}

/* Each admin section has ONE form: it creates when empty and updates when a row
   is being edited. These three helpers keep that behaviour identical everywhere
   instead of re-implementing it per section. */

/** Copies a record into the form, leaving fields the form does not have alone. */
function fillForm(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.querySelector(`[name="${name}"]`);
    if (field) field.value = value === undefined || value === null ? "" : value;
  }
}

/** Switches the form between "Create" and "Save changes", and reveals Cancel. */
function setFormEditing(form, editing) {
  const submit = form.querySelector('button[type="submit"]');
  const cancel = form.querySelector("[data-cancel-edit]");
  if (submit) submit.textContent = t(editing ? "admin.saveChanges" : "admin.create");
  if (cancel) cancel.hidden = !editing;
  form.dataset.editing = editing ? "1" : "";
}

/** Leaves edit mode and empties the form. */
function resetForm(form, status) {
  setFormEditing(form, false);
  form.reset();
  if (status) {
    status.className = "form-status admin-form-wide";
    status.textContent = "";
  }
}

/** Brings the form into view — the table can be a long scroll below it. */
function focusForm(form) {
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** A date for an <input type="date">, in LOCAL parts. Slicing the ISO string
 * would show the day in UTC, which is the day before for anywhere east of it. */
function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  const plant = v.plant_name || v.plant_type || t("admin.unknownPlant");
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
      if (isForbidden(err)) return setContent("[data-admin-queue]", forbiddenState());
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
  const isOwner = user.role === "super_admin";
  const suspended = user.status !== "active";
  const id = escapeHtml(user.user_id);

  // The owner can never be suspended, so offering the button would only produce
  // the API's refusal — it says "owner only" instead.
  const suspendButton = isOwner
    ? `<span class="pill is-off">${escapeHtml(t("admin.ownerOnly"))}</span>`
    : `<button type="button" class="btn btn-secondary" data-user="${id}" data-status="${suspended ? "active" : "suspended"}"${isSelf ? " disabled" : ""}>
          ${escapeHtml(suspended ? t("admin.activate") : t("admin.suspend"))}
        </button>`;

  return `
    <tr>
      <td>${escapeHtml(user.full_name)}${isSelf ? ` <span class="pill is-off">${escapeHtml(t("admin.you"))}</span>` : ""}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(t(ROLE_LABELS[user.role] || "admin.roleUser"))}</td>
      <td>${Number(user.total_points || 0).toLocaleString()}</td>
      <td>${suspended ? pill(t("admin.statusSuspended"), "is-warn") : pill(t("admin.statusActive"), "is-on")}</td>
      <td class="actions">
        <span class="row-actions">
          <button type="button" class="btn btn-ghost" data-view-user="${id}">${escapeHtml(t("admin.view"))}</button>
          ${suspendButton}
        </span>
      </td>
    </tr>
  `;
}

function initUsers() {
  let users = null;
  let search = "";

  const render = () => {
    if (users === null) return setContent("[data-admin-users]", loadingState("users"));
    if (!users.length) {
      // An empty search result is not the same as an empty platform, and saying
      // "nothing here yet" to a typo would be misleading.
      return setContent(
        "[data-admin-users]",
        search
          ? `<div class="empty-state">${iconMarkup("search")}${escapeHtml(t("admin.noResults"))}</div>`
          : emptyState()
      );
    }
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
      users = await api.get(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return setContent("[data-admin-users]", forbiddenState());
      return setContent("[data-admin-users]", errorState());
    }
    render();
  };

  // Typing narrows the list; the pause keeps it to one request per burst of keys
  // rather than one per keystroke.
  const field = host("[data-admin-user-search]");
  if (field) {
    let timer = null;
    field.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        search = field.value.trim();
        load();
      }, 250);
    });
  }

  host("[data-admin-host]").addEventListener("click", (e) => {
    const view = e.target.closest("[data-view-user]");
    if (view) return openUserDetail(view.getAttribute("data-view-user"));

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

  load();
  return { render, load };
}

/* ----------------------------------------------------------- most active */
/** The busiest members as a ranked list. Each row opens the same panel the
 * table's View button does — one detail view, two ways in. */
function activeRowHTML(user, index) {
  return `
    <li class="active-row">
      <span class="active-rank">${index + 1}</span>
      <div class="active-who">
        <span class="tx-label">${escapeHtml(user.full_name)}</span>
        <span class="tx-date">${escapeHtml(user.email)}</span>
      </div>
      <div class="active-counts">
        <span class="pill is-on">${escapeHtml(t("admin.photosTitle"))} ${Number(user.verifications_count || 0)}</span>
        <span class="pill is-off">${escapeHtml(t("admin.activityPlants"))} ${Number(user.plants_count || 0)}</span>
      </div>
      <button type="button" class="btn btn-ghost" data-view-user="${escapeHtml(user.user_id)}">${escapeHtml(t("admin.view"))}</button>
    </li>
  `;
}

function initMostActive() {
  let members = null;

  const render = () => {
    if (members === null) return setContent("[data-admin-active]", loadingState("users"));
    if (!members.length) return setContent("[data-admin-active]", emptyState());
    setContent(
      "[data-admin-active]",
      `<div class="admin-subhead">
        <h2 class="heading-md">${escapeHtml(t("admin.mostActiveTitle"))}</h2>
        <p class="section-lead">${escapeHtml(t("admin.mostActiveLead"))}</p>
      </div>
      <ol class="active-list">${members.map(activeRowHTML).join("")}</ol>`
    );
  };

  const load = async () => {
    members = null;
    render();
    try {
      members = await api.get("/admin/users/active?limit=5");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      if (isForbidden(err)) return setContent("[data-admin-active]", forbiddenState());
      return setContent("[data-admin-active]", errorState());
    }
    render();
  };

  load();
  return { render, load };
}

/* ------------------------------------------------------------ member panel */
/** One submission: the bounded preview, its verdict and when it arrived. The
 * predecessor of this screen shows admins the same preview in the queue; the
 * member's GPS coordinates and image hashes are deliberately not requested. */
function photoCardHTML(photo) {
  const verdict = VERDICT_LABELS[photo.approval_status] || "admin.pending";
  const variant =
    photo.approval_status === "approved" ? "is-on" : photo.approval_status === "rejected" ? "is-warn" : "is-off";
  const thumb = photo.image_url
    ? `<img class="photo-thumb" src="${escapeHtml(photo.image_url)}" alt="" />`
    : `<div class="photo-thumb" aria-hidden="true"></div>`;

  return `
    <figure class="photo-card">
      ${thumb}
      <figcaption>
        <span class="tx-label">${escapeHtml(photo.plant_type || t("admin.unknownPlant"))}</span>
        ${pill(t(verdict), variant)}
        <span class="tx-date">${escapeHtml(fmtDateTime(photo.created_at))}</span>
      </figcaption>
    </figure>
  `;
}

function userDetailHTML(detail) {
  const user = detail.user;
  const isSelf = me && user.user_id === me.user_id;
  const isOwner = user.role === "super_admin";
  // The API refuses suspending or demoting the owner, and locking yourself out,
  // so those two selects arrive disabled rather than failing on submit.
  const locked = isOwner || isSelf;
  const disabled = locked ? " disabled" : "";

  const option = (value, label, current) =>
    `<option value="${value}"${current === value ? " selected" : ""}>${escapeHtml(t(label))}</option>`;

  const photos = detail.photosPermitted
    ? detail.photos.length
      ? `<div class="photo-grid">${detail.photos.map(photoCardHTML).join("")}</div>`
      : `<p class="form-status">${escapeHtml(t("admin.photosEmpty"))}</p>`
    : `<p class="form-status">${escapeHtml(t("admin.photosNotPermitted"))}</p>`;

  return `
    <h2 class="heading-md" id="admin-modal-title">${escapeHtml(user.full_name)}</h2>
    <p class="tx-date">${escapeHtml(user.email)}</p>

    <div class="stat-grid user-stats">
      <div class="stat-card card">
        <strong data-balance-stat>${Number(detail.wallet.currentPoints || 0).toLocaleString()}</strong>
        <span>${escapeHtml(t("wallet.balance"))}</span>
      </div>
      <div class="stat-card card">
        <strong>${Number(detail.activity.plants_total || 0)}</strong>
        <span>${escapeHtml(t("admin.activityPlants"))}</span>
      </div>
      <div class="stat-card card">
        <strong>${Number(detail.activity.verifications_total || 0)}</strong>
        <span>${escapeHtml(t("admin.photosTitle"))}</span>
      </div>
      <div class="stat-card card">
        <strong>${Number(detail.wallet.totalEarned || 0).toLocaleString()}</strong>
        <span>${escapeHtml(t("wallet.earned"))}</span>
      </div>
    </div>

    <h3 class="user-section">${escapeHtml(t("admin.editProfile"))}</h3>
    <form class="admin-form" data-user-form>
      <div class="form-field">
        <label for="userDetailName">${escapeHtml(t("admin.colName"))}</label>
        <input id="userDetailName" name="fullName" value="${escapeHtml(user.full_name)}" />
      </div>
      <div class="form-field">
        <label for="userDetailCity">${escapeHtml(t("auth.city"))}</label>
        <input id="userDetailCity" name="city" value="${escapeHtml(user.city || "")}" />
      </div>
      <div class="form-field">
        <label for="userDetailRole">${escapeHtml(t("admin.colRole"))}</label>
        <select id="userDetailRole" name="role"${disabled}>
          ${option("user", "admin.roleUser", user.role)}
          ${option("admin", "admin.roleAdmin", user.role)}
        </select>
      </div>
      <div class="form-field">
        <label for="userDetailStatus">${escapeHtml(t("admin.colStatus"))}</label>
        <select id="userDetailStatus" name="status"${disabled}>
          ${option("active", "admin.statusActive", user.status)}
          ${option("suspended", "admin.statusSuspended", user.status)}
        </select>
      </div>
      <button type="submit" class="btn btn-primary">${escapeHtml(t("admin.saveChanges"))}</button>
      ${locked ? `<p class="form-status admin-form-wide">${escapeHtml(t("admin.lockedFields"))}</p>` : ""}
      <p class="form-status admin-form-wide" data-user-form-status role="status"></p>
    </form>

    <h3 class="user-section">${escapeHtml(t("admin.editBalance"))}</h3>
    <form class="admin-form" data-balance-form>
      <div class="form-field">
        <label for="userDetailDelta">${escapeHtml(t("admin.balanceDelta"))}</label>
        <input id="userDetailDelta" name="delta" type="number" step="1" inputmode="numeric" />
      </div>
      <div class="form-field">
        <label for="userDetailReason">${escapeHtml(t("admin.balanceReason"))}</label>
        <input id="userDetailReason" name="reason" placeholder="${escapeHtml(t("admin.balanceReasonPlaceholder"))}" />
      </div>
      <button type="submit" class="btn btn-accent">${escapeHtml(t("admin.applyAdjustment"))}</button>
      <p class="form-status admin-form-wide" data-balance-status role="status"></p>
    </form>

    <h3 class="user-section">
      ${escapeHtml(t("admin.photosTitle"))}
      <span class="pill is-off">${Number(detail.photosTotal || 0)}</span>
    </h3>
    ${photos}

    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" data-modal-close>${escapeHtml(t("admin.close"))}</button>
    </div>
  `;
}

/** Loads one member and wires the panel's two forms: the profile fields, and the
 * reasoned points adjustment. Both refresh the lists behind the modal on success. */
async function openUserDetail(userId) {
  openModal(loadingState("users"));

  let detail;
  try {
    detail = await api.get(`/admin/users/${encodeURIComponent(userId)}`);
  } catch (err) {
    if (isAuthError(err)) return toLogin();
    openModal(
      isForbidden(err)
        ? forbiddenState()
        : `<p class="form-status is-error">${escapeHtml(errorText(err))}</p>`
    );
    return;
  }

  openModal(userDetailHTML(detail));

  const profileForm = modal.body.querySelector("[data-user-form]");
  const profileStatus = modal.body.querySelector("[data-user-form-status]");
  profileForm.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(profileForm.querySelector('button[type="submit"]'), async () => {
      const body = {
        fullName: readField(profileForm, "fullName"),
        city: readField(profileForm, "city"),
      };
      // A disabled select is one the API would refuse anyway (the owner's, or your
      // own) — leave it out of the request rather than sending a no-op change.
      for (const name of ["role", "status"]) {
        const field = profileForm.querySelector(`[name="${name}"]`);
        if (field && !field.disabled) body[name] = field.value;
      }

      await api.patch(`/admin/users/${encodeURIComponent(userId)}`, body);
      profileStatus.className = "form-status admin-form-wide";
      profileStatus.textContent = t("admin.saved");
      await refreshUserViews();
    });
  });

  const balanceForm = modal.body.querySelector("[data-balance-form]");
  const balanceStatus = modal.body.querySelector("[data-balance-status]");
  balanceForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const delta = Number(readField(balanceForm, "delta"));
    const reason = readField(balanceForm, "reason");
    if (!Number.isInteger(delta) || delta === 0) {
      balanceStatus.className = "form-status is-error admin-form-wide";
      balanceStatus.textContent = t("admin.invalidDelta");
      return;
    }
    if (!reason) {
      balanceStatus.className = "form-status is-error admin-form-wide";
      balanceStatus.textContent = t("admin.reasonRequired");
      return;
    }

    withBusy(balanceForm.querySelector('button[type="submit"]'), async () => {
      const result = await api.post(`/admin/users/${encodeURIComponent(userId)}/points`, { delta, reason });
      const stat = modal.body.querySelector("[data-balance-stat]");
      if (stat) stat.textContent = Number(result.total_points || 0).toLocaleString();
      balanceStatus.className = "form-status admin-form-wide";
      balanceStatus.textContent = t("admin.balanceAdjusted");
      balanceForm.reset();
      await refreshUserViews();
    });
  });
}

/* ---------------------------------------------------------------- admins */
/* Who is staff, and what each of them may do.
 *
 * The checkbox list comes from the API's own catalogue (/admin/permissions), so it
 * cannot drift from what the server enforces, and a capability the caller does not
 * hold is DISABLED rather than hidden — seeing it greyed out is more honest than it
 * quietly missing. Only an admin holding admins.manage gets this far; the API
 * refuses everyone else whatever this file does.
 */
// One key per capability, so the catalogue stays translatable: the API sends
// permission keys and English descriptions, and these are the localised versions.
const PERMISSION_LABELS = {
  "users.manage": "admin.permUsers",
  "admins.manage": "admin.permAdmins",
  "verifications.review": "admin.permVerifications",
  "rewards.manage": "admin.permRewards",
  "partners.manage": "admin.permPartners",
  "content.manage": "admin.permContent",
  "analytics.view": "admin.permAnalytics",
};

function permissionLabel(key) {
  const labelKey = PERMISSION_LABELS[key];
  if (!labelKey) return key;
  const translated = t(labelKey);
  return translated === labelKey ? key : translated;
}

function permissionDescription(key, fallback) {
  const labelKey = PERMISSION_LABELS[key];
  if (!labelKey) return fallback;
  const translated = t(`${labelKey}Desc`);
  return translated === `${labelKey}Desc` ? fallback : translated;
}

function initAdmins() {
  const root = host("[data-admin-admins]");
  if (!root) return;

  let catalogue = null; // every capability, with its description
  let mine = [];        // what the signed-in admin holds
  let admins = null;    // the staff list
  let editing = null;   // the admin whose permissions the form is editing
  let notice = null;

  const isMe = (admin) => me && admin.id === me.id;
  // An admin who holds something you do not is not yours to edit: the API refuses
  // it, and offering the button would only produce that refusal.
  const canEdit = (admin) =>
    admin.role !== "super_admin" && !isMe(admin) && admin.permissions.every((key) => mine.includes(key));

  function permissionsHTML(selected) {
    return Object.entries(catalogue)
      .map(([key, description]) => {
        const allowed = mine.includes(key);
        return `
          <label class="perm-option"${allowed ? "" : ' data-locked="true"'}>
            <input type="checkbox" name="permission" value="${escapeHtml(key)}"${selected.includes(key) ? " checked" : ""}${allowed ? "" : " disabled"} />
            <span>
              <strong>${escapeHtml(permissionLabel(key))}</strong>
              <span>${escapeHtml(permissionDescription(key, description))}${allowed ? "" : ` — ${escapeHtml(t("admin.ownerOnly"))}`}</span>
            </span>
          </label>`;
      })
      .join("");
  }

  function permissionPills(admin) {
    if (admin.role === "super_admin") return pill(t("admin.allPermissions"), "is-on");
    if (!admin.permissions.length) return pill(t("admin.noPermissions"), "is-off");
    return admin.permissions
      .map((key) => `<span class="pill is-on">${escapeHtml(permissionLabel(key))}</span>`)
      .join("");
  }

  function rowHTML(admin) {
    const actions = canEdit(admin)
      ? `<button type="button" class="btn btn-secondary" data-edit-admin="${escapeHtml(admin.id)}">${escapeHtml(t("admin.editPermissions"))}</button>
         <button type="button" class="btn btn-secondary" data-remove-admin="${escapeHtml(admin.id)}">${escapeHtml(t("admin.removeAdmin"))}</button>`
      : isMe(admin) || admin.role === "super_admin"
        ? ""
        : `<span class="pill is-off">${escapeHtml(t("admin.ownerOnly"))}</span>`;

    return `
      <tr>
        <td>${escapeHtml(admin.fullName)}${isMe(admin) ? ` <span class="pill is-off">${escapeHtml(t("admin.you"))}</span>` : ""}</td>
        <td>${escapeHtml(admin.email)}</td>
        <td>${escapeHtml(t(ROLE_LABELS[admin.role] || "admin.roleUser"))}</td>
        <td class="perm-cell">${permissionPills(admin)}</td>
        <td class="actions">${actions}</td>
      </tr>`;
  }

  const render = () => {
    if (!catalogue || admins === null) return;

    const person = editing ? admins.find((a) => a.id === editing) : null;
    const checked = person ? person.permissions : [];

    root.hidden = false;
    root.innerHTML = `
      <div class="section-head admin-subhead">
        <h2 class="heading-md">${escapeHtml(t("admin.adminsTitle"))}</h2>
        <p class="section-lead">${escapeHtml(t("admin.adminsLead"))}</p>
      </div>
      ${notice ? `<p class="form-status is-error">${escapeHtml(notice)}</p>` : ""}
      <form class="admin-form" data-admin-form>
        <div class="form-field">
          <label for="adminEmail">${escapeHtml(t("admin.adminEmail"))}</label>
          <input id="adminEmail" name="email" type="email" autocomplete="off" required
                 value="${person ? escapeHtml(person.email) : ""}"${person ? " readonly" : ""} />
        </div>
        <div class="form-field admin-form-wide">
          <label>${escapeHtml(t("admin.adminPermissions"))}</label>
          <div class="perm-grid">${permissionsHTML(checked)}</div>
        </div>
        <button type="submit" class="btn btn-primary">
          ${escapeHtml(person ? t("admin.savePermissions") : t("admin.addAdmin"))}
        </button>
        ${person ? `<button type="button" class="btn btn-secondary" data-cancel-edit>${escapeHtml(t("admin.cancel"))}</button>` : ""}
      </form>
      ${
        admins.length
          ? `<div class="table-wrap"><table class="admin-table">
              <thead><tr>
                <th>${escapeHtml(t("admin.colName"))}</th>
                <th>${escapeHtml(t("admin.colEmail"))}</th>
                <th>${escapeHtml(t("admin.colRole"))}</th>
                <th>${escapeHtml(t("admin.colPermissions"))}</th>
                <th><span class="visually-hidden">${escapeHtml(t("admin.colActions"))}</span></th>
              </tr></thead>
              <tbody>${admins.map(rowHTML).join("")}</tbody>
            </table></div>`
          : emptyState()
      }`;
  };

  const load = async () => {
    try {
      const meta = await api.get("/admin/permissions");
      catalogue = meta.catalogue || {};
      mine = meta.mine || [];
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      return; // no admins.manage — the section stays out of the way
    }
    if (!mine.includes("admins.manage")) return;

    try {
      admins = await api.get("/admin/admins");
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      admins = [];
      notice = errorText(err);
    }
    render();
  };

  root.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-admin-form]");
    if (!form) return;
    e.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const permissions = Array.from(root.querySelectorAll('input[name="permission"]:checked')).map((el) => el.value);
    const email = readField(form, "email").toLowerCase();

    withBusy(button, async () => {
      if (editing) {
        const updated = await api.patch(`/admin/admins/${encodeURIComponent(editing)}`, { permissions });
        admins = admins.map((a) => (a.id === updated.id ? updated : a));
        editing = null;
      } else {
        const created = await api.post("/admin/admins", { email, permissions });
        admins = [...admins, created];
      }
      notice = null;
      render();
    });
  });

  root.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit-admin]");
    if (edit) {
      editing = edit.getAttribute("data-edit-admin");
      notice = null;
      render();
      return;
    }
    if (e.target.closest("[data-cancel-edit]")) {
      editing = null;
      render();
      return;
    }
    const remove = e.target.closest("[data-remove-admin]");
    if (!remove) return;

    const admin = admins.find((a) => a.id === remove.getAttribute("data-remove-admin"));
    if (!admin || !window.confirm(`${t("admin.removeAdminConfirm")} ${admin.email}`)) return;

    withBusy(remove, async () => {
      const updated = await api.delete(`/admin/admins/${encodeURIComponent(admin.id)}`);
      admins = admins.map((a) => (a.id === updated.id ? updated : a));
      if (editing === updated.id) editing = null;
      render();
    });
  });

  // Returns its repaint and reload pair so the users page can compose every one
  // of its sections into a single hook (see the boot below).
  load();
  return { render, load };
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
        <button type="button" class="btn btn-secondary" data-edit-partner="${escapeHtml(partner.partner_id)}">${escapeHtml(t("admin.edit"))}</button>
        <button type="button" class="btn btn-secondary" data-partner="${escapeHtml(partner.partner_id)}" data-active="${partner.is_active ? "false" : "true"}">
          ${escapeHtml(partner.is_active ? t("admin.deactivate") : t("admin.activate"))}
        </button>
      </td>
    </tr>
  `;
}

function initPartners() {
  let partners = null;
  let editingId = null;

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
      if (isForbidden(err)) return setContent("[data-admin-partners]", forbiddenState());
      return setContent("[data-admin-partners]", errorState());
    }
    render();
  };

  const root = host("[data-admin-host]");
  const form = root.querySelector("[data-partner-form]");
  const status = form.querySelector("[data-form-status]");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = {
      name: readField(form, "name"),
      website: readField(form, "website") || null,
      contactEmail: readField(form, "contactEmail") || null,
      description: readField(form, "description") || null,
      logoUrl: readField(form, "logoUrl") || null,
    };

    withBusy(form.querySelector('button[type="submit"]'), async () => {
      // One form, two jobs: it updates the row being edited, otherwise creates.
      if (editingId) await api.patch(`/admin/partners/${encodeURIComponent(editingId)}`, payload);
      else await api.post("/admin/partners", payload);

      editingId = null;
      resetForm(form, status);
      status.className = "form-status admin-form-wide is-success";
      status.textContent = t("admin.saved");
      await load();
    });
  });

  form.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cancel-edit]")) return;
    editingId = null;
    resetForm(form, status);
  });

  root.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit-partner]");
    if (edit) {
      const partner = (partners || []).find((p) => p.partner_id === edit.getAttribute("data-edit-partner"));
      if (!partner) return;
      editingId = partner.partner_id;
      fillForm(form, {
        name: partner.name,
        website: partner.website,
        contactEmail: partner.contact_email,
        description: partner.description,
        logoUrl: partner.logo_url,
      });
      setFormEditing(form, true);
      focusForm(form);
      return;
    }

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
        <button type="button" class="btn btn-secondary" data-edit-reward="${escapeHtml(reward.reward_id)}">${escapeHtml(t("admin.edit"))}</button>
        <button type="button" class="btn btn-secondary" data-reward="${escapeHtml(reward.reward_id)}" data-active="${reward.is_active ? "false" : "true"}">
          ${escapeHtml(reward.is_active ? t("admin.deactivate") : t("admin.activate"))}
        </button>
      </td>
    </tr>
  `;
}

function initRewards() {
  let rewards = null;
  let editingId = null;

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
      if (isForbidden(err)) return setContent("[data-admin-rewards]", forbiddenState());
      return setContent("[data-admin-rewards]", errorState());
    }
    render();
  };

  const root = host("[data-admin-host]");
  const form = root.querySelector("[data-reward-form]");
  const status = form.querySelector("[data-form-status]");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = {
      partner: readField(form, "partner"),
      category: readField(form, "category"),
      title: readField(form, "title"),
      description: readField(form, "description") || null,
      pointsRequired: Number(readField(form, "pointsRequired")),
      expiresAt: readField(form, "expiresAt") || null,
    };

    withBusy(form.querySelector('button[type="submit"]'), async () => {
      if (editingId) await api.patch(`/admin/rewards/${encodeURIComponent(editingId)}`, payload);
      else await api.post("/admin/rewards", payload);

      editingId = null;
      resetForm(form, status);
      status.className = "form-status admin-form-wide is-success";
      status.textContent = t("admin.saved");
      await load();
    });
  });

  form.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cancel-edit]")) return;
    editingId = null;
    resetForm(form, status);
  });

  root.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit-reward]");
    if (edit) {
      const reward = (rewards || []).find((r) => r.reward_id === edit.getAttribute("data-edit-reward"));
      if (!reward) return;
      editingId = reward.reward_id;
      fillForm(form, {
        partner: reward.partner,
        category: reward.category,
        title: reward.title,
        description: reward.description,
        pointsRequired: reward.points_required,
        expiresAt: toDateInput(reward.expires_at),
      });
      setFormEditing(form, true);
      focusForm(form);
      return;
    }

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
        <button type="button" class="btn btn-secondary" data-edit-article="${escapeHtml(article.id)}">${escapeHtml(t("admin.edit"))}</button>
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
  let editingId = null;

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
      if (isForbidden(err)) return setContent("[data-admin-content]", forbiddenState());
      return setContent("[data-admin-content]", errorState());
    }
    render();
  };

  const root = host("[data-admin-host]");
  const form = root.querySelector("[data-content-form]");
  const status = form.querySelector("[data-form-status]");

  /** The body is one paragraph per line in the form, an array in the API. */
  const bodyLines = () =>
    readField(form, "body")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const readingTime = readField(form, "readingTime");
    const payload = {
      slug: readField(form, "slug"),
      title: readField(form, "title"),
      description: readField(form, "description") || null,
      category: readField(form, "category"),
      body: bodyLines(),
      imageUrl: readField(form, "imageUrl") || null,
      readingTime: readingTime ? Number(readingTime) : null,
    };

    withBusy(form.querySelector('button[type="submit"]'), async () => {
      if (editingId) await api.patch(`/admin/content/${encodeURIComponent(editingId)}`, payload);
      else await api.post("/admin/content", payload);

      editingId = null;
      resetForm(form, status);
      status.className = "form-status admin-form-wide is-success";
      status.textContent = t("admin.saved");
      await load();
    });
  });

  form.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cancel-edit]")) return;
    editingId = null;
    resetForm(form, status);
  });

  root.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit-article]");
    if (edit) {
      const article = (articles || []).find((a) => a.id === edit.getAttribute("data-edit-article"));
      if (!article) return;
      editingId = article.id;
      fillForm(form, {
        slug: article.slug,
        title: article.title,
        description: article.description,
        category: article.category,
        body: (article.body || []).join("\n"),
        imageUrl: article.imageUrl,
        readingTime: article.readingTime,
      });
      setFormEditing(form, true);
      focusForm(form);
      return;
    }

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
      if (editingId === remove.getAttribute("data-delete")) {
        editingId = null;
        resetForm(form, status);
      }
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
      if (isForbidden(err)) return setContent("[data-admin-analytics]", forbiddenState());
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
  // The users page hosts three sections — the ranking, the member table and admin
  // management — all on one boot.
  if (host("[data-admin-users]")) {
    return boot(async () => {
      const sections = [initUsers()];
      if (host("[data-admin-active]")) sections.push(initMostActive());
      sections.push(initAdmins());

      // admin.js has a single repaint hook, so every section on this page is
      // composed into it: a language change repaints all of them, not just the
      // last one to have been initialised.
      renderCurrent = () => sections.forEach((section) => section.render());
      // An edit in the member panel can change a row either list is showing.
      refreshUserViews = () => Promise.all(sections.map((section) => section.load()));
    });
  }
  if (host("[data-admin-partners]")) return boot(initPartners);
  if (host("[data-admin-rewards]")) return boot(initRewards);
  if (host("[data-admin-content]")) return boot(initContent);
  if (host("[data-admin-analytics]")) return boot(initAnalytics);
});

document.addEventListener("greenomy:translated", () => renderCurrent());
