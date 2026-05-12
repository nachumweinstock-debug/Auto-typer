const scrapeBtn = document.getElementById("scrapeBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const searchInput = document.getElementById("searchInput");
const mfOnly = document.getElementById("mfOnly");
const leadsContainer = document.getElementById("leadsContainer");
const statusEl = document.getElementById("status");
const statsText = document.getElementById("statsText");

let allLeads = [];

// ── Load persisted leads on open ─────────────────────────────────────────────

chrome.storage.local.get("leads", ({ leads = [] }) => {
  allLeads = leads;
  render();
});

// ── Message listener from background ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "updateLeads") {
    allLeads = msg.leads;
    render();
    setStatus(`Scraped ${msg.leads.length} total lead(s).`, "success");
    scrapeBtn.disabled = false;
  }
  if (msg.action === "scrapeProgress") {
    setStatus(msg.text, "");
  }
  if (msg.action === "scrapeError") {
    setStatus(msg.error, "error");
    scrapeBtn.disabled = false;
  }
});

// ── Controls ──────────────────────────────────────────────────────────────────

scrapeBtn.addEventListener("click", () => {
  scrapeBtn.disabled = true;
  setStatus("Sending scrape request…", "");
  chrome.runtime.sendMessage({ action: "triggerScrape" });
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all leads?")) return;
  allLeads = [];
  chrome.runtime.sendMessage({ action: "clearLeads" });
  render();
  setStatus("Leads cleared.", "");
});

exportBtn.addEventListener("click", () => {
  const visible = getFiltered();
  if (!visible.length) return;

  const header = ["Name", "Title", "Company", "Location", "Profile URL", "Multifamily Match"];
  const rows = visible.map((l) => [
    csvEscape(l.name),
    csvEscape(l.title),
    csvEscape(l.company),
    csvEscape(l.location),
    csvEscape(l.profileUrl),
    l.relevant ? "Yes" : "No",
  ]);

  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cablenoi_leads_${datestamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

searchInput.addEventListener("input", render);
mfOnly.addEventListener("change", render);

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const visible = getFiltered();
  statsText.textContent = `${visible.length} / ${allLeads.length} leads`;
  exportBtn.disabled = visible.length === 0;

  if (visible.length === 0) {
    leadsContainer.innerHTML = `
      <div class="empty-state">
        <div class="icon">&#128270;</div>
        <p>${allLeads.length === 0
          ? "Navigate to a LinkedIn search, profile, or company page and click <strong>Scrape This Page</strong>."
          : "No leads match your filters."
        }</p>
        ${allLeads.length === 0 ? '<p class="hint">Tip: Run a LinkedIn People search filtered by title (e.g. "property owner") for best results.</p>' : ""}
      </div>`;
    return;
  }

  leadsContainer.innerHTML = "";
  visible.forEach((lead, idx) => {
    const card = document.createElement("div");
    card.className = "lead-card" + (lead.relevant ? " relevant" : "");
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
      <button class="delete-btn" data-idx="${idx}" title="Remove lead">&times;</button>`;
    leadsContainer.appendChild(card);
  });

  leadsContainer.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const visIdx = parseInt(btn.dataset.idx);
      const lead = visible[visIdx];
      allLeads = allLeads.filter((l) => l !== lead);
      chrome.storage.local.set({ leads: allLeads });
      render();
    });
  });
}

function getFiltered() {
  const query = searchInput.value.toLowerCase().trim();
  const mf = mfOnly.checked;
  return allLeads.filter((l) => {
    if (mf && !l.relevant) return false;
    if (!query) return true;
    return (
      l.name.toLowerCase().includes(query) ||
      l.title.toLowerCase().includes(query) ||
      l.company.toLowerCase().includes(query) ||
      l.location.toLowerCase().includes(query)
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function csvEscape(val) {
  if (!val) return '""';
  return `"${String(val).replace(/"/g, '""')}"`;
}

function datestamp() {
  return new Date().toISOString().slice(0, 10);
}
