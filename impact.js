// impact.js — live impact counters on the homepage
import { getImpactStats } from "./impactserviece.js";

function animateValue(el, target, duration = 1400) {
  const start = 0;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(start + (target - start) * eased);
    el.textContent = value.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function initImpactCounters() {
  const section = document.querySelector("[data-impact-section]");
  if (!section) return;

  const { data } = await getImpactStats();

  const map = {
    plantsGrown: section.querySelector('[data-stat="plants"]'),
    seedsStarted: section.querySelector('[data-stat="seeds"]'),
    co2ImpactKg: section.querySelector('[data-stat="co2"]'),
    members: section.querySelector('[data-stat="members"]'),
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        Object.entries(map).forEach(([key, el]) => {
          if (el && typeof data[key] === "number") animateValue(el, data[key]);
        });
        observer.disconnect();
      });
    },
    { threshold: 0.3 }
  );

  observer.observe(section);
}

document.addEventListener("DOMContentLoaded", initImpactCounters);