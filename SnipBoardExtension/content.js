(() => {
  console.log("[SnipBoard EXT] content.js loaded (shadow select mode)");

  const MESSAGE_SELECTORS = [
    'article[data-message-id]',
    'article[data-testid^="conversation-turn"]',
    'article[data-turn]',
    'div[data-message-id]',
    'div[data-testid="conversation-turn"]',
    'div[data-testid="message"]',
    'div[data-testid="chat-message"]',
    'div[data-testid="assistant-response"]',
    'div[data-testid="user-response"]',
    'div.user-message-bubble-color',
    'div.assistant-message-bubble-color',
    'div.text-message',
    'div[role="listitem"]'
  ];

  const TEXT_CONTAINER_SELECTORS = [
    '[data-testid="message-text"]',
    '[data-testid="message-content"]',
    '[data-testid="message-body"]',
    ".markdown",
    ".result-streaming",
    ".message-inner",
    ".text-base",
    ".text-message",
    ".user-message-bubble-color",
    ".assistant-message-bubble-color",
    ".prose"
  ];

  let shadowHost = null;
  let shadowRoot = null;
  let highlightEl = null;
  let selectedLayer = null;
  let modeActive = false;
  let selectedMessages = [];
  let selectedMap = new WeakMap();
  let listenersBound = false;

  const readText = (node) => {
    if (!node) return "";
    const raw =
      typeof node.innerText === "string"
        ? node.innerText
        : node.textContent || "";
    return (raw || "").trim();
  };

  const looksLikeChatMessage = (node) => {
    const elementNodeType =
      (globalThis.Node || window.Node)?.ELEMENT_NODE ?? 1;
    if (!node || node.nodeType !== elementNodeType) return false;
    if (readText(node).length === 0) return false;
    return TEXT_CONTAINER_SELECTORS.some((sel) => node.querySelector(sel));
  };

  const findMessageNodeFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest(MESSAGE_SELECTORS.join(","));
  };

  const safeGetAllMessages = () => {
    const nodes = new Set();
    MESSAGE_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((node) => {
        if (looksLikeChatMessage(node)) nodes.add(node);
      });
    });
    return Array.from(nodes)
      .map((node) => getMessageContent(node))
      .filter(Boolean);
  };

  const getMessageRole = (node) => {
    if (!node) return "assistant";
    const roleAttr =
      node.getAttribute("data-message-author-role") ||
      node.getAttribute("data-role") ||
      node.getAttribute("data-author") ||
      node.getAttribute("data-user-role") ||
      "";
    const match = (roleAttr || "").toLowerCase();
    if (match.includes("assistant") || match.includes("chatgpt")) return "assistant";
    if (match.includes("user") || match.includes("you")) return "user";
    return "assistant";
  };

  const getMessageContent = (node) => {
    if (!node) return "";
    const container = TEXT_CONTAINER_SELECTORS.map((sel) => node.querySelector(sel)).find(Boolean);
    return (container && readText(container)) || readText(node);
  };

  const createShadowUI = () => {
    if (shadowRoot) return;
    shadowHost = document.createElement("div");
    shadowHost.id = "snipboard-shadow-host";
    shadowHost.style.position = "fixed";
    shadowHost.style.inset = "0";
    shadowHost.style.pointerEvents = "none";
    shadowHost.style.zIndex = "2147483647";
    document.documentElement.appendChild(shadowHost);

    shadowRoot = shadowHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }
      .highlight {
        position: fixed;
        border: 2px solid #2563eb;
        border-radius: 10px;
        background: rgba(37,99,235,0.08);
        pointer-events: none;
        display: none;
      }
      .selected-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      .selected-box {
        position: absolute;
        border: 2px solid #2563eb;
        border-radius: 10px;
        background: rgba(37,99,235,0.12);
        pointer-events: none;
      }
    `;
    shadowRoot.appendChild(style);

    highlightEl = document.createElement("div");
    highlightEl.className = "highlight";

    selectedLayer = document.createElement("div");
    selectedLayer.className = "selected-layer";
    shadowRoot.append(highlightEl, selectedLayer);
  };

  const updateHighlight = (node) => {
    if (!highlightEl) return;
    if (!node) {
      highlightEl.style.display = "none";
      return;
    }
    const rect = node.getBoundingClientRect();
    highlightEl.style.display = "block";
    highlightEl.style.top = `${rect.top}px`;
    highlightEl.style.left = `${rect.left}px`;
    highlightEl.style.width = `${rect.width}px`;
    highlightEl.style.height = `${rect.height}px`;
  };

  const renderSelectedHighlights = () => {
    if (!selectedLayer) return;
    selectedLayer.innerHTML = "";
    selectedMessages.forEach((entry) => {
      if (!entry.node || !document.body.contains(entry.node)) return;
      const rect = entry.node.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "selected-box";
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      selectedLayer.appendChild(box);
    });
  };

  const notifySelectionChange = () => {
    const count = selectedMessages.length;
    chrome.runtime.sendMessage({ type: "SNIPBOARD_SELECTION_UPDATED", count });
    renderSelectedHighlights();
  };

  const clearSelection = (exitMode = false) => {
    selectedMessages = [];
    selectedMap = new WeakMap();
    renderSelectedHighlights();
    notifySelectionChange();
    if (exitMode) deactivateSelectMode();
  };

  const deactivateSelectMode = () => {
    modeActive = false;
    if (highlightEl) highlightEl.style.display = "none";
    removeOverlayListeners();
  };

  const addOverlayListeners = () => {
    if (listenersBound) return;
    listenersBound = true;
    const target = document;
    target.addEventListener("mousemove", handleHover, true);
    target.addEventListener("click", handleClick, true);
    target.addEventListener("scroll", renderSelectedHighlights, true);
    document.addEventListener("keydown", handleKeydown, true);
  };

  const removeOverlayListeners = () => {
    if (!listenersBound) return;
    listenersBound = false;
    const target = document;
    target.removeEventListener("mousemove", handleHover, true);
    target.removeEventListener("click", handleClick, true);
    target.removeEventListener("scroll", renderSelectedHighlights, true);
    document.removeEventListener("keydown", handleKeydown, true);
  };

  const activateSelectMode = () => {
    createShadowUI();
    modeActive = true;
    addOverlayListeners();
  };

  const extractMessageAtPoint = (x, y) => {
    if (!modeActive) return null;
    const node = findMessageNodeFromPoint(x, y);
    if (!node || !looksLikeChatMessage(node)) return null;
    return {
      node,
      role: getMessageRole(node),
      content: getMessageContent(node)
    };
  };

  const handleHover = (e) => {
    if (!modeActive) return;
    const hit = extractMessageAtPoint(e.clientX, e.clientY);
    updateHighlight(hit?.node || null);
  };

  const handleClick = (e) => {
    if (!modeActive) return;
    e.preventDefault();
    e.stopPropagation();
    const hit = extractMessageAtPoint(e.clientX, e.clientY);
    if (!hit || !hit.node || !hit.content) return;
    if (selectedMap.has(hit.node)) {
      selectedMap.delete(hit.node);
      selectedMessages = selectedMessages.filter((m) => m.node !== hit.node);
    } else {
      const entry = { node: hit.node, role: hit.role, content: hit.content };
      selectedMap.set(hit.node, entry);
      selectedMessages.push(entry);
    }
    notifySelectionChange();
  };

  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      clearSelection(true);
    }
  };

  const cleanup = () => {
    deactivateSelectMode();
    selectedMessages = [];
    selectedMap = new WeakMap();
    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadowRoot = null;
    highlightEl = null;
    selectedLayer = null;
  };

  const ensureUIBindings = () => {
    createShadowUI();
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "SNIPBOARD_GET_ALL_MESSAGES") {
      sendResponse({ messages: safeGetAllMessages() });
      return;
    }
    if (msg.type === "SNIPBOARD_SELECT_MODE_ON_V2") {
      selectedMessages = [];
      selectedMap = new WeakMap();
      ensureUIBindings();
      activateSelectMode();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "SNIPBOARD_SELECT_MODE_OFF_AND_SAVE") {
      if (!selectedMessages.length) {
        cleanup();
        sendResponse({ ok: true, saved: false });
        return;
      }
      const text = selectedMessages
        .map((m) => `${(m.role || "assistant").toUpperCase()}:\n${m.content || ""}`)
        .join("\n\n");
      const title = `ChatGPT clip (${selectedMessages.length} message${selectedMessages.length === 1 ? "" : "s"})`;
      const browserFetch =
        globalThis.fetch ||
        (typeof window !== "undefined" ? window.fetch : undefined) ||
        (() => Promise.reject(new Error("Fetch API unavailable")));

      browserFetch("http://127.0.0.1:4050/add-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: "inbox",
          title,
          tags: [],
          text,
          sourceUrl: window.location.href,
          sourceTitle: document.title || "",
          capturedAt: Date.now(),
        }),
      })
        .catch(() => {})
        .finally(() => {
          cleanup();
          sendResponse({ ok: true, saved: true });
        });
      return true;
    }
    if (msg.type === "TOGGLE_SELECT_MODE") {
      if (!modeActive) {
        selectedMessages = [];
        selectedMap = new WeakMap();
        ensureUIBindings();
        activateSelectMode();
        sendResponse?.({ ok: true, mode: "on" });
        return;
      }

      // Turning off with a direct save from content.js
      if (!selectedMessages.length) {
        cleanup();
        sendResponse?.({ ok: true, mode: "off", saved: false });
        return;
      }
      const text = selectedMessages
        .map((m) => `${(m.role || "assistant").toUpperCase()}:\n${m.content || ""}`)
        .join("\n\n");
      const title = `ChatGPT clip (${selectedMessages.length} message${selectedMessages.length === 1 ? "" : "s"})`;
      const browserFetch =
        globalThis.fetch ||
        (typeof window !== "undefined" ? window.fetch : undefined) ||
        (() => Promise.reject(new Error("Fetch API unavailable")));

      browserFetch("http://127.0.0.1:4050/add-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: "inbox",
          title,
          tags: [],
          text,
          sourceUrl: window.location.href,
          sourceTitle: document.title || "",
          capturedAt: Date.now(),
        }),
      })
        .catch((err) => {
          console.error("[SnipBoard] save failed:", err);
        })
        .finally(() => {
          cleanup();
        sendResponse?.({ ok: true, mode: "off", saved: true });
      });
      return;
    }
    if (msg.type === "SNIPBOARD_GET_SELECTION") {
      sendResponse({ messages: selectedMessages.map((m) => ({ role: m.role, content: m.content })) });
      return;
    }
    if (msg.type === "SNIPBOARD_STOP") {
      cleanup();
      sendResponse({ ok: true });
      return;
    }
  });

  ensureUIBindings();
})();
