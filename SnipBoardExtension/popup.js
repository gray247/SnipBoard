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
const enterSelectBtn = document.getElementById("enterSelectBtn");
const exitSelectBtn = document.getElementById("exitSelectBtn");

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
}

async function updateSelectedCount() {
  const { messages } = await getSelectedMessages();
  const countEl = document.getElementById("selectedCount");
  const btn = document.getElementById("saveBtn");

  const count = messages.length;
  countEl.textContent = String(count);

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

async function sendSelectMode(on) {
  const tab = await getActiveTab();
  if (!tab) return;
  await ensureContentScript(tab.id);
  const type = on ? "SNIPBOARD_SELECT_MODE_ON" : "SNIPBOARD_SELECT_MODE_OFF";
  await sendMessage(tab.id, { type });
}

document.addEventListener("DOMContentLoaded", () => {
  updateSelectedCount();
  updateHealth();

  enterSelectBtn?.addEventListener("click", async () => {
    await sendSelectMode(true);
    logStatus("Select Mode activated");
  });
  exitSelectBtn?.addEventListener("click", async () => {
    await sendSelectMode(false);
    logStatus("Select Mode deactivated");
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const { tab, messages } = await getSelectedMessages();
    if (!messages.length) return;

    const sectionId = document.getElementById("sectionSelect").value;
    const titleInput = document.getElementById("titleInput").value;
    const tagsInput = document.getElementById("tagsInput").value;

    let title = titleInput && titleInput.trim();
    if (!title && messages.length > 0) {
      const first = messages[0].content || "";
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
      text: messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n"),
      sourceUrl: tab?.url || "",
      sourceTitle: tab?.title || "",
      capturedAt: Date.now(),
    };

    const btn = document.getElementById("saveBtn");
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
      await fetch("http://127.0.0.1:4050/add-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      btn.textContent = "Saved!";
      setTimeout(() => window.close(), 800);
    } catch (err) {
      console.error("[SnipBoard] POST failed:", err);
      btn.disabled = false;
      btn.textContent = "Error";
    }
  });

  window.addEventListener("unload", async () => {
    const tab = await getActiveTab();
    if (tab) {
      await sendMessage(tab.id, { type: "SNIPBOARD_STOP" });
    }
  });
});
