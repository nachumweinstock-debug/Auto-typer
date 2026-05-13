const speedSlider = document.getElementById("speed");
const speedVal = document.getElementById("speedVal");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const status = document.getElementById("status");
const textInput = document.getElementById("textInput");
const typosCheck = document.getElementById("typos");

speedSlider.addEventListener("input", () => {
  speedVal.textContent = speedSlider.value;
});

startBtn.addEventListener("click", async () => {
  const text = textInput.value;
  if (!text.trim()) {
    status.textContent = "Please enter some text first.";
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  startBtn.disabled = true;
  stopBtn.style.display = "block";
  status.textContent = "Typing...";

  chrome.tabs.sendMessage(tab.id, {
    action: "startTyping",
    text,
    wpm: parseInt(speedSlider.value),
    typos: typosCheck.checked,
  });
});

stopBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "stopTyping" });
  resetUI("Stopped.");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "typingDone") resetUI("Done!");
  if (msg.action === "typingError") resetUI("Error: " + msg.error);
});

function resetUI(msg) {
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  status.textContent = msg;
}
