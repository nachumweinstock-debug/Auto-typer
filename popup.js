// popup.js — CableNOI Leads UI

// ── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "leads") renderLeads();
  });
});

// ── Controls ─────────────────────────────────────────────────────────────────

document.getElementById("startBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "startScraping" }, refreshState);
});

document.getElementById("stopBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stopScraping" }, refreshState);
});

document.getElementById("exportBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "getLeads" }, ({ leads }) => {
    if (!leads.length) return;
    const header = "Name,Title,Company,Location,Profile URL,Hot\n";
    const rows = leads
      .map((l) =>
        ["name", "title", "company", "location", "profileUrl"]
          .map((k) => `"${(l[k] || "").replace(/"/g, '""')}"`)
          .concat(`"${l.hot ? "Yes" : "No"}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: "cablenoi-leads.csv" });
  });
});

document.getElementById("saveQueriesBtn").addEventListener("click", () => {
  const queries = document
    .getElementById("queryEditor")
    .value.split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
  chrome.storage.local.set({ queries }, () => {
    chrome.runtime.sendMessage({ action: "setQueries", queries });
    document.getElementById("queriesHeader").textContent =
      queries.length + " SEARCH QUERIES";
    renderQueryList(queries, null, [], false, 1);
    log("Queries saved: " + queries.length + " entries", "success");
  });
});

document.getElementById("clearLeadsBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "clearLeads" }, () => {
    refreshState();
    log("Leads cleared", "warn");
  });
});

// ── State listener ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "stateUpdate") applyState(msg.state);
  if (msg.action === "debugLog") log(msg.text, msg.level || "info");
});

// ── State rendering ───────────────────────────────────────────────────────────

function refreshState() {
  chrome.runtime.sendMessage({ action: "getState" }, (s) => {
    if (s) applyState(s);
  });
}

function applyState(s) {
  // Badges
  document.getElementById("hotCount").textContent = s.hotCount + " HOT";
  document.getElementById("totalCount").textContent = s.leadsCount + " total";

  // Status
  const dot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  if (s.isRunning) {
    dot.className = "status-dot running";
    statusText.textContent = `Running: "${s.currentQuery}" — page ${s.currentPage}`;
  } else {
    dot.className = "status-dot";
    statusText.textContent =
      s.leadsCount > 0
        ? `Done — ${s.leadsCount} leads collected`
        : "Idle — ready to run";
  }

  // Buttons
  document.getElementById("startBtn").style.display = s.isRunning ? "none" : "block";
  document.getElementById("stopBtn").style.display = s.isRunning ? "block" : "none";

  // Stats
  const statsGrid = document.getElementById("statsGrid");
  if (s.isRunning) {
    statsGrid.style.display = "grid";
    document.getElementById("statSearch").textContent = s.currentQuery || "—";
    document.getElementById("statPage").textContent =
      s.currentPage + "/" + s.maxPages;
    document.getElementById("progressFill").style.width = s.progress + "%";
  } else {
    statsGrid.style.display = "none";
  }

  // Query list
  document.getElementById("queriesHeader").textContent =
    s.queries.length + " SEARCH QUERIES";
  renderQueryList(
    s.queries,
    s.currentQueryIndex,
    s.completedQueries,
    s.isRunning,
    s.currentPage
  );
}

function renderQueryList(queries, currentIdx, completedIdxs, isRunning, currentPage) {
  const list = document.getElementById("queryList");
  list.innerHTML = "";
  queries.forEach((q, i) => {
    const done = completedIdxs && completedIdxs.includes(i);
    const active = isRunning && i === currentIdx;
    const div = document.createElement("div");
    div.className =
      "query-item" + (active ? " active" : "") + (done ? " done" : "");

    let badge = "";
    if (done) badge = '<span class="query-check">✓</span>';
    else if (active)
      badge = `<span class="query-page-badge">p.${currentPage}</span>`;

    div.innerHTML = `<span>🔍</span><span class="query-name">${q}</span>${badge}`;
    list.appendChild(div);
  });
}

// ── Leads rendering ───────────────────────────────────────────────────────────

function renderLeads() {
  chrome.runtime.sendMessage({ action: "getLeads" }, ({ leads }) => {
    const list = document.getElementById("leadsList");
    list.innerHTML = "";
    if (!leads.length) {
      list.innerHTML =
        '<div class="empty-state">No leads yet.<br>Start Auto-Run to collect leads.</div>';
      return;
    }
    leads.forEach((l) => {
      const initials = (l.name || "?")
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("");
      const div = document.createElement("div");
      div.className = "lead-item";
      div.innerHTML = `
        <div class="lead-avatar">${initials}</div>
        <div class="lead-info">
          <div class="lead-name">
            ${l.name || "—"}
            ${l.hot ? '<span class="hot-badge">HOT</span>' : ""}
          </div>
          <div class="lead-sub">${l.title || ""}${l.title && l.company ? " · " : ""}${l.company || ""}</div>
          <div class="lead-loc">${l.location || ""}</div>
        </div>
      `;
      if (l.profileUrl) {
        div.style.cursor = "pointer";
        div.addEventListener("click", () =>
          chrome.tabs.create({ url: l.profileUrl })
        );
      }
      list.appendChild(div);
    });
  });
}

// ── Debug log ─────────────────────────────────────────────────────────────────

function log(text, level = "info") {
  const el = document.getElementById("debugLog");
  const line = document.createElement("div");
  line.className = level;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  chrome.storage.local.get(["queries"], (data) => {
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
      "Apartment Complex Manager",
    ];
    document.getElementById("queryEditor").value = (
      data.queries || DEFAULT_QUERIES
    ).join("\n");
  });
  refreshState();
}

init();
