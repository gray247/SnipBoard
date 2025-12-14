// popup.js with shadow select mode + health bar

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) {
        resolve(null);
        return;
      }
      const chatTab = tabs.find((tab) => {
        const url = tab.url || "";
        return (
          url.startsWith("https://chat.openai.com/") ||
          url.startsWith("https://chatgpt.com/")
        );
      });
      if (chatTab) return resolve(chatTab);
      const userTab = tabs.find((tab) => tab.url && !tab.url.startsWith("chrome://"));
      resolve(userTab || tabs[0]);
    });
  });
}

const statusLogEl = document.getElementById("statusLog");
const healthBar = document.getElementById("healthBar");
const healthPercent = document.getElementById("healthPercent");
const selectedCountEl = document.getElementById("selectedCount");

const MAX_TOKENS = 32000;
const TOKEN_TO_CHAR = 4;
const MAX_CHARS = MAX_TOKENS * TOKEN_TO_CHAR;

function logStatus(message) {
  if (statusLogEl) {
    statusLogEl.textContent = `Status: ${message}`;
  }
}

function ensureContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"],
      },
      () => {
        resolve();
      }
    );
  });
}

function sendMessage(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ error: err, data: null });
      } else {
        resolve({ error: null, data: response });
      }
    });
  });
}

async function getSelectedMessages() {
  const tab = await getActiveTab();
  if (!tab) {
    logStatus("no active tab available");
    return { tab: null, messages: [] };
  }
  await ensureContentScript(tab.id);
  const { error, data } = await sendMessage(tab.id, { type: "SNIPBOARD_GET_SELECTION" });
  if (error) {
    logStatus("content script unavailable");
    return { tab, messages: [] };
  }
  const messages = (data && data.messages) || [];
  return { tab, messages };
}

async function getAllMessages() {
  const tab = await getActiveTab();
  if (!tab) return [];
  await ensureContentScript(tab.id);
  const { data } = await sendMessage(tab.id, { type: "SNIPBOARD_GET_ALL_MESSAGES" });
  return (data && data.messages) || [];
}

function colorForPercent(pct) {
  if (pct < 60) return "green";
  if (pct < 80) return "yellow";
  if (pct < 95) return "orange";
  return "red";
}

async function updateHealth() {
  const messages = await getAllMessages();
  const totalChars = messages.join("").length;
  const pct = Math.min(100, Math.floor((totalChars / MAX_CHARS) * 100));
  const pctStr = `${pct}%`;
  const color = colorForPercent(pct);

  if (healthBar) {
    healthBar.style.position = "relative";
    healthBar.style.overflow = "hidden";
    healthBar.style.background = "#e5e7eb";
    healthBar.innerHTML = `<div style="width:${pct}%;height:100%;background:${color};transition:width 0.25s ease,background 0.25s ease;"></div>`;
  }
  if (healthPercent) healthPercent.textContent = pctStr;

  chrome.runtime.sendMessage({
    type: "SNIPBOARD_ICON_UPDATE",
    percentage: pct,
    color,
  });
}

async function updateSelectedCount() {
  const { messages } = await getSelectedMessages();
  const btn = document.getElementById("saveBtn");

  const count = messages.length;
  if (selectedCountEl) selectedCountEl.textContent = String(count);

  if (count === 0) {
    btn.disabled = true;
    btn.textContent = "Waiting...";
    logStatus("waiting for ChatGPT selection...");
  } else {
    btn.disabled = false;
    btn.textContent =
      count === 1 ? "Save 1 message to SnipBoard" : `Save ${count} messages`;
    logStatus(`${count} message${count === 1 ? "" : "s"} ready`);
  }
}

async function saveMessages(messages) {
  if (!messages || !messages.length) return;
  const tab = await getActiveTab();
  if (!tab) return;

  const sectionId = document.getElementById("sectionSelect").value;
  const titleInput = document.getElementById("titleInput").value;
  const tagsInput = document.getElementById("tagsInput").value;

  let title = titleInput && titleInput.trim();
  if (!title && messages.length > 0) {
    const first = messages[0].content || messages[0].text || "";
    title = first.split(/\r?\n/)[0].slice(0, 80) || "ChatGPT Snip";
  }

  const tags = tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const payload = {
    sectionId,
    title,
    tags,
    text: messages
      .map((m) => {
        const role = (m.role || "assistant").toUpperCase();
        const content = m.content || m.text || "";
        return `${role}:\n${content}`;
      })
      .join("\n\n"),
    sourceUrl: tab?.url || "",
    sourceTitle: tab?.title || "",
    capturedAt: Date.now(),
  };

  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const browserFetch =
      globalThis.fetch ||
      (typeof window !== "undefined" ? window.fetch : undefined) ||
      (() => Promise.reject(new Error("Fetch API unavailable")));

    await browserFetch("http://127.0.0.1:4050/add-clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    btn.textContent = "Saved!";
    globalThis.setTimeout(() => window.close(), 800);
  } catch (err) {
    console.error("[SnipBoard] POST failed:", err);
    btn.disabled = false;
    btn.textContent = "Error";
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "SNIPBOARD_SELECTION_UPDATED") {
    if (selectedCountEl) selectedCountEl.textContent = String(msg.count || 0);
    const btn = document.getElementById("saveBtn");
    if (btn) {
      if ((msg.count || 0) === 0) {
        btn.disabled = true;
        btn.textContent = "Waiting...";
      } else {
        btn.disabled = false;
        btn.textContent =
          msg.count === 1 ? "Save 1 message to SnipBoard" : `Save ${msg.count} messages`;
      }
    }
  }
  if (msg.type === "SNIPBOARD_AUTO_OPEN_POPUP") {
    try {
      window.focus();
    } catch (error) {
      void error;
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  updateSelectedCount();
  updateHealth();
  const selectControls = document.getElementById("selectControls");
  if (selectControls) selectControls.style.display = "none";

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const { messages } = await getSelectedMessages();
    if (!messages.length) return;
    await saveMessages(messages);
  });

  window.addEventListener("unload", async () => {
    const tab = await getActiveTab();
    if (tab) {
      await sendMessage(tab.id, { type: "SNIPBOARD_STOP" });
    }
  });
});

