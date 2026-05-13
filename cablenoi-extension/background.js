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
    template: "",
    minDelay: 2,
    maxDelay: 5,
    dailyLimit: 20,
    relevantOnly: true,
    aiInstructions:
      "You write short, personalized LinkedIn outreach messages for CableNOI. We help multifamily apartment owners increase their NOI through bulk cable & internet agreements — zero cost to them. Under 120 words, conversational, reference the person's role and company. Never say \"I hope this finds you well.\"",
  };
  const { botSettings = defaults } = await chrome.storage.local.get("botSettings");
  return { ...defaults, ...botSettings };
}

function addLog(state, entry) {
  const log = Array.isArray(state.log) ? state.log : [];
  return [`[${new Date().toLocaleTimeString()}] ${entry}`, ...log].slice(0, 60);
}

// ── Chrome built-in AI + smart template fallback ─────────────────────────────

// Injected into the LinkedIn tab (MAIN world) so it can access window.ai / LanguageModel
async function chromeAIGenerate(lead, systemPrompt) {
  const first = (lead.name || "").split(" ")[0] || "there";
  const userPrompt = [
    `Write a LinkedIn outreach message to ${lead.name || "this person"}`,
    lead.title ? `who is a ${lead.title}` : "",
    lead.company ? `at ${lead.company}` : "",
    lead.location ? `in ${lead.location}` : "",
    `Begin the message with "Hi ${first},"`,
  ].filter(Boolean).join(", ") + ".";

  try {
    // Chrome 127+: window.LanguageModel (newer spec) or window.ai.languageModel (older)
    const api =
      (typeof LanguageModel !== "undefined" && LanguageModel) ||
      (window.ai?.languageModel) ||
      null;

    if (!api) return null;

    const caps = await api.capabilities();
    if (caps.available === "no") return null;

    const session = await api.create({ systemPrompt });
    const text = await session.prompt(userPrompt);
    session.destroy();
    return text?.trim() || null;
  } catch {
    return null;
  }
}

// Smart personalized template — no AI needed, reads their profile to vary the copy
function smartTemplate(lead) {
  const first = (lead.name || "").split(" ")[0] || "there";
  const t = (lead.title || "").toLowerCase();
  const company = lead.company ? ` at ${lead.company}` : "";

  let hook;
  if (t.includes("owner") || t.includes("investor") || t.includes("principal")) {
    hook = `as a real estate investor you know how much NOI drives portfolio value`;
  } else if (t.includes("develop")) {
    hook = `with your development background you understand how NOI shapes a deal's entire cap rate`;
  } else if (t.includes("manag")) {
    hook = `with your property management experience you know what actually moves the needle on NOI`;
  } else if (t.includes("acqui") || t.includes("asset")) {
    hook = `given your acquisitions focus you know that incremental NOI goes straight to valuation`;
  } else {
    hook = `I came across your work in multifamily real estate`;
  }

  return `Hi ${first}, ${hook}${company}. I work with CableNOI — we partner with apartment owners to add NOI through bulk cable & internet agreements at zero cost to them. We handle everything and you collect the check. Would love to connect and see if there's a fit for your portfolio.`;
}

async function generateMessage(tabId, lead, settings) {
  await patchBotState({ status: `Generating message for ${lead.name}…` });

  // Try Chrome's built-in Gemini Nano first (runs in the tab's MAIN world)
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: chromeAIGenerate,
      args: [lead, settings.aiInstructions || ""],
    });
    if (result?.result) return result.result;
  } catch {}

  // Fall back to smart template or user template
  const tpl = settings.template;
  if (tpl?.includes("{{")) return fillTemplate(tpl, lead);
  return smartTemplate(lead);
}

function fillTemplate(template, lead) {
  if (!lead || !template) return smartTemplate(lead);
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
  const message = await generateMessage(tabId, state.currentLead, settings);

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
