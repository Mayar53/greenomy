// camera.js — capture a plant photo, measure it on a canvas, and submit it for
// verification. The measurements (green ratio, sharpness, brightness) are taken
// here because the browser already has the pixels; the scoring policy lives on
// the server (backend/services/verification-provider.js).
import { requireAuthOrRedirect, fetchCurrentUser } from "./authservise.js";
import { listMyPlants } from "./serviseplant.js";
import { submitVerification } from "./verifyservice.js";
import { ApiError } from "./servisapi.js";
import { t } from "./language.js";

const SAMPLE = 160;      // analysis size, longest edge (px)
const PREVIEW_MAX = 720; // stored photo size, longest edge (px)
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // matches the API's 5mb JSON body limit

let stream = null;
let photoDataUrl = null;
let pixelStats = null;
let coords = null;

const el = {
  empty: document.querySelector("[data-verify-empty]"),
  form: document.querySelector("[data-verify-form]"),
  select: document.querySelector("[data-plant-select]"),
  video: document.querySelector("[data-camera-video]"),
  preview: document.querySelector("[data-camera-preview]"),
  placeholder: document.querySelector("[data-camera-placeholder]"),
  status: document.querySelector("[data-camera-status]"),
  start: document.querySelector("[data-camera-start]"),
  capture: document.querySelector("[data-camera-capture]"),
  retake: document.querySelector("[data-camera-retake]"),
  file: document.querySelector("[data-camera-file]"),
  locationBtn: document.querySelector("[data-location-btn]"),
  locationState: document.querySelector("[data-location-state]"),
  submit: document.querySelector("[data-verify-submit]"),
  formStatus: document.querySelector("[data-form-status]"),
  result: document.querySelector("[data-verify-result]"),
  scoreValue: document.querySelector("[data-score-value]"),
  verdict: document.querySelector("[data-verdict-text]"),
  points: document.querySelector("[data-points-text]"),
  again: document.querySelector("[data-verify-again]"),
};

function cameraStatus(message, isError) {
  el.status.hidden = !message;
  el.status.textContent = message || "";
  el.status.classList.toggle("is-error", Boolean(isError));
}

function setStatus(mode, message) {
  el.formStatus.className = `form-status is-${mode}`;
  el.formStatus.textContent = message;
}

function errorText(err) {
  return err instanceof ApiError ? err.message : t("verify.error");
}

function stopStream() {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
}

function toDataUrl(source, width, height) {
  const scale = Math.min(1, PREVIEW_MAX / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/** Draws the photo small, then reads the pixels back to describe it. */
function analyse(source, width, height) {
  const scale = Math.min(1, SAMPLE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lum = new Float32Array(w * h);
  let green = 0;
  let lumSum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[p] = l;
    lumSum += l;
    if (g > 40 && g > r * 1.08 && g > b * 1.05) green += 1;
  }

  let gradient = 0;
  for (let y = 1; y < h; y += 1) {
    for (let x = 1; x < w; x += 1) {
      const i = y * w + x;
      gradient += Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - w]);
    }
  }

  const total = w * h;
  const edges = (w - 1) * (h - 1);
  pixelStats = {
    greenRatio: Number((green / total).toFixed(4)),
    brightness: Number((lumSum / total / 255).toFixed(4)),
    sharpness: Number((gradient / edges).toFixed(2)),
  };
  photoDataUrl = toDataUrl(source, width, height);
  return pixelStats;
}

function showCaptured() {
  el.preview.src = photoDataUrl;
  el.preview.hidden = false;
  el.video.hidden = true;
  el.placeholder.hidden = true;
  el.start.hidden = true;
  el.capture.hidden = true;
  el.retake.hidden = false;
  cameraStatus("");
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraStatus(t("verify.cameraUnavailable"), true);
    return;
  }
  // Browsers expose the camera only in a secure context (https, or localhost).
  // Reached over a LAN address this looks like a broken camera, so say why.
  if (!window.isSecureContext) {
    cameraStatus(t("verify.cameraInsecure"), true);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    el.video.srcObject = stream;
    await el.video.play().catch(() => {});
    el.video.hidden = false;
    el.placeholder.hidden = true;
    el.start.hidden = true;
    el.capture.hidden = false;

    // The stream is live the moment getUserMedia resolves, but the element has
    // no frame to capture until metadata has loaded. Pressing Capture before
    // then used to report "camera unavailable", which was simply wrong.
    el.capture.disabled = true;
    cameraStatus(t("verify.cameraStarting"));

    const markReady = () => {
      el.capture.disabled = false;
      cameraStatus("");
    };
    if (el.video.videoWidth) markReady();
    else el.video.addEventListener("loadedmetadata", markReady, { once: true });
  } catch (err) {
    cameraStatus(t("verify.cameraUnavailable"), true);
  }
}

function captureFrame() {
  if (!el.video.videoWidth) {
    // Tapping too early is not a failure — say so instead of blaming the camera.
    cameraStatus(t("verify.cameraStarting"), true);
    return;
  }
  analyse(el.video, el.video.videoWidth, el.video.videoHeight);
  stopStream();
  showCaptured();
}

function loadFile(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    cameraStatus(t("verify.errFileType"), true);
    el.file.value = "";
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    cameraStatus(t("verify.errFileSize"), true);
    el.file.value = "";
    return;
  }

  const img = new Image();
  img.onload = () => {
    analyse(img, img.naturalWidth, img.naturalHeight);
    URL.revokeObjectURL(img.src);
    showCaptured();
  };
  img.onerror = () => cameraStatus(t("verify.cameraUnavailable"), true);
  img.src = URL.createObjectURL(file);
}

function retake() {
  photoDataUrl = null;
  pixelStats = null;
  el.preview.hidden = true;
  el.preview.removeAttribute("src");
  el.placeholder.hidden = false;
  el.retake.hidden = true;
  el.start.hidden = false;
  el.file.value = "";
  cameraStatus("");
  setStatus("", "");
}

function attachLocation() {
  if (!navigator.geolocation) {
    cameraStatus(t("verify.locationDenied"), true);
    return;
  }
  el.locationBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      el.locationState.textContent = t("verify.locationAdded");
      el.locationState.hidden = false;
      el.locationBtn.disabled = false;
    },
    () => {
      cameraStatus(t("verify.locationDenied"), true);
      el.locationBtn.disabled = false;
    },
    { timeout: 8000, maximumAge: 60000 }
  );
}

function showResult(record) {
  const confidence = Math.round((record.ai_confidence_score || 0) * 100);
  const approved = record.approval_status === "approved";
  el.form.hidden = true;
  el.result.hidden = false;
  el.scoreValue.textContent = `${confidence}%`;
  el.result.classList.toggle("is-approved", approved);
  el.verdict.textContent = approved ? t("verify.approved") : t("verify.pending");
  el.verdict.className = `verify-verdict ${approved ? "is-approved" : "is-pending"}`;
  el.points.textContent = "";
  if (approved) {
    fetchCurrentUser()
      .then((user) => {
        if (user && typeof user.totalPoints === "number") {
          el.points.textContent = `${t("verify.pointsEarned")}: ${user.totalPoints.toLocaleString()}`;
        }
      })
      .catch(() => {});
  }
}

async function submit() {
  if (!photoDataUrl || !pixelStats) {
    setStatus("error", t("verify.noPhoto"));
    return;
  }
  const plantId = el.select.value;
  if (!plantId) {
    setStatus("error", t("verify.choosePlant"));
    return;
  }

  el.submit.disabled = true;
  setStatus("loading", t("verify.analyzing"));

  try {
    const record = await submitVerification({
      plantId,
      imageUrl: photoDataUrl,
      gpsLat: coords ? coords.lat : undefined,
      gpsLong: coords ? coords.lon : undefined,
      pixelStats,
    });
    showResult(record);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      window.location.href = "login.html";
      return;
    }
    setStatus("error", errorText(err));
  } finally {
    el.submit.disabled = false;
  }
}

async function init() {
  if (!requireAuthOrRedirect("login.html")) return;

  try {
    const plants = await listMyPlants();
    if (!plants.length) {
      el.empty.hidden = false;
      return;
    }
    plants.forEach((plant) => {
      const option = document.createElement("option");
      option.value = plant.plant_id;
      option.textContent = plant.location ? `${plant.plant_type} · ${plant.location}` : plant.plant_type;
      el.select.appendChild(option);
    });
    el.form.hidden = false;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      window.location.href = "login.html";
      return;
    }
    el.empty.hidden = false;
  }

  el.start.addEventListener("click", startCamera);
  el.capture.addEventListener("click", captureFrame);
  el.retake.addEventListener("click", retake);
  el.file.addEventListener("change", (e) => loadFile(e.target.files && e.target.files[0]));
  el.locationBtn.addEventListener("click", attachLocation);
  el.submit.addEventListener("click", submit);
  el.again.addEventListener("click", () => {
    el.result.hidden = true;
    el.form.hidden = false;
    retake();
  });
}

document.addEventListener("DOMContentLoaded", init);
