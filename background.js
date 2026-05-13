// background.js — CableNOI Leads service worker

const DEFAULT_QUERIES = [
  "Multifamily Owner",
  "Apartment Owner",
  "Managing Member RE",
  "Principal Multifamily",
  "RE Investor MF",
  "Apartment Complex Owner",
  "Managing Partner RE",
  "Real Estate Investor",
  "Multifamily Investor",
  "Apartment Investor",
  "Property Owner Multifamily",
  "Real Estate Developer",
  "Multifamily Developer",
  "Real Estate Principal",
  "Apartment Complex Manager"
];

let state = {
  isRunning: false,
  queries: [...DEFAULT_QUERIES],
  currentQueryIndex: 0,
  currentPage: 1,
  maxPages: 10,
  leads: [],
  completedQueries: [],
  activeTabId: null,
  waitingForScrape: false
};

chrome.storage.local.get(["queries", "leads"], (data) => {
  if (data.queries) state.queries = data.queries;
  if (data.leads) state.leads = data.leads;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case "getState":
      sendResponse(getPublicState());
      return true;
    case "startScraping":
      startScraping();
      sendResponse({ ok: true });
      return true;
    case "stopScraping":
      stopScraping();
      sendResponse({ ok: true });
      return true;
    case "setQueries":
      state.queries = msg.queries;
      sendResponse({ ok: true });
      return true;
    case "scraped":
      handleScraped(msg.leads, sender.tab?.id);
      sendResponse({ ok: true });
      return true;
    case "getLeads":
      sendResponse({ leads: state.leads });
      return true;
    case "clearLeads":
      state.leads = [];
      state.completedQueries = [];
      chrome.storage.local.set({ leads: [] });
      sendResponse({ ok: true });
      return true;
  }
});

function getPublicState() {
  return {
    isRunning: state.isRunning,
    queries: state.queries,
    currentQueryIndex: state.currentQueryIndex,
    currentPage: state.currentPage,
    maxPages: state.maxPages,
    leadsCount: state.leads.length,
    hotCount: state.leads.filter((l) => l.hot).length,
    completedQueries: [...state.completedQueries],
    currentQuery: state.queries[state.currentQueryIndex] || null,
    progress: Math.round((state.currentPage / state.maxPages) * 100)
  };
}

async function startScraping() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.currentQueryIndex = 0;
  state.currentPage = 1;
  state.completedQueries = [];
  debugLog(`Starting: ${state.queries.length} queries`, "success");
  await navigateToCurrentQuery();
}

function stopScraping() {
  state.isRunning = false;
  state.waitingForScrape = false;
  debugLog("Stopped by user", "warn");
  notifyPopup();
}

async function navigateToCurrentQuery() {
  if (!state.isRunning) return;

  if (state.currentQueryIndex >= state.queries.length) {
    state.isRunning = false;
    debugLog(`Done! ${state.leads.length} total leads collected`, "success");
    notifyPopup();
    return;
  }

  const query = state.queries[state.currentQueryIndex];
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&page=${state.currentPage}`;

  state.waitingForScrape = true;
  debugLog(`"${query}" — page ${state.currentPage}`, "info");
  notifyPopup();

  try {
    if (state.activeTabId) {
      const tabs = await chrome.tabs.query({});
      const exists = tabs.find((t) => t.id === state.activeTabId);
      if (exists) {
        await chrome.tabs.update(state.activeTabId, { url, active: true });
      } else {
        const tab = await chrome.tabs.create({ url });
        state.activeTabId = tab.id;
      }
    } else {
      const tab = await chrome.tabs.create({ url });
      state.activeTabId = tab.id;
    }
  } catch (e) {
    debugLog("Navigation error: " + e.message, "error");
    state.isRunning = false;
    notifyPopup();
  }
}

async function handleScraped(leads, tabId) {
  if (!state.isRunning) return;
  if (tabId && state.activeTabId && tabId !== state.activeTabId) return;

  state.waitingForScrape = false;
  debugLog(`Scraped ${leads.length} leads`, "success");

  const currentQuery = state.queries[state.currentQueryIndex];
  for (const lead of leads) {
    const existing = state.leads.find(
      (l) => l.profileUrl && l.profileUrl === lead.profileUrl
    );
    if (!existing) {
      state.leads.push({ ...lead, hot: false, query: currentQuery });
    } else {
      existing.hot = true;
    }
  }

  chrome.storage.local.set({ leads: state.leads });
  notifyPopup();

  // Rate-limit: 3–6s between pages
  await sleep(3000 + Math.random() * 3000);
  if (!state.isRunning) return;

  if (state.currentPage < state.maxPages) {
    state.currentPage++;
  } else {
    state.completedQueries.push(state.currentQueryIndex);
    state.currentQueryIndex++;
    state.currentPage = 1;
  }

  await navigateToCurrentQuery();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    tabId === state.activeTabId &&
    changeInfo.status === "complete" &&
    state.waitingForScrape
  ) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: "scrapeNow" }).catch((err) => {
        debugLog("Content script unreachable: " + err.message, "warn");
      });
    }, 3000);
  }
});

function notifyPopup() {
  chrome.runtime.sendMessage({ action: "stateUpdate", state: getPublicState() }).catch(() => {});
}

function debugLog(text, level = "info") {
  chrome.runtime.sendMessage({ action: "debugLog", text, level }).catch(() => {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
