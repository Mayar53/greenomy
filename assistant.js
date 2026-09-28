// assistant.js — the gardening assistant, as a persistent launcher.
//
// It used to be a card at the very bottom of the garden page: the last thing on
// a long page, so members never found it. The same conversation now lives in a
// panel opened from a button that is always on screen, on every member page.
//
// A photo can be attached to a question — the fastest way to diagnose a sick
// plant. The browser downscales it on a canvas before sending (a phone photo is
// several megabytes and a diagnosis does not need them), it travels as a data
// URL, and the server stores nothing: the image exists only for that one
// question.
import { api, ApiError } from "./servisapi.js";
import { t, localized, currentLanguage } from "./language.js";
import { isAuthenticated } from "./authservise.js";
import { iconMarkup, initIcons } from "./icons.js";
import { getGreenHubArticles } from "./contentservice.js";

const HISTORY_TURNS = 8;
const MAX_FILE_BYTES = 12 * 1024 * 1024; // the file the member picks
const MAX_EDGE = 1280; // longest side actually sent
const JPEG_QUALITY = 0.85;
const EXPANDED_KEY = "greenomy:assistantExpanded";

/** Titles for the guides an answer was grounded in, so a reply can link back to
 * what it drew on. Fetched once per session; failure just means no links. */
let guideTitlesRequest = null;
function guideTitles() {
  if (!guideTitlesRequest) {
    guideTitlesRequest = getGreenHubArticles()
      .then(({ data }) => {
        const titles = new Map();
        (data || []).forEach((article) => titles.set(article.slug, localized(article, "title") || article.slug));
        return titles;
      })
      .catch(() => new Map());
  }
  return guideTitlesRequest;
}

/** Built with textContent, never innerHTML: the reply is model output, so it
 * must never be treated as markup. */
function appendMessage(thread, who, text, sources = [], photoUrl = null) {
  if (!thread) return;

  const bubble = document.createElement("div");
  bubble.className = `assistant-msg is-${who === "you" ? "user" : "bot"}`;

  const label = document.createElement("span");
  label.className = "assistant-who";
  label.textContent = who === "you" ? t("assistant.you") : t("assistant.answerLabel");

  bubble.appendChild(label);

  if (photoUrl) {
    const image = document.createElement("img");
    image.className = "assistant-msg-image";
    image.src = photoUrl;
    image.alt = t("assistant.photoAlt");
    bubble.appendChild(image);
  }

  if (text) bubble.appendChild(document.createTextNode(text));

  if (sources.length) {
    const line = document.createElement("span");
    line.className = "assistant-sources";
    line.append(`${t("assistant.sources")}: `);
    sources.forEach((source, index) => {
      if (index) line.append(", ");
      const link = document.createElement("a");
      link.href = `greenhub.html?slug=${encodeURIComponent(source.slug)}`;
      link.textContent = source.title;
      line.appendChild(link);
    });
    bubble.appendChild(line);
  }

  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
}

/** A small aside under a reply — used when the photo could not be looked at, so
 * a canned answer is never passed off as a sighted one. */
function appendNote(thread, text) {
  const note = document.createElement("p");
  note.className = "assistant-note";
  note.textContent = text;
  thread.appendChild(note);
  thread.scrollTop = thread.scrollHeight;
}

function buildWidget() {
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "assistant-launcher";
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = `${iconMarkup("chat")}<span>${escapeText(t("assistant.title"))}</span>`;

  const panel = document.createElement("section");
  panel.className = "assistant-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", t("assistant.title"));
  panel.innerHTML = `
    <div class="assistant-panel-head">
      <h2 class="heading-sm" data-assistant-heading></h2>
      <div class="assistant-panel-tools">
        <button type="button" class="assistant-tool" data-assistant-expand data-icon="expand" aria-pressed="false"></button>
        <button type="button" class="assistant-tool" data-assistant-close data-icon="close"></button>
      </div>
    </div>
    <p class="form-note" data-assistant-lead></p>
    <div class="assistant-thread" data-assistant-thread></div>
    <form data-assistant-form novalidate>
      <div class="assistant-attachment" data-assistant-attachment hidden>
        <img class="assistant-attachment-thumb" data-assistant-thumb alt="" />
        <span class="assistant-attachment-name" data-assistant-attachment-name></span>
        <button type="button" class="assistant-attach-remove" data-assistant-attach-remove data-icon="close"></button>
      </div>
      <div class="form-field">
        <label for="assistantMessage" data-assistant-label></label>
        <textarea id="assistantMessage" name="message" rows="1" autocomplete="off"></textarea>
      </div>
      <div class="assistant-form-actions">
        <button type="button" class="assistant-attach" data-assistant-attach>
          <span data-icon="camera"></span>
          <span data-assistant-attach-label></span>
        </button>
        <button type="submit" class="btn btn-primary" data-assistant-send></button>
      </div>
      <input type="file" accept="image/*" data-assistant-file hidden />
      <div class="form-status" data-form-status role="status" aria-live="polite"></div>
    </form>`;

  return { launcher, panel };
}

/** The strings the panel renders, in the current language. */
function paintStrings(panel, launcher) {
  panel.querySelector("[data-assistant-heading]").textContent = t("assistant.title");
  panel.querySelector("[data-assistant-lead]").textContent = t("assistant.lead");
  panel.querySelector("[data-assistant-label]").textContent = t("assistant.label");
  panel.querySelector("[data-assistant-send]").textContent = t("assistant.send");
  panel.querySelector("[data-assistant-attach-label]").textContent = t("assistant.attach");
  panel.querySelector("[data-assistant-attach]").title = t("assistant.attachHint");
  panel.querySelector("[data-assistant-attach-remove]").setAttribute("aria-label", t("assistant.removePhoto"));
  panel.querySelector("[data-assistant-expand]").setAttribute("aria-label", t("assistant.resize"));
  panel.querySelector("[data-assistant-close]").setAttribute("aria-label", t("share.close"));
  panel.querySelector("#assistantMessage").placeholder = t("assistant.placeholder");
  const thumb = panel.querySelector("[data-assistant-thumb]");
  if (thumb) thumb.alt = t("assistant.photoAlt");
  launcher.querySelector("span").textContent = t("assistant.title");
}

/** Small text escape for the one place we build markup from a translated string
 * before the real elements exist. Everything a model returns still goes through
 * textContent. */
function escapeText(value) {
  const holder = document.createElement("span");
  holder.textContent = String(value == null ? "" : value);
  return holder.innerHTML;
}

/** Shrinks a chosen photo on a canvas and returns it as a jpeg data URL. */
function downscale(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("unreadable image"));
    };
    img.src = objectUrl;
  });
}

export function initAssistantWidget() {
  // Members only: the endpoint needs a session, and a visitor on the marketing
  // pages has nothing to ask about yet.
  if (!isAuthenticated()) return;
  if (document.querySelector(".assistant-launcher")) return;

  const { launcher, panel } = buildWidget();
  document.body.append(launcher, panel);

  const thread = panel.querySelector("[data-assistant-thread]");
  const form = panel.querySelector("[data-assistant-form]");
  const status = form.querySelector("[data-form-status]");
  const input = form.querySelector("#assistantMessage");
  const fileInput = form.querySelector("[data-assistant-file]");
  const attachRow = form.querySelector("[data-assistant-attachment]");
  const thumb = form.querySelector("[data-assistant-thumb]");
  const attachName = form.querySelector("[data-assistant-attachment-name]");
  const expandBtn = panel.querySelector("[data-assistant-expand]");
  const history = [];

  // The photo waiting to be sent with the next question.
  let attachment = null;

  paintStrings(panel, launcher);
  initIcons();

  const setStatus = (text, isError = false) => {
    status.className = isError ? "form-status is-error" : "form-status";
    status.textContent = text || "";
  };

  const setAttachment = (next) => {
    attachment = next;
    attachRow.hidden = !next;
    if (next) {
      thumb.src = next.dataUrl;
      attachName.textContent = next.name;
    } else {
      thumb.removeAttribute("src");
      attachName.textContent = "";
    }
  };

  // The question box grows with what is typed, up to a point.
  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    // Enter sends; Shift+Enter is a new line.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.querySelector("[data-assistant-attach]").addEventListener("click", () => fileInput.click());
  form.querySelector("[data-assistant-attach-remove]").addEventListener("click", () => {
    setAttachment(null);
    setStatus("");
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus(t("assistant.photoTooLarge"), true);
      return;
    }
    try {
      setStatus(t("assistant.thinking"));
      const dataUrl = await downscale(file);
      setAttachment({ dataUrl, name: file.name || t("assistant.photoAlt") });
      setStatus("");
      input.focus();
    } catch {
      setStatus(t("assistant.photoFailed"), true);
    }
  });

  // A bigger panel, remembered across pages.
  const setExpanded = (expanded) => {
    panel.classList.toggle("is-expanded", expanded);
    expandBtn.setAttribute("aria-pressed", String(expanded));
    try {
      localStorage.setItem(EXPANDED_KEY, expanded ? "1" : "0");
    } catch {
      /* a stored preference is a nicety, not a requirement */
    }
  };
  let wantedExpanded = false;
  try {
    wantedExpanded = localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    /* ignore */
  }
  setExpanded(wantedExpanded);
  expandBtn.addEventListener("click", () => setExpanded(!panel.classList.contains("is-expanded")));

  const setOpen = (open) => {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(() => input.focus(), 0);
  };
  const isOpen = () => !panel.hidden;

  launcher.addEventListener("click", () => setOpen(!isOpen()));
  panel.querySelector("[data-assistant-close]").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen() && !panel.classList.contains("is-expanded")) setOpen(false);
  });
  // A tap anywhere outside the panel closes it, as on the nav menu.
  document.addEventListener("click", (e) => {
    if (!isOpen()) return;
    if (panel.contains(e.target) || launcher.contains(e.target)) return;
    setOpen(false);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const message = input.value.trim();
    const sentPhoto = attachment ? attachment.dataUrl : null;
    // A photo on its own is a question too ("what is wrong with this?").
    if (!message && !sentPhoto) return;

    appendMessage(thread, "you", message, [], sentPhoto);
    input.value = "";
    autosize();
    setAttachment(null);
    submitBtn.disabled = true;
    setStatus(t("assistant.thinking"));

    try {
      // The language is sent so a reply that falls back to our own guide text
      // comes back in the language the member is reading.
      const data = await api.post("/ai/assistant", {
        message,
        lang: currentLanguage(),
        history,
        image: sentPhoto,
      });

      const titles = data.sources && data.sources.length ? await guideTitles() : null;
      const sources = titles ? data.sources.map((slug) => ({ slug, title: titles.get(slug) || slug })) : [];
      appendMessage(thread, "bot", data.reply, sources);
      // Never let a photo be silently ignored: say when it was not looked at.
      if (data.photoNotSeen) appendNote(thread, t("assistant.photoNotSeen"));
      setStatus("");

      // Remember this exchange so the next question has the context. The photo
      // is deliberately not part of it: it belongs to the question it was sent
      // with, and re-sending it would cost every later turn.
      history.push({ role: "user", content: message }, { role: "assistant", content: data.reply });
      if (history.length > HISTORY_TURNS * 2) history.splice(0, history.length - HISTORY_TURNS * 2);
    } catch (err) {
      // A 503 here means no AI key is configured — the API's message says so.
      setStatus(err instanceof ApiError ? err.message : t("assistant.error"), true);
    } finally {
      submitBtn.disabled = false;
      input.focus();
    }
  });

  // A language switch repaints the panel's own strings.
  document.addEventListener("greenomy:translated", () => paintStrings(panel, launcher));
}

document.addEventListener("DOMContentLoaded", initAssistantWidget);
