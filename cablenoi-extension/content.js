let typingActive = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

const nearbyKeys = {
  a:"sqwz", b:"vghn", c:"xdfv", d:"serfcx", e:"wsdr",
  f:"drtgvc", g:"ftyhn", h:"gyujnb", i:"ujko", j:"huikmn",
  k:"jiolm", l:"kop", m:"njk", n:"bhjm", o:"iklp",
  p:"ol", q:"wa", r:"edft", s:"aqwedxz", t:"rfgy",
  u:"yhji", v:"cfgb", w:"qase", x:"zsdc", y:"tugh",
  z:"asx", " ":"cvbnm",
};

function getNearbyKey(ch) {
  const lower = ch.toLowerCase();
  const pool = nearbyKeys[lower];
  if (!pool) return ch;
  const typo = pool[Math.floor(Math.random() * pool.length)];
  return ch === ch.toUpperCase() ? typo.toUpperCase() : typo;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand  = (min, max) => Math.random() * (max - min) + min;

// ─── Google Docs ─────────────────────────────────────────────────────────────

function isGoogleDocs() {
  return location.hostname === "docs.google.com";
}

function getGDocsIframe() {
  return document.querySelector(".docs-texteventtarget-iframe");
}

function typeCharGDocs(iframe, char) {
  const doc = iframe.contentDocument;
  if (!doc) return false;

  // Refocus the iframe so execCommand targets it
  iframe.contentWindow.focus();

  if (char === "\n") {
    return doc.execCommand("insertParagraph", false);
  }
  return doc.execCommand("insertText", false, char);
}

function deleteCharGDocs(iframe) {
  const doc = iframe.contentDocument;
  if (!doc) return;
  iframe.contentWindow.focus();
  doc.execCommand("delete");
}

// ─── Regular inputs / contenteditable ────────────────────────────────────────

function typeChar(el, char) {
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(char);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    const s = el.selectionStart;
    el.value = el.value.slice(0, s) + char + el.value.slice(el.selectionEnd);
    el.selectionStart = el.selectionEnd = s + 1;
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
}

function deleteChar(el) {
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.startOffset > 0) {
      range.setStart(range.startContainer, range.startOffset - 1);
      range.deleteContents();
    }
  } else {
    const s = el.selectionStart;
    if (s > 0) {
      el.value = el.value.slice(0, s - 1) + el.value.slice(s);
      el.selectionStart = el.selectionEnd = s - 1;
    }
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
}

// ─── Main typing loop ─────────────────────────────────────────────────────────

async function humanType(text, wpm, useTypos) {
  typingActive = true;

  const gdocs  = isGoogleDocs();
  const iframe = gdocs ? getGDocsIframe() : null;
  const target = gdocs ? null : (lastFocused || document.activeElement);

  // Validate target for non-GDocs pages
  if (!gdocs && (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable))) {
    chrome.runtime.sendMessage({ action: "typingError", error: "Click inside a text field first." });
    typingActive = false;
    return;
  }

  if (!gdocs) target.focus();

  const baseDelay = (60 / (wpm * 5)) * 1000; // ms per character

  for (let i = 0; i < text.length; i++) {
    if (!typingActive) break;

    const ch = text[i];
    const delay = rand(baseDelay * 0.55, baseDelay * 1.5);

    // Random "thinking" pause
    if (Math.random() < 0.015) await sleep(rand(400, 1200));

    // Punctuation pause
    if (".!?".includes(ch))   await sleep(rand(180, 500));
    else if (",;:".includes(ch)) await sleep(rand(60, 180));

    // Typo simulation (4% on letters)
    if (useTypos && /[a-zA-Z]/.test(ch) && Math.random() < 0.04) {
      const wrong = getNearbyKey(ch);
      if (gdocs) typeCharGDocs(iframe, wrong);
      else       typeChar(target, wrong);
      await sleep(rand(80, 200));
      await sleep(rand(100, 350));
      if (gdocs) deleteCharGDocs(iframe);
      else       deleteChar(target);
      await sleep(rand(50, 150));
    }

    if (gdocs) typeCharGDocs(iframe, ch);
    else       typeChar(target, ch);

    await sleep(delay);
  }

  typingActive = false;
  chrome.runtime.sendMessage({ action: "typingDone" });
}

// ─── Focus tracking ───────────────────────────────────────────────────────────

let lastFocused = null;

document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
    lastFocused = el;
  }
}, true);

// Also track clicks for Google Docs (clicks don't always fire focusin)
document.addEventListener("mousedown", () => {
  if (isGoogleDocs()) {
    // The iframe re-focuses on click; cursor position is preserved internally.
    // Nothing extra needed — getGDocsIframe() will be used at type time.
  }
}, true);

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startTyping") {
    humanType(msg.text, msg.wpm, msg.typos);
  }
  if (msg.action === "stopTyping") {
    typingActive = false;
  }
});
