const FIRST_RULE_ID = 1;
const MAX_SITES = 5000;
const TRANSITION_ALARM = "focuskiwi-session-transition";
let rulesSyncQueue = Promise.resolve();

function syncBlockingRules() {
  rulesSyncQueue = rulesSyncQueue.then(async () => {
    const { sites = [], enabled = false } = await chrome.storage.local.get([
      "sites",
      "enabled"
    ]);
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIdsToRemove = existingRules
      .filter((rule) => rule.id >= FIRST_RULE_ID && rule.id < FIRST_RULE_ID + MAX_SITES)
      .map((rule) => rule.id);
    const rulesToAdd = enabled
      ? sites.slice(0, MAX_SITES).map((domain, index) => ({
          id: FIRST_RULE_ID + index,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: `||${domain}^`,
            resourceTypes: ["main_frame"]
          }
        }))
      : [];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: rulesToAdd
    });
  });
  return rulesSyncQueue;
}

async function reloadAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => Number.isInteger(tab.id))
    .map((tab) => chrome.tabs.reload(tab.id).catch(() => undefined)));
}

async function reloadTabsMatching(predicate) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => Number.isInteger(tab.id) && predicate(tab))
    .map((tab) => chrome.tabs.reload(tab.id).catch(() => undefined)));
}

async function reloadBlockedSiteTabs() {
  const { sites = [] } = await chrome.storage.local.get("sites");
  await reloadTabsMatching((tab) => {
    if (!tab.url) return false;
    let hostname;
    try {
      const url = new URL(tab.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return false;
    }
    return sites.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  });
}

async function reloadBlockedPageTabs() {
  const blockedPageUrl = chrome.runtime.getURL("blocked.html");
  await reloadTabsMatching((tab) => tab.url?.startsWith(blockedPageUrl));
}

async function reloadTabsForEndedPhase(phase) {
  if (phase === "focus") {
    await reloadBlockedPageTabs();
  } else if (phase === "break") {
    await reloadBlockedSiteTabs();
  }
}

function getPhaseAtSessionEnd(session) {
  let phase = session.phase;
  let nextBoundary = session.phaseEndsAt;
  while (nextBoundary < session.endsAt) {
    phase = phase === "focus" ? "break" : "focus";
    const duration = (phase === "focus"
      ? session.focusMinutes
      : session.breakMinutes) * 60_000;
    nextBoundary = Math.min(nextBoundary + duration, session.endsAt);
  }
  return phase;
}

async function redirectBlockedNavigation(details) {
  if (details.frameId !== 0 || details.tabId < 0) return;

  let hostname;
  try {
    const url = new URL(details.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return;
  }

  const { sites = [], enabled = false } = await chrome.storage.local.get([
    "sites",
    "enabled"
  ]);
  const isBlocked = enabled && sites.some((domain) =>
    hostname === domain || hostname.endsWith(`.${domain}`)
  );
  if (!isBlocked) return;

  const blockedPage = chrome.runtime.getURL("blocked.html");
  await chrome.tabs.update(details.tabId, {
    url: `${blockedPage}?site=${encodeURIComponent(hostname)}`
  }).catch(() => undefined);
}

function scheduleTransition(session) {
  chrome.alarms.create(TRANSITION_ALARM, { when: session.phaseEndsAt });
}

async function finishStudySession(endedPhase) {
  const { studySession } = await chrome.storage.local.get("studySession");
  await chrome.storage.local.set({
    studySession: null,
    enabled: false
  });
  await syncBlockingRules();
  await chrome.alarms.clear(TRANSITION_ALARM);
  await reloadTabsForEndedPhase(endedPhase || studySession?.phase);
}

async function advanceStudySession() {
  const { studySession } = await chrome.storage.local.get("studySession");
  if (!studySession?.active) return;

  const now = Date.now();
  if (now < studySession.phaseEndsAt) {
    scheduleTransition(studySession);
    return;
  }
  if (now >= studySession.endsAt) {
    await finishStudySession(getPhaseAtSessionEnd(studySession));
    return;
  }

  let phase = studySession.phase;
  let nextBoundary = studySession.phaseEndsAt;
  while (nextBoundary <= now && nextBoundary < studySession.endsAt) {
    phase = phase === "focus" ? "break" : "focus";
    const phaseDuration = (phase === "focus"
      ? studySession.focusMinutes
      : studySession.breakMinutes) * 60_000;
    nextBoundary = Math.min(nextBoundary + phaseDuration, studySession.endsAt);
  }

  const nextSession = {
    ...studySession,
    phase,
    phaseEndsAt: nextBoundary
  };
  await chrome.storage.local.set({
    studySession: nextSession,
    enabled: phase === "focus"
  });
  await syncBlockingRules();
  await reloadTabsForEndedPhase(studySession.phase);
  scheduleTransition(nextSession);
}

async function startStudySession(settings) {
  const { studySession, sites = [] } = await chrome.storage.local.get([
    "studySession",
    "sites"
  ]);
  if (studySession?.active) return { error: "A study session is already running." };

  const { focusMinutes, breakMinutes, totalMinutes } = settings || {};
  const isValidDuration = (value, max) =>
    Number.isInteger(value) && value >= 1 && value <= max;
  if (!isValidDuration(focusMinutes, 180) ||
      !isValidDuration(breakMinutes, 60) ||
      !isValidDuration(totalMinutes, 1440)) {
    return { error: "Enter valid whole-minute durations." };
  }

  const now = Date.now();
  const endsAt = now + totalMinutes * 60_000;
  const session = {
    active: true,
    phase: "focus",
    focusMinutes,
    breakMinutes,
    totalMinutes,
    endsAt,
    phaseEndsAt: Math.min(now + focusMinutes * 60_000, endsAt)
  };
  await chrome.storage.local.set({
    studySession: session,
    enabled: sites.length > 0
  });
  await syncBlockingRules();
  await reloadAllTabs();
  scheduleTransition(session);
  return { session };
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.local.get(["sites", "enabled", "studySettings"]);
  const defaults = {};
  if (!Array.isArray(settings.sites)) defaults.sites = [];
  if (typeof settings.enabled !== "boolean") defaults.enabled = false;
  if (!settings.studySettings) {
    defaults.studySettings = {
      focusMinutes: 25,
      breakMinutes: 5,
      totalMinutes: 120
    };
  }
  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }
  await syncBlockingRules();
  const { studySession } = await chrome.storage.local.get("studySession");
  if (studySession?.active) await advanceStudySession();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncBlockingRules();
  const { studySession } = await chrome.storage.local.get("studySession");
  if (studySession?.active) {
    if (Date.now() >= studySession.phaseEndsAt) {
      await advanceStudySession();
    } else {
      scheduleTransition(studySession);
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.sites || changes.enabled)) {
    void syncBlockingRules();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TRANSITION_ALARM) void advanceStudySession();
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  void redirectBlockedNavigation(details);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "start-study") {
    void startStudySession(message.settings).then(sendResponse);
    return true;
  }
  if (message.type === "refresh-blocked-site-tabs") {
    void syncBlockingRules()
      .then(reloadBlockedSiteTabs)
      .then(() => sendResponse({}));
    return true;
  }
  if (message.type === "stop-study") {
    void finishStudySession().then(() => sendResponse({}));
    return true;
  }
});