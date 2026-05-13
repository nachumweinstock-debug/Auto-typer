// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Leads tab ─────────────────────────────────────────────────────────────────

const scrapeBtn = document.getElementById("scrapeBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const searchInput = document.getElementById("searchInput");
const mfOnly = document.getElementById("mfOnly");
const hideMessaged = document.getElementById("hideMessaged");
const leadsContainer = document.getElementById("leadsContainer");
const leadsStatus = document.getElementById("leadsStatus");
const statsText = document.getElementById("statsText");

let allLeads = [];

chrome.storage.local.get("leads", ({ leads = [] }) => {
  allLeads = leads;
  renderLeads();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "updateLeads") {
    allLeads = msg.leads;
    renderLeads();
    setLeadsStatus(`Scraped ${msg.leads.length} total lead(s).`, "success");
    scrapeBtn.disabled = false;
  }
  if (msg.action === "scrapeProgress") setLeadsStatus(msg.text, "");
  if (msg.action === "scrapeError") {
    setLeadsStatus(msg.error, "error");
    scrapeBtn.disabled = false;
  }
});

scrapeBtn.addEventListener("click", () => {
  scrapeBtn.disabled = true;
  setLeadsStatus("Sending scrape request…", "");
  chrome.runtime.sendMessage({ action: "triggerScrape" });
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all leads?")) return;
  allLeads = [];
  chrome.runtime.sendMessage({ action: "clearLeads" });
  renderLeads();
  setLeadsStatus("Leads cleared.", "");
});

exportBtn.addEventListener("click", () => {
  const visible = getFilteredLeads();
  if (!visible.length) return;
  const header = ["Name", "Title", "Company", "Location", "Profile URL", "MF Match", "Messaged"];
  const rows = visible.map((l) => [
    csvEscape(l.name), csvEscape(l.title), csvEscape(l.company),
    csvEscape(l.location), csvEscape(l.profileUrl),
    l.relevant ? "Yes" : "No",
    l.messaged ? "Yes" : "No",
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cablenoi_leads_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

searchInput.addEventListener("input", renderLeads);
mfOnly.addEventListener("change", renderLeads);
hideMessaged.addEventListener("change", renderLeads);

function renderLeads() {
  const visible = getFilteredLeads();
  statsText.textContent = `${visible.length} / ${allLeads.length} leads`;
  exportBtn.disabled = visible.length === 0;

  if (visible.length === 0) {
    leadsContainer.innerHTML = `
      <div class="empty-state">
        <div class="icon">&#128270;</div>
        <p>${allLeads.length === 0
          ? 'Go to a LinkedIn search and click <strong>Scrape Page</strong>.'
          : "No leads match your filters."
        }</p>
        ${allLeads.length === 0
          ? '<p class="hint">Tip: search "multifamily property owner" in LinkedIn People.</p>'
          : ""}
      </div>`;
    return;
  }

  leadsContainer.innerHTML = "";
  visible.forEach((lead, idx) => {
    const card = document.createElement("div");
    const classes = ["lead-card"];
    if (lead.relevant) classes.push("relevant");
    if (lead.messaged) classes.push("messaged");
    card.className = classes.join(" ");
    card.innerHTML = `
      <div class="lead-name">
        ${lead.profileUrl
          ? `<a href="${escapeHtml(lead.profileUrl)}" target="_blank">${escapeHtml(lead.name)}</a>`
          : escapeHtml(lead.name)}
      </div>
      <div class="lead-title">${escapeHtml(lead.title)}</div>
      <div class="lead-meta">
        ${lead.company ? `<span>&#127970; ${escapeHtml(lead.company)}</span>` : ""}
        ${lead.location ? `<span>&#128205; ${escapeHtml(lead.location)}</span>` : ""}
      </div>
      <button class="delete-btn" data-idx="${idx}" title="Remove">&times;</button>`;
    leadsContainer.appendChild(card);
  });

  leadsContainer.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lead = visible[parseInt(btn.dataset.idx)];
      allLeads = allLeads.filter((l) => l !== lead);
      chrome.storage.local.set({ leads: allLeads });
      renderLeads();
    });
  });
}

function getFilteredLeads() {
  const query = searchInput.value.toLowerCase().trim();
  return allLeads.filter((l) => {
    if (mfOnly.checked && !l.relevant) return false;
    if (hideMessaged.checked && l.messaged) return false;
    if (!query) return true;
    return (
      l.name.toLowerCase().includes(query) ||
      (l.title || "").toLowerCase().includes(query) ||
      (l.company || "").toLowerCase().includes(query) ||
      (l.location || "").toLowerCase().includes(query)
    );
  });
}

function setLeadsStatus(msg, type) {
  leadsStatus.textContent = msg;
  leadsStatus.className = type;
}

// ── Bot tab ───────────────────────────────────────────────────────────────────

const startBotBtn = document.getElementById("startBotBtn");
const stopBotBtn = document.getElementById("stopBotBtn");
const templateInput = document.getElementById("templateInput");
const minDelayInput = document.getElementById("minDelay");
const maxDelayInput = document.getElementById("maxDelay");
const dailyLimitInput = document.getElementById("dailyLimit");
const relevantOnlyCheck = document.getElementById("relevantOnly");
const aiInstructionsInput = document.getElementById("aiInstructions");
const botIndicator = document.getElementById("botIndicator");
const botStatusVal = document.getElementById("botStatusVal");
const botSentToday = document.getElementById("botSentToday");
const botTotalSent = document.getElementById("botTotalSent");
const botStatusText = document.getElementById("botStatusText");
const logBox = document.getElementById("logBox");

// Load persisted settings
chrome.storage.local.get(["botSettings", "botState"], ({ botSettings, botState }) => {
  if (botSettings) {
    templateInput.value = botSettings.template || templateInput.value;
    minDelayInput.value = botSettings.minDelay ?? 2;
    maxDelayInput.value = botSettings.maxDelay ?? 5;
    dailyLimitInput.value = botSettings.dailyLimit ?? 20;
    relevantOnlyCheck.checked = botSettings.relevantOnly ?? true;
    if (botSettings.aiInstructions) aiInstructionsInput.value = botSettings.aiInstructions;
  }
  if (botState) applyBotState(botState);
});

// Live updates via storage changes (works even when SW is in background)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.botState) applyBotState(changes.botState.newValue || {});
  if (changes.leads) {
    allLeads = changes.leads.newValue || [];
    renderLeads();
  }
});

startBotBtn.addEventListener("click", () => {
  const minD = parseFloat(minDelayInput.value) || 2;
  const maxD = parseFloat(maxDelayInput.value) || 5;
  if (minD >= maxD) {
    alert("Min delay must be less than max delay.");
    return;
  }
  const template = templateInput.value.trim();
  const settings = {
    template,
    minDelay: minD,
    maxDelay: maxD,
    dailyLimit: parseInt(dailyLimitInput.value) || 20,
    relevantOnly: relevantOnlyCheck.checked,
    aiInstructions: aiInstructionsInput.value.trim(),
  };
  chrome.runtime.sendMessage({ action: "startBot", settings });
});

stopBotBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stopBot" });
});

function applyBotState(state) {
  const running = !!state.running;

  botIndicator.className = "indicator " + (running ? "running" : "stopped");
  botStatusVal.textContent = running ? "Running" : "Idle";
  botSentToday.textContent = state.todaySent ?? 0;
  botTotalSent.textContent = state.totalSent ?? 0;
  botStatusText.textContent = state.status || (running ? "Bot is running…" : "Configure template below and click Start.");

  startBotBtn.disabled = running;
  stopBotBtn.disabled = !running;

  if (Array.isArray(state.log) && state.log.length) {
    logBox.innerHTML = state.log
      .map((entry) => {
        const cls = entry.includes("✓ Sent") ? "sent" : entry.includes("✗ Skipped") ? "skipped" : "";
        return `<div class="log-entry ${cls}">${escapeHtml(entry)}</div>`;
      })
      .join("");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvEscape(val) {
  return `"${String(val || "").replace(/"/g, '""')}"`;
}
