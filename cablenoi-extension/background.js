// ── Side panel ────────────────────────────────────────────────────────────────

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// ── Keep-alive: offscreen document ───────────────────────────────────────────

async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("offscreen.html"),
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: "Keep service worker alive during background bot operation",
    });
  } catch (e) {
    console.warn("offscreen:", e.message);
  }
}

async function releaseOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {}
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getBotState() {
  const { botState = {} } = await chrome.storage.local.get("botState");
  return botState;
}

async function patchBotState(patch) {
  const current = await getBotState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ botState: next });
  return next;
}

async function getBotSettings() {
  const defaults = {
    template:
      "Hi {{name}}, I came across your work in multifamily real estate and wanted to reach out. I work with CableNOI — we help apartment owners boost their NOI through bulk cable & internet agreements at no cost to you. Would love to connect and see if there's an opportunity for your portfolio.",
    minDelay: 2,
    maxDelay: 5,
    dailyLimit: 20,
    relevantOnly: true,
  };
  const { botSettings = defaults } = await chrome.storage.local.get("botSettings");
  return { ...defaults, ...botSettings };
}

function addLog(state, entry) {
  const log = Array.isArray(state.log) ? state.log : [];
  return [`[${new Date().toLocaleTimeString()}] ${entry}`, ...log].slice(0, 60);
}

// ── Template fill ─────────────────────────────────────────────────────────────

function fillTemplate(template, lead) {
  if (!lead || !template) return template || "";
  const first = (lead.name || "").split(" ")[0] || "there";
  return template
    .replace(/\{\{name\}\}/gi, first)
    .replace(/\{\{fullname\}\}/gi, lead.name || "")
    .replace(/\{\{company\}\}/gi, lead.company || "your company")
    .replace(/\{\{title\}\}/gi, lead.title || "");
}

// ── Tab management ────────────────────────────────────────────────────────────

async function getOrCreateBotTab(url) {
  const state = await getBotState();
  if (state.botTabId) {
    try {
      await chrome.tabs.get(state.botTabId);
      await chrome.tabs.update(state.botTabId, { url, active: false });
      return state.botTabId;
    } catch {
      // tab was closed
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await patchBotState({ botTabId: tab.id });
  return tab.id;
}

// ── Tab load listener (top-level so it survives SW restarts) ─────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url?.includes("linkedin.com/in/")) return;

  const state = await getBotState();
  if (!state.running || !state.awaitingNav || state.botTabId !== tabId) return;

  // Page loaded — give React 3 s to render, then fire message to content script
  await sleep(3000);

  const settings = await getBotSettings();
  const message = fillTemplate(settings.template, state.currentLead);

  try {
    await chrome.tabs.sendMessage(tabId, { action: "automateMessage", message });
  } catch (err) {
    await onMessagingResult({ success: false, error: "Content script unreachable: " + err.message });
  }
});

// ── Bot queue processor ───────────────────────────────────────────────────────

async function processBotQueue() {
  const state = await getBotState();
  if (!state.running || state.awaitingNav) return;

  const settings = await getBotSettings();
  const { leads = [] } = await chrome.storage.local.get("leads");

  // Daily limit check
  if ((state.todaySent || 0) >= settings.dailyLimit) {
    await patchBotState({
      running: false,
      status: `Daily limit of ${settings.dailyLimit} reached. Resume tomorrow.`,
      log: addLog(state, `Stopped — daily limit (${settings.dailyLimit}) reached`),
    });
    await releaseOffscreen();
    return;
  }

  const queue = leads.filter(
    (l) => (!settings.relevantOnly || l.relevant) && !l.messaged && !l.skipped && l.profileUrl
  );

  if (queue.length === 0) {
    await patchBotState({
      running: false,
      status: "Done — all queued leads processed.",
      log: addLog(state, "Queue exhausted, bot stopped"),
    });
    await releaseOffscreen();
    return;
  }

  const lead = queue[0];
  await patchBotState({
    awaitingNav: true,
    currentLead: lead,
    status: `Navigating to ${lead.name}…`,
    log: addLog(state, `→ Navigating to ${lead.name} (${lead.profileUrl})`),
  });

  await getOrCreateBotTab(lead.profileUrl);
}

// ── Handle result back from content script ────────────────────────────────────

async function onMessagingResult(result) {
  const state = await getBotState();
  const settings = await getBotSettings();
  const { leads = [] } = await chrome.storage.local.get("leads");

  const updatedLeads = leads.map((l) => {
    if (l.profileUrl === state.currentLead?.profileUrl) {
      if (result.success) return { ...l, messaged: true, messagedAt: Date.now() };
      return { ...l, skipped: true, skipReason: result.error };
    }
    return l;
  });
  await chrome.storage.local.set({ leads: updatedLeads });

  const todaySent = (state.todaySent || 0) + (result.success ? 1 : 0);
  const totalSent = (state.totalSent || 0) + (result.success ? 1 : 0);
  const logEntry = result.success
    ? `✓ Sent to ${state.currentLead?.name}`
    : `✗ Skipped ${state.currentLead?.name}: ${result.error}`;

  const delayMin =
    settings.minDelay + Math.random() * (settings.maxDelay - settings.minDelay);
  const nextAt = Date.now() + delayMin * 60 * 1000;

  await patchBotState({
    awaitingNav: false,
    currentLead: null,
    todaySent,
    totalSent,
    nextAt,
    status: result.success
      ? `Sent to ${state.currentLead?.name}. Waiting ${Math.round(delayMin)}m before next…`
      : `Skipped ${state.currentLead?.name}. Waiting ${Math.round(delayMin)}m…`,
    log: addLog(state, logEntry),
  });

  chrome.alarms.create("nextLead", { delayInMinutes: delayMin });
}

// ── Alarm handler ─────────────────────────────────────────────────────────────

chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keepAlive") {
    const state = await getBotState();
    // Timeout guard: if awaitingNav has been stuck > 2 min, treat as error
    if (state.running && state.awaitingNav && state.currentLead) {
      const stuckMs = Date.now() - (state.navStartedAt || Date.now());
      if (stuckMs > 120_000) {
        await onMessagingResult({ success: false, error: "Navigation timeout" });
      }
    }
    if (!state.running) await releaseOffscreen();
    return;
  }
  if (alarm.name === "nextLead") {
    await processBotQueue();
  }
});

// ── Incoming messages ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case "startBot": {
        await chrome.storage.local.set({ botSettings: msg.settings });
        await patchBotState({
          running: true,
          awaitingNav: false,
          currentLead: null,
          todaySent: 0,
          totalSent: 0,
          nextAt: null,
          botTabId: null,
          log: [`[${new Date().toLocaleTimeString()}] Bot started`],
          status: "Starting…",
        });
        await ensureOffscreen();
        await processBotQueue();
        break;
      }
      case "stopBot": {
        const s = await getBotState();
        await patchBotState({
          running: false,
          awaitingNav: false,
          status: "Stopped by user.",
          log: addLog(s, "Bot stopped by user"),
        });
        chrome.alarms.clear("nextLead");
        await releaseOffscreen();
        break;
      }
      case "messagingResult": {
        await onMessagingResult(msg);
        break;
      }
      // ── Scraper relay ──
      case "leadsScraped":
        chrome.runtime.sendMessage({ action: "updateLeads", leads: msg.leads }).catch(() => {});
        break;
      case "scrapeError":
        chrome.runtime.sendMessage({ action: "scrapeError", error: msg.error }).catch(() => {});
        break;
      case "scrapeProgress":
        chrome.runtime.sendMessage({ action: "scrapeProgress", text: msg.text }).catch(() => {});
        break;
      case "triggerScrape":
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (tab) chrome.tabs.sendMessage(tab.id, { action: "scrape" }).catch(console.error);
        });
        break;
      case "clearLeads":
        chrome.storage.local.remove("leads");
        break;
      case "keepAlive":
        break;
    }
    sendResponse({});
  })();
  return true;
});

// ── Utility ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
