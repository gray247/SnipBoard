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
  let overlayEl = null;
  let highlightEl = null;
  let selectBtn = null;
  let exitBtn = null;
  let modeActive = false;
  let selectedMessages = [];
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
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
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
      .floating-btn {
        position: fixed;
        right: 16px;
        bottom: 16px;
        padding: 10px 12px;
        background: #2563eb;
        color: #fff;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
        cursor: pointer;
        border: none;
        outline: none;
        pointer-events: auto;
      }
      .floating-btn.secondary {
        background: #6b7280;
        right: 140px;
      }
      .overlay {
        position: fixed;
        inset: 0;
        background: transparent;
        pointer-events: auto;
        cursor: crosshair;
      }
      .highlight {
        position: fixed;
        border: 2px solid #2563eb;
        border-radius: 10px;
        background: rgba(37,99,235,0.08);
        pointer-events: none;
        display: none;
      }
    `;
    shadowRoot.appendChild(style);

    overlayEl = document.createElement("div");
    overlayEl.className = "overlay";
    overlayEl.style.display = "none";

    highlightEl = document.createElement("div");
    highlightEl.className = "highlight";

    selectBtn = document.createElement("button");
    selectBtn.className = "floating-btn";
    selectBtn.textContent = "Select Message";

    exitBtn = document.createElement("button");
    exitBtn.className = "floating-btn secondary";
    exitBtn.textContent = "Exit Select Mode";
    exitBtn.style.display = "none";

    shadowRoot.append(selectBtn, exitBtn, overlayEl, highlightEl);
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

  const deactivateSelectMode = () => {
    modeActive = false;
    if (overlayEl) overlayEl.style.display = "none";
    if (highlightEl) highlightEl.style.display = "none";
    if (selectBtn) selectBtn.style.display = "block";
    if (exitBtn) exitBtn.style.display = "none";
    removeOverlayListeners();
  };

  const addOverlayListeners = () => {
    if (!overlayEl || listenersBound) return;
    listenersBound = true;
    overlayEl.addEventListener("mousemove", handleHover, true);
    overlayEl.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeydown, true);
  };

  const removeOverlayListeners = () => {
    if (!overlayEl || !listenersBound) return;
    listenersBound = false;
    overlayEl.removeEventListener("mousemove", handleHover, true);
    overlayEl.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeydown, true);
  };

  const activateSelectMode = () => {
    createShadowUI();
    modeActive = true;
    if (overlayEl) overlayEl.style.display = "block";
    if (selectBtn) selectBtn.style.display = "none";
    if (exitBtn) exitBtn.style.display = "block";
    addOverlayListeners();
  };

  const extractMessageAtPoint = (x, y) => {
    if (!modeActive) return null;
    overlayEl.style.pointerEvents = "none";
    const node = findMessageNodeFromPoint(x, y);
    overlayEl.style.pointerEvents = "auto";
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
    if (hit && hit.content) {
      selectedMessages.push({ role: hit.role, content: hit.content });
    }
  };

  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      deactivateSelectMode();
    }
  };

  const cleanup = () => {
    deactivateSelectMode();
    selectedMessages = [];
    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadowRoot = null;
    overlayEl = null;
    highlightEl = null;
    selectBtn = null;
    exitBtn = null;
  };

  const ensureUIBindings = () => {
    createShadowUI();
    if (selectBtn && !selectBtn._bound) {
      selectBtn._bound = true;
      selectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateSelectMode();
      });
    }
    if (exitBtn && !exitBtn._bound) {
      exitBtn._bound = true;
      exitBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deactivateSelectMode();
      });
    }
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "SNIPBOARD_GET_ALL_MESSAGES") {
      sendResponse({ messages: safeGetAllMessages() });
      return true;
    }
    if (msg.type === "SNIPBOARD_SELECT_MODE_ON") {
      ensureUIBindings();
      activateSelectMode();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "SNIPBOARD_SELECT_MODE_OFF") {
      deactivateSelectMode();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "SNIPBOARD_GET_SELECTION") {
      sendResponse({ messages: selectedMessages.slice() });
      return true;
    }
    if (msg.type === "SNIPBOARD_STOP") {
      cleanup();
      sendResponse({ ok: true });
      return true;
    }
  });

  ensureUIBindings();
})();
