const statusDot = document.querySelector("#status-dot");
const siteCount = document.querySelector("#site-count");
const siteList = document.querySelector("#site-list");
const siteForm = document.querySelector("#add-site-form");
const siteInput = document.querySelector("#site-input");
const formError = document.querySelector("#form-error");
const controls = document.querySelector("#setup-controls");
const focusInput = document.querySelector("#focus-minutes");
const breakInput = document.querySelector("#break-minutes");
const totalInput = document.querySelector("#total-minutes");
const startButton = document.querySelector("#start-button");
const durationError = document.querySelector("#duration-error");
const sessionPanel = document.querySelector("#session-panel");
const sessionKicker = document.querySelector("#session-kicker");
const sessionPhase = document.querySelector("#session-phase");
const sessionClock = document.querySelector("#session-clock");
const stopButton = document.querySelector("#stop-button");

let sites = [];
let studySettings = { focusMinutes: 25, breakMinutes: 5, totalMinutes: 120 };
let studySession = null;
let enabled = false;

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderSession() {
  const isStudying = Boolean(studySession?.active);
  sessionPanel.hidden = !isStudying;
  if (!isStudying) {
    statusDot.classList.toggle("is-on", enabled);
    return;
  }

  const isFocus = studySession.phase === "focus";
  sessionKicker.textContent = `STUDY SESSION · ${formatTime(studySession.endsAt - Date.now())} LEFT`;
  sessionPhase.textContent = isFocus ? "Focus time" : "Break time";
  sessionClock.textContent = formatTime(studySession.phaseEndsAt - Date.now());
  statusDot.classList.toggle("is-on", enabled);
}

function render() {
  const isStudying = Boolean(studySession?.active);
  controls.disabled = isStudying;
  focusInput.value = String(studySettings.focusMinutes);
  breakInput.value = String(studySettings.breakMinutes);
  totalInput.value = String(studySettings.totalMinutes);
  siteCount.textContent = String(sites.length);
  siteList.replaceChildren();
  renderSession();

  if (sites.length === 0) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty-state";
    emptyState.textContent = "Your list is clear. Add a site to get started.";
    siteList.append(emptyState);
    return;
  }

  for (const domain of sites) {
    const item = document.createElement("li");
    item.className = "site-item";

    const label = document.createElement("span");
    label.className = "site-domain";
    label.textContent = domain;

    const removeButton = document.createElement("button");
    removeButton.className = "remove-site";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `Remove ${domain}`);
    removeButton.title = `Remove ${domain}`;
    removeButton.disabled = isStudying;
    removeButton.addEventListener("click", () => {
      sites = sites.filter((site) => site !== domain);
      void saveSites();
    });

    item.append(label, removeButton);
    siteList.append(item);
  }
}

async function saveSites() {
  await chrome.storage.local.set({ sites });
  render();
}

function normalizeDomain(value) {
  const candidate = value.includes("://") ? value : `https://${value}`;
  let hostname;
  try {
    hostname = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  const labels = hostname.replace(/\.$/, "").split(".");
  const valid = labels.length > 0 && labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
  return valid ? hostname.replace(/\.$/, "") : null;
}

siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const domain = normalizeDomain(siteInput.value.trim());
  if (!domain) {
    formError.textContent = "Enter a valid website address.";
    formError.hidden = false;
    siteInput.focus();
    return;
  }
  if (sites.includes(domain)) {
    formError.textContent = "That site is already on your list.";
    formError.hidden = false;
    siteInput.focus();
    return;
  }

  sites = [...sites, domain];
  siteInput.value = "";
  formError.hidden = true;
  await saveSites();
});

siteInput.addEventListener("input", () => {
  formError.hidden = true;
});

async function saveStudySettings() {
  studySettings = {
    focusMinutes: Number(focusInput.value),
    breakMinutes: Number(breakInput.value),
    totalMinutes: Number(totalInput.value)
  };
  if (focusInput.validity.valid && breakInput.validity.valid && totalInput.validity.valid) {
    await chrome.storage.local.set({ studySettings });
    durationError.hidden = true;
  }
}

for (const input of [focusInput, breakInput, totalInput]) {
  input.addEventListener("change", () => void saveStudySettings());
}

startButton.addEventListener("click", async () => {
  if (!focusInput.reportValidity() || !breakInput.reportValidity() || !totalInput.reportValidity()) {
    return;
  }
  await saveStudySettings();
  startButton.disabled = true;
  durationError.hidden = true;
  const response = await chrome.runtime.sendMessage({
    type: "start-study",
    settings: studySettings
  });
  startButton.disabled = false;
  if (response?.error) {
    durationError.textContent = response.error;
    durationError.hidden = false;
    return;
  }
  studySession = response.session;
  enabled = sites.length > 0;
  render();
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  await chrome.runtime.sendMessage({ type: "stop-study" });
  studySession = null;
  enabled = false;
  stopButton.disabled = false;
  render();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.sites) sites = changes.sites.newValue || [];
  if (changes.enabled) enabled = Boolean(changes.enabled.newValue);
  if (changes.studySession) studySession = changes.studySession.newValue || null;
  if (changes.studySettings) {
    studySettings = changes.studySettings.newValue || studySettings;
  }
  render();
});

async function initialize() {
  const settings = await chrome.storage.local.get({
    sites: [],
    enabled: false,
    studySettings: { focusMinutes: 25, breakMinutes: 5, totalMinutes: 120 },
    studySession: null
  });
  sites = Array.isArray(settings.sites) ? settings.sites : [];
  enabled = Boolean(settings.enabled);
  studySettings = settings.studySettings;
  studySession = settings.studySession;
  render();
}

void initialize();
setInterval(renderSession, 1000);