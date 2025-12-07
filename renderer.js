// ===============================================================
// SnipBoard – CLEAN WORKING RENDERER
// ===============================================================

console.log("[SnipBoard] renderer.js loaded");

let lockedSections = new Set(["common-prompts"]);

const state = {
  sections: [],
  clips: [],
  currentSectionId: "all",
  tabs: [],
  activeTabId: "all",
  currentClipId: null,
  selectedClipIds: new Set(),
  searchText: "",
  tagFilter: "",
  editingSectionId: null,
  renameDraft: "",
  pendingColorSection: null,
  pendingIconSection: null,
  selectedIcon: "",
  selectedColor: "",
  pendingRenameSectionId: null,
  sortMode: "default",
};

const IPC = {
  GET_DATA: "get-data",
  SAVE_CLIP: "save-clip",
  DELETE_CLIP: "delete-clip",
  DELETE_CLIPS: "delete-clips",
  CREATE_SECTION: "create-section",
  RENAME_SECTION: "rename-section",
  UPDATE_SECTION: "update-section",
  LOAD_TABS: "tabs:load",
  SAVE_TABS: "tabs:save",
  CHOOSE_EXPORT_FOLDER: "choose-export-folder",
  SAVE_SCREENSHOT: "save-screenshot",
  CAPTURE_SCREEN: "capture-screen",
  OPEN_URL: "open-url",
  SET_SECTION_EXPORT_PATH: "set-section-export-path",
  SET_SECTION_LOCKED: "set-section-locked",
  SAVE_SECTION_ORDER: "save-section-order"
};

const DEFAULT_SCHEMA = ["title", "text", "screenshots", "tags", "sourceUrl", "sourceTitle", "capturedAt", "notes"];
const FIELD_OPTIONS = DEFAULT_SCHEMA.slice();
const TAB_COLORS = [
  "#FF4F4F", // red
  "#FF914D", // orange
  "#FFC145", // yellow-orange
  "#F7F3D6", // ivory (replaces white)
  "#7ED957", // green
  "#3CB371", // dark mint
  "#2ECCFA", // sky blue
  "#3A7BEB", // strong blue
  "#485B9A", // slate blue (replaces black)
  "#6A5ACD", // soft purple
  "#A56BF5", // lavender
  "#FF66C4", // pink
  "#C13CFF", // violet
  "#6E6E6E", // medium gray
  "#CFCFCF",  // light gray
];
const SNIPBOARD_COLORS = TAB_COLORS;
let searchIndex = new Map();
let draggingClipId = null;
function noopInvoke(channel, args) {
  return window.api.invoke(channel, args);
}

// Future-use IPC wrappers (no-op behavior)
async function noopDeleteClip(id) { return noopInvoke(IPC.DELETE_CLIP, id); }
async function noopGetScreenshotUrl(name) { return noopInvoke("get-screenshot-url", name); }
async function noopListDisplays() { return noopInvoke("list-displays"); }
async function noopDebugListDisplays() { return noopInvoke("debug-list-displays"); }

let lastPollSignature = "";
let handlersBound = false;
let hiddenColorInput = null;
let draggingSectionId = null;
let dragHoverSectionId = null;
const protectedSections = new Set(["inbox", "common-prompts", "black-skies", "errors", "misc"]);
let saveTabsTimer = null;
let syncingTabs = false;
const iconChoices = [
  { id: "inbox", label: "Inbox", emoji: "\u{1F4E5}" },
  { id: "folder", label: "Folder", emoji: "\u{1F4C1}" },
  { id: "test", label: "Flask", svg: '<svg viewBox="0 0 24 24" fill="#2FAACE" xmlns="http://www.w3.org/2000/svg"><path d="M9 3h6v2h-1v3.6l3.7 5.9c.6 1-.1 2.3-1.3 2.3H7.6c-1.2 0-1.9-1.3-1.3-2.3L10 8.6V5H9V3Zm4 7.3 2.3 3.7H8.7L11 10.3V5h2v5.3Z"/></svg>' },
  { id: "errors", label: "Errors", emoji: "\u26A0\uFE0F" },
  { id: "ideas", label: "Ideas", emoji: "\u{1F4A1}" },
  { id: "star", label: "Star", emoji: "\u2B50" },
  {
    id: "book",
    label: "Book",
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="#A8754F" d="M6 4h9a3 3 0 0 1 3 3v14H9a3 3 0 0 0-3-3V4Z"/><path fill="#A8754F" d="M6 8h12v2H6z"/><path fill="#A8754F" d="M6 17a3 3 0 0 1 3 3H6z"/></svg>',
  },
  {
    id: "keyboard",
    label: "Keyboard",
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" rx="2" fill="#222222"/><rect x="6" y="9" width="2" height="2" fill="#f5f5f5"/><rect x="9" y="9" width="2" height="2" fill="#f5f5f5"/><rect x="12" y="9" width="2" height="2" fill="#f5f5f5"/><rect x="15" y="9" width="2" height="2" fill="#f5f5f5"/><rect x="18" y="9" width="2" height="2" fill="#f5f5f5"/><rect x="6" y="12" width="12" height="2" fill="#f5f5f5"/></svg>',
  },
  {
    id: "rocket",
    label: "Rocket",
    svg: '<svg viewBox="0 0 24 24" fill="#1CA8A6" xmlns="http://www.w3.org/2000/svg"><path d="M13.4 2.2c2.3.1 4.5 1 6.1 2.6l.3.3-6.7 6.7L10.2 8 13.4 2.2ZM9.6 9.3 7.4 7.1c-1.6 1.3-2.7 3-3.2 4.9l2.9-1 2.5 2.5-1 2.9c1.9-.5 3.6-1.6 4.9-3.2l-2.2-2.2-1.7-1.7Zm3.3 5-2.3 2.3c-.7.7-.7 2 0 2.7l.2.2c.7.7 2 .7 2.7 0l2.3-2.3-2.9-2.9Z"/><path d="M6.7 16.8 4.9 18.6l.5 1.9 1.9.5 1.8-1.8-2.4-2.4Z" fill="#1CA8A6"/></svg>',
  },
  {
    id: "bug",
    label: "Bug",
    svg: '<svg viewBox="0 0 24 24" fill="#E44D4D" xmlns="http://www.w3.org/2000/svg"><path d="M10.5 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V5h-3V3.5ZM8 5c0-.6.4-1 1-1h6c.6 0 1 .4 1 1v.8c1 .6 1.7 1.6 1.9 2.7h1.1c.6 0 1 .4 1 1s-.4 1-1 1h-1v1.5c0 .3 0 .6-.1.9h1.1c.6 0 1 .4 1 1s-.4 1-1 1h-1.6a6 6 0 0 1-5.4 3.1h-.8A6 6 0 0 1 6 15h-1.6c-.6 0-1-.4-1-1s.4-1 1-1h1.1c-.1-.3-.1-.6-.1-.9V11h-1c-.6 0-1-.4-1-1s.4-1 1-1h1.1A3.7 3.7 0 0 1 8 5.8V5Zm2 4a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2h-4Z"/></svg>',
  },
  {
    id: "gear",
    label: "Gear",
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="#6E6E6E" d="M14.8 3.8c.1-.4.5-.6.9-.5l1.7.7c.4.2.6.6.4 1l-.5 1.3c.5.5.9 1 .1.1 1 .5 1.8 1.2 2.4 2l1-.2c.4-.1.8.1.9.5l.4 1.8c.1.4-.2.9-.6 1l-1.1.3c.1.5.1 1 0 1.5l1.1.3c.4.1.7.6.6 1l-.4 1.8c-.1.4-.5.6-.9.5l-1-.2c-.6.8-1.4 1.5-2.4 2l.5 1.3c.1.4 0 .8-.4 1l-1.7.7c-.4.1-.8 0-1-.4l-.5-1.1c-1 .1-2 0-3-.2l-.5 1.1c-.2.4-.6.5-1 .4l-1.7-.7c-.4-.2-.6-.6-.4-1l.5-1.3c-.9-.5-1.7-1.2-2.4-2l-1 .2c-.4.1-.8-.1-.9-.5l-.4-1.8c-.1-.4.2-.9.6-1l1.1-.3a6.7 6.7 0 0 1 0-1.5l-1.1-.3c-.4-.1-.7-.6-.6-1l.4-1.8c.1-.4.5-.6.9-.5l1 .2c.6-.8 1.4-1.5 2.4-2l-.5-1.3c-.2-.4 0-.8.4-1l1.7-.7c.4-.1.8 0 1 .4l.5 1.1c1-.1 2 0 3 .2l.5-1.1Z"/><circle cx="12" cy="12" r="3" fill="#f5f5f5"/></svg>',
  },
  {
    id: "clock",
    label: "Clock",
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="#708090"/><path stroke="#f8fafc" stroke-width="2" stroke-linecap="round" d="M12 8v4l3 2"/></svg>',
  },
  {
    id: "pencil",
    label: "Pencil",
    svg: '<svg viewBox="0 0 24 24" fill="#A56BF5" xmlns="http://www.w3.org/2000/svg"><path d="M14.8 3.3c.4-.4 1.1-.4 1.5 0l2.4 2.4c.4.4.4 1.1 0 1.5L10 16.9l-4.2.9.9-4.2L14.8 3.3Zm-8 13.4 1.5-.4-1.1-1.1-.4 1.5Z"/><path d="m14 5.1 2.9 2.9-1.2 1.2-2.9-2.9 1.2-1.2Z" fill="#8F5BEF"/></svg>',
  },
  {
    id: "cloud",
    label: "Cloud",
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="#65D1FF" d="M17.5 19H8a5 5 0 1 1 1-9.9 6 6 0 0 1 11 .9A4 4 0 0 1 17.5 19Z"/></svg>',
  },
  {
    id: "globe",
    label: "Globe",
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" fill="#4A90E2"/><path stroke="#e6f4ff" stroke-width="1.5" d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  },
];
const DEFAULT_TABS = [
  { id: "inbox", label: "Inbox", locked: false, exportFolder: "", color: "", icon: "", order: 0, schema: DEFAULT_SCHEMA.slice() },
  { id: "common-prompts", label: "Common Prompts", locked: false, exportFolder: "", color: "", icon: "", order: 1, schema: DEFAULT_SCHEMA.slice() },
  { id: "black-skies", label: "Black Skies", locked: false, exportFolder: "", color: "", icon: "", order: 2, schema: DEFAULT_SCHEMA.slice() },
  { id: "errors", label: "Errors", locked: false, exportFolder: "", color: "", icon: "", order: 3, schema: DEFAULT_SCHEMA.slice() },
  { id: "misc", label: "Misc", locked: false, exportFolder: "", color: "", icon: "", order: 4, schema: DEFAULT_SCHEMA.slice() },
];
const EXPORT_BASE = "data/exports";
const EXPORT_BASE = "data/exports";
// ===============================================================
// DOM ELEMENTS
// ===============================================================

const sectionTabs = document.getElementById("sectionTabs");
const clipList = document.getElementById("clipList");

const textInput = document.getElementById("textInput");
const titleInput = document.getElementById("titleInput");
const notesInput = document.getElementById("notesInput");
const tagsInput = document.getElementById("tagsInput");
const screenshotBox = document.getElementById("screenshotContainer");

const sectionSelect = document.getElementById("sectionSelect");
const sourceUrlInput = document.getElementById("sourceUrlInput");
const sourceTitleInput = document.getElementById("sourceTitleInput");
const capturedAtInput = document.getElementById("capturedAtInput");
const titleRow = document.querySelector(".title-row");
const textRow = textInput ? textInput.closest(".field-row") : null;
const screenshotsRow = screenshotBox ? screenshotBox.closest(".field-row") : null;
const tagsRow = document.querySelector(".tags-row");
const tagsCol = document.querySelector(".tags-col");
const capturedCol = document.querySelector(".captured-col");
const sourceRow = document.querySelector(".source-row");
const sourceUrlCol = document.querySelector(".source-url");
const sourceTitleCol = sourceTitleInput ? sourceTitleInput.parentElement : null;
const notesRow = notesInput ? notesInput.closest(".field-row") : null;
const screenshotEditModalId = "screenshot-edit-modal";

const newClipBtn = document.getElementById("newClipBtn");
const newSnipBtn = document.getElementById("newSnipBtn");
const saveClipBtn = document.getElementById("saveClipBtn");
const deleteClipBtn = document.getElementById("deleteClipBtn");
const addShotBtn = document.getElementById("addShotBtn");

const searchInput = document.getElementById("searchInput");
const tagFilterInput = document.getElementById("tagFilterInput");
const topbarTools = document.getElementById("topbarTools");
const sortToggleBtn = document.getElementById("sortToggleBtn");
const filterToggleBtn = document.getElementById("filterToggleBtn");
const sortMenu = document.getElementById("sortMenu");
const filterMenu = document.getElementById("filterMenu");
const filterApplyBtn = document.getElementById("filterApplyBtn");
const filterClearBtn = document.getElementById("filterClearBtn");
const openSourceBtn = document.getElementById("openSourceBtn");
const listAddBtn = document.getElementById("listAddBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const listDeleteBtn = document.getElementById("listDeleteBtn");
const lockToggleBtn = document.getElementById("lockToggleBtn");
const setExportBtn = document.getElementById("setExportBtn");
const clearExportBtn = document.getElementById("clearExportBtn");
const exportPathDisplay = document.getElementById("exportPathDisplay");
const lockSectionCheckbox = null;
const tabContextMenu = document.getElementById("tabContextMenu");
const renameModal = document.getElementById("renameModal");
const renameInput = document.getElementById("renameInput");
const renameSaveBtn = document.getElementById("renameSaveBtn");
const renameCancelBtn = document.getElementById("renameCancelBtn");
const colorModal = document.getElementById("colorModal");
const colorSwatches = document.getElementById("colorSwatches");
const colorSaveBtn = document.getElementById("colorSaveBtn");
const colorCancelBtn = document.getElementById("colorCancelBtn");
const iconModal = document.getElementById("iconModal");
const iconChoicesContainer = document.getElementById("iconChoices");
const iconSaveBtn = document.getElementById("iconSaveBtn");
const iconCancelBtn = document.getElementById("iconCancelBtn");

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function sectionLabel(id) {
  switch (id) {
    case "all": return "All";
    case "inbox": return "Inbox";
    case "common-prompts": return "Common Prompts";
    case "black-skies": return "Black Skies";
    case "errors": return "Errors";
    case "misc": return "Misc";
    default: return id || "";
  }
}

function computeSignature(arr) {
  try {
    return JSON.stringify(arr);
  } catch {
    return "";
  }
}

function slugifyTabName(name) {
  const base = (name || "tab").toString().toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "tab";
}

function canonicalExportPath(name) {
  return `${EXPORT_BASE}/${slugifyTabName(name)}`;
}

function normalizeExportPath(pathValue, name) {
  const safeName = name || "tab";
  const raw = typeof pathValue === "string" ? pathValue.trim() : "";
  const lowered = raw.toLowerCase().replace(/\\/g, "/");
  if (!raw || lowered === "data" || lowered === "data/") {
    return canonicalExportPath(safeName);
  }
  if (lowered === "data/exports" || lowered === "data/exports/") {
    return canonicalExportPath(safeName);
  }
  if (/^data\/(?!exports)/.test(lowered)) {
    return canonicalExportPath(safeName);
  }
  return raw;
}

function getCurrentClip() {
  return state.clips.find(c => c.id === state.currentClipId) || null;
}

function updateSearchIndex(clips) {
  searchIndex = new Map();
  (clips || []).forEach((clip) => {
    const tagsString = Array.isArray(clip.tags) ? clip.tags.join(" ") : "";
    const entry = `${clip.title || ""} ${clip.text || ""} ${tagsString}`.toLowerCase();
    searchIndex.set(clip.id, entry);
  });
}

function applySchemaVisibility(schema) {
  const schemaSet = new Set(Array.isArray(schema) && schema.length ? schema : DEFAULT_SCHEMA);
  if (!titleRow || !textRow || !screenshotsRow || !tagsRow || !sourceRow || !notesRow) return;
  titleRow.style.display = schemaSet.has("title") ? "" : "none";
  textRow.style.display = schemaSet.has("text") ? "" : "none";
  screenshotsRow.style.display = schemaSet.has("screenshots") ? "" : "none";
  if (tagsRow) {
    const showTags = schemaSet.has("tags");
    const showCaptured = schemaSet.has("capturedAt");
    tagsRow.style.display = showTags || showCaptured ? "" : "none";
    if (tagsCol) tagsCol.style.display = showTags ? "" : "none";
    if (capturedCol) capturedCol.style.display = showCaptured ? "" : "none";
  }
  const showUrl = schemaSet.has("sourceUrl");
  const showTitle = schemaSet.has("sourceTitle");
  sourceRow.style.display = showUrl || showTitle ? "" : "none";
  if (sourceUrlCol) sourceUrlCol.style.display = showUrl ? "" : "none";
  if (sourceTitleCol) sourceTitleCol.style.display = showTitle ? "" : "none";
  notesRow.style.display = schemaSet.has("notes") ? "" : "none";
}

function findIconChoice(value) {
  if (!value) return null;
  return iconChoices.find((c) => c.id === value || c.emoji === value || c.icon === value) || null;
}

function createIconGlyph(choice, fallbackText = "") {
  const span = document.createElement("span");
  span.className = "section-pill__icon";
  if (choice && choice.svg) {
    span.innerHTML = choice.svg;
  } else if (choice && (choice.emoji || choice.icon)) {
    span.textContent = choice.emoji || choice.icon;
  } else if (fallbackText) {
    span.textContent = fallbackText;
  }
  return span;
}

function closeQuickMenus() {
  if (sortMenu) sortMenu.classList.remove("is-open");
  if (filterMenu) filterMenu.classList.remove("is-open");
}

function toggleQuickMenu(menuEl) {
  if (!menuEl) return;
  const isOpen = menuEl.classList.contains("is-open");
  closeQuickMenus();
  if (!isOpen) menuEl.classList.add("is-open");
}

function applyTagFilterValue(value) {
  state.tagFilter = value || "";
  if (tagFilterInput) tagFilterInput.value = state.tagFilter;
  renderClipList();
}

function renderColorPalette(container, selectedColor, onSelect, includeNone = false) {
  if (!container) return;
  container.innerHTML = "";

  const createSwatch = (color, label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    if (!color) btn.classList.add("color-swatch--none");
    if (color === selectedColor) btn.classList.add("selected");
    btn.style.backgroundColor = color || "transparent";
    if (!color) btn.textContent = label || "None";
    btn.onclick = () => {
      container.querySelectorAll(".color-swatch.selected").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      if (typeof onSelect === "function") onSelect(color || "");
    };
    container.appendChild(btn);
  };

  if (includeNone) createSwatch("", "None");
  SNIPBOARD_COLORS.forEach((clr) => createSwatch(clr));
}

function openScreenshotEditor(src, filename, clip) {
  const existing = document.getElementById(screenshotEditModalId);
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = screenshotEditModalId;
  overlay.className = "screenshot-editor-overlay";

  const modal = document.createElement("div");
  modal.className = "screenshot-editor-dialog";

  const toolbar = document.createElement("div");
  toolbar.className = "screenshot-editor-toolbar";

  const canvas = document.createElement("canvas");
  canvas.className = "screenshot-editor-canvas";
  const ctx = canvas.getContext("2d");

  let drawing = false;
  let erasing = false;
  let penColor = SNIPBOARD_COLORS[0];
  let lastX = 0;
  let lastY = 0;
  let imgLoaded = false;

  const teardown = () => {
    canvas.removeEventListener("mousedown", startDraw);
    canvas.removeEventListener("mousemove", moveDraw);
    canvas.removeEventListener("mouseup", endDraw);
    canvas.removeEventListener("mouseleave", endDraw);
    overlay.remove();
  };

  const penBtn = document.createElement("button");
  penBtn.textContent = "Pen";
  penBtn.className = "btn ghost";
  const eraserBtn = document.createElement("button");
  eraserBtn.textContent = "Eraser";
  eraserBtn.className = "btn ghost";

  const setMode = (erase) => {
    erasing = erase;
    penBtn.classList.toggle("active", !erase);
    eraserBtn.classList.toggle("active", erase);
  };
  penBtn.onclick = () => setMode(false);
  eraserBtn.onclick = () => setMode(true);
  setMode(false);

  const colorRow = document.createElement("div");
  colorRow.className = "color-swatch-row";
  renderColorPalette(colorRow, penColor, (color) => {
    penColor = color || SNIPBOARD_COLORS[0];
    setMode(false);
  });

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "btn primary";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "btn ghost";
  cancelBtn.onclick = () => teardown();

  toolbar.appendChild(penBtn);
  toolbar.appendChild(eraserBtn);
  toolbar.appendChild(colorRow);
  toolbar.appendChild(spacer);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(cancelBtn);

  modal.appendChild(toolbar);
  modal.appendChild(canvas);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const img = new Image();
  img.onload = () => {
    imgLoaded = true;
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    canvas.width = naturalW;
    canvas.height = naturalH;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.onerror = (err) => {
    console.error("[SnipBoard] Failed to load screenshot for edit:", err);
    teardown();
  };
  img.src = src;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const draw = (x, y) => {
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = erasing ? "rgba(0,0,0,1)" : penColor;
    ctx.lineWidth = erasing ? 16 : 4;
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastX = x;
    lastY = y;
  };

  function startDraw(e) {
    if (!imgLoaded) return;
    drawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
  }
  function moveDraw(e) {
    if (!drawing || !imgLoaded) return;
    const pos = getPos(e);
    draw(pos.x, pos.y);
  }
  function endDraw() {
    drawing = false;
    ctx.globalCompositeOperation = "source-over";
  }

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", moveDraw);
  canvas.addEventListener("mouseup", endDraw);
  canvas.addEventListener("mouseleave", endDraw);

  saveBtn.onclick = async () => {
    if (!imgLoaded) return;
    const dataUrl = canvas.toDataURL("image/png");
    await window.api.invoke("save-screenshot", [{ dataUrl, filename }]);
    teardown();
    await refreshData(clip.id);
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) teardown();
  });
}

function normalizeTabs(tabs) {
  if (!Array.isArray(tabs)) {
    return DEFAULT_TABS.map((t, idx) => {
      const path = canonicalExportPath(t.label || t.id || `tab-${idx + 1}`);
      return { ...t, order: idx, exportPath: path, exportFolder: path };
    });
  }
  const sanitizeSchema = (schema) => {
    if (!Array.isArray(schema) || !schema.length) return DEFAULT_SCHEMA.slice();
    const filtered = schema.filter((f) => FIELD_OPTIONS.includes(f));
    return filtered.length ? filtered : DEFAULT_SCHEMA.slice();
  };
  return tabs
    .map((t, idx) => ({
      id: t.id || `tab-${idx}`,
      label: t.label || t.name || `Tab ${idx + 1}`,
      locked: Boolean(t.locked),
      exportFolder: (() => {
        const name = t.label || t.name || t.id || `tab-${idx + 1}`;
        const existing = typeof t.exportFolder === "string" ? t.exportFolder : "";
        return normalizeExportPath(existing || t.exportPath, name);
      })(),
      exportPath: (() => {
        const name = t.label || t.name || t.id || `tab-${idx + 1}`;
        const existing = typeof t.exportPath === "string" ? t.exportPath : "";
        const folder = typeof t.exportFolder === "string" ? t.exportFolder : "";
        return normalizeExportPath(existing || folder, name);
      })(),
      color: typeof t.color === "string" ? t.color : "",
      icon: typeof t.icon === "string" ? t.icon : "",
      order: Number.isFinite(t.order) ? t.order : idx,
      schema: sanitizeSchema(t.schema),
    }))
    .sort((a, b) => a.order - b.order);
}

function tabsToSections(tabs) {
  return tabs.map((t) => ({
    id: t.id,
    name: t.label,
    locked: t.locked,
    exportPath: t.exportPath || t.exportFolder || "",
    exportFolder: t.exportFolder || t.exportPath || "",
    color: t.color || "",
    icon: t.icon || "",
    schema: Array.isArray(t.schema) ? t.schema : DEFAULT_SCHEMA.slice(),
  }));
}

function sectionsToTabs(sections) {
  if (!Array.isArray(sections)) return DEFAULT_TABS;
  return sections.map((s, idx) => ({
    id: s.id,
    label: s.name || s.id || `Tab ${idx + 1}`,
    locked: !!s.locked,
    exportFolder: normalizeExportPath(s.exportFolder || s.exportPath || "", s.name || s.id || `Tab ${idx + 1}`),
    exportPath: normalizeExportPath(s.exportPath || s.exportFolder || "", s.name || s.id || `Tab ${idx + 1}`),
    color: s.color || "",
    icon: s.icon || "",
    order: Number.isFinite(s.order) ? s.order : idx,
    schema: Array.isArray(s.schema) && s.schema.length ? s.schema : DEFAULT_SCHEMA.slice(),
  }));
}

function syncSectionsFromTabs() {
  state.sections = tabsToSections(state.tabs);
}

async function syncTabsToBackend() {
  if (syncingTabs) return;
  syncingTabs = true;
  try {
    for (const tab of state.tabs) {
      await window.api.invoke(IPC.SET_SECTION_EXPORT_PATH, { id: tab.id, exportPath: tab.exportFolder || "" });
      await window.api.invoke(IPC.SET_SECTION_LOCKED, { id: tab.id, locked: !!tab.locked });
    }
    await window.api.invoke(IPC.SAVE_SECTION_ORDER, state.tabs.map((t, idx) => ({ id: t.id, name: t.label, order: idx })));
  } catch (err) {
    console.error("[SnipBoard] syncTabsToBackend failed:", err);
  } finally {
    syncingTabs = false;
  }
}

function getActiveTab() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId) || null;
  if (tab && (!Array.isArray(tab.schema) || !tab.schema.length)) {
    tab.schema = DEFAULT_SCHEMA.slice();
  }
  return tab;
}

function updateSidebarHeader() {
  const nameEl = document.getElementById("clipTabName");
  const pathEl = document.getElementById("clipTabPath");
  if (!nameEl || !pathEl) return;

  const activeTab = getActiveTab();
  nameEl.textContent = activeTab ? (activeTab.name || activeTab.label || sectionLabel(activeTab.id)) : "";
  const finalPath = activeTab ? (activeTab.exportPath || activeTab.exportFolder || "") : "";
  pathEl.textContent = finalPath;
}

function getSectionById(id) {
  return state.sections.find((s) => s.id === id) || null;
}

function formatDateTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function pruneSelected() {
  const existingIds = new Set(state.clips.map((c) => c.id));
  state.selectedClipIds.forEach((id) => {
    if (!existingIds.has(id)) state.selectedClipIds.delete(id);
  });
}

function normalizeSections(sections) {
  return (sections || []).map((s) => ({
    ...s,
    exportFolder: s.exportFolder ?? s.exportPath ?? "",
    exportPath: s.exportPath ?? s.exportFolder ?? "",
    color: s.color || "",
    icon: s.icon || "",
  }));
}

function updateExportPathDisplay() {
  const activeTab = getActiveTab();
  if (!activeTab || state.activeTabId === "all") {
    exportPathDisplay.textContent = "No section selected";
    if (setExportBtn) setExportBtn.disabled = true;
    if (clearExportBtn) clearExportBtn.disabled = true;
    return;
  }
  if (setExportBtn) setExportBtn.disabled = true;
  if (clearExportBtn) clearExportBtn.disabled = true;
  const path = activeTab.exportFolder;
  exportPathDisplay.textContent = path || "(not set)";
}

function isSectionLocked(sectionId) {
  if (!sectionId || sectionId === "all") return false;
  const tab = state.tabs.find((t) => t.id === sectionId);
  if (tab) return !!tab.locked;
  return lockedSections.has(sectionId);
}

function syncLockedSectionsFromState() {
  const persisted = state.sections.filter((s) => s.locked).map((s) => s.id);
  lockedSections = new Set([...lockedSections, ...persisted]);
}

function scheduleSaveTabsConfig() {
  if (saveTabsTimer) clearTimeout(saveTabsTimer);
  saveTabsTimer = setTimeout(async () => {
    const payload = {
      tabs: state.tabs.map((t, idx) => ({
        ...t,
        exportPath: t.exportPath || t.exportFolder || "",
        exportFolder: t.exportFolder || t.exportPath || "",
        order: Number.isFinite(t.order) ? t.order : idx,
      })),
      activeTabId: state.activeTabId || "all",
    };
    try {
      window.tabsState = payload;
      await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
    } catch (err) {
      console.error("[SnipBoard] saveTabsConfig failed:", err);
    }
  }, 250);
}

async function updateSection(id, patch) {
  if (!id) return null;
  const current = state.sections.find((s) => s.id === id);
  if (current) {
    Object.assign(current, patch);
  }

  try {
    await window.api.invoke(IPC.UPDATE_SECTION, { id, patch });
    if (patch.locked !== undefined) {
      await window.api.invoke(IPC.SET_SECTION_LOCKED, { id, locked: patch.locked });
    }
    if (patch.exportFolder !== undefined || patch.exportPath !== undefined) {
      const pathVal = patch.exportFolder ?? patch.exportPath ?? "";
      await window.api.invoke(IPC.SET_SECTION_EXPORT_PATH, { id, exportPath: pathVal });
    }
    await window.api.invoke(IPC.SAVE_SECTION_ORDER, state.sections.map((s) => ({ id: s.id, name: s.name })));
  } catch (err) {
    console.error("[SnipBoard] updateSection failed:", err);
  }

  if (patch.locked !== undefined) {
    if (patch.locked) lockedSections.add(id);
    else lockedSections.delete(id);
  }

  return current;
}

function updateDeleteButtonsLockState() {
  const locked = isSectionLocked(state.currentSectionId);
  if (deleteClipBtn) deleteClipBtn.disabled = locked;
  if (deleteSelectedBtn) deleteSelectedBtn.disabled = locked;
  if (listDeleteBtn) listDeleteBtn.disabled = locked;
}

function openScreenshotModal(src) {
  const modal = document.getElementById("screenshotModal");
  const img = document.getElementById("shotModalImage");
  if (!modal || !img || !src) return;

  img.src = src;
  modal.classList.add("is-open");

  const escHandler = (evt) => {
    if (evt.key === "Escape") {
      closeScreenshotModal();
    }
  };

  modal._escHandler = escHandler;
  document.addEventListener("keydown", escHandler);
}

function closeScreenshotModal() {
  const modal = document.getElementById("screenshotModal");
  const img = document.getElementById("shotModalImage");
  if (!modal || !img) return;

  modal.classList.remove("is-open");
  img.src = "";

  if (modal._escHandler) {
    document.removeEventListener("keydown", modal._escHandler);
    modal._escHandler = null;
  }
}

const lockSectionCheckboxHandler = () => {
  const id = state.currentSectionId;
  if (!id || id === "all") {
    return;
  }
  const next = !lockedSections.has(id);
  if (next) lockedSections.add(id);
  else lockedSections.delete(id);
  const sec = state.sections.find((s) => s.id === id);
  if (sec) sec.locked = next;
  updateSection(id, { locked: next });
  renderSections();
  updateDeleteButtonsLockState();
  renderLockButtonState();
};

function setCurrentSection(sectionId) {
  if (!sectionId) sectionId = "all";
  state.currentSectionId = sectionId;
  state.activeTabId = sectionId;
  state.currentClipId = null;
  closeTabContextMenu();

  renderSections();
  renderClipList();
  renderEditor();
  updateExportPathDisplay();
  updateDeleteButtonsLockState();
  renderLockButtonState();
  updateSidebarHeader();
  scheduleSaveTabsConfig();
}

function renderLockButtonState() {
  if (!lockToggleBtn) return;
  const locked = isSectionLocked(state.currentSectionId);
  lockToggleBtn.textContent = locked ? "\ud83d\udd12" : "\ud83d\udd13";
  lockToggleBtn.title = "Lock this section";
}

if (lockToggleBtn) {
  lockToggleBtn.addEventListener("click", lockSectionCheckboxHandler);
}

async function renderScreenshots(clip) {
  screenshotBox.innerHTML = "";
  const shots = Array.isArray(clip.screenshots) ? clip.screenshots : [];
  const baseUrl = "http://127.0.0.1:4050/screenshots";
  for (const file of shots) {
    if (!file) continue;
    const img = document.createElement("img");
    img.className = "thumb screenshot-thumb";
    img.src = `${baseUrl}/${file}`;
    img.onerror = () => {
      img.remove();
      const missing = document.createElement("div");
      missing.className = "screenshot-missing";
      missing.textContent = "(screenshot missing)";
      screenshotBox.appendChild(missing);
    };
    img.addEventListener("dblclick", () => openScreenshotModal(img.src));
    img.addEventListener("click", () => openScreenshotModal(img.src));
    img.oncontextmenu = async (e) => {
      e.preventDefault();
      const ok = window.confirm("Delete this screenshot?");
      if (!ok) return;
      try {
        const res = await window.api.invoke("delete-screenshot", { clipId: clip.id, filename: file });
        if (res && res.success && res.clip) {
          const idx = state.clips.findIndex((c) => c.id === clip.id);
          if (idx >= 0) state.clips[idx] = res.clip;
          state.currentClipId = clip.id;
          await renderEditor();
          renderClipList();
        }
      } catch (err) {
        console.error("[SnipBoard] delete-screenshot failed:", err);
      }
    };
    screenshotBox.appendChild(img);

    const editBtn = document.createElement("button");
    editBtn.className = "screenshot-edit-btn";
    editBtn.textContent = "Edit";
    editBtn.onclick = () => openScreenshotEditor(`${baseUrl}/${file}`, file, clip);
    screenshotBox.appendChild(editBtn);
  }
}

// ===============================================================
// RENDERING
// ===============================================================

function renderSections() {
  syncSectionsFromTabs();
  renderSectionsBar();
}

function renderTabs() {
  renderSectionsBar();
  if (!sectionTabs) return;
  const tabsFromState = (window.tabsState && Array.isArray(window.tabsState.tabs)) ? window.tabsState.tabs : state.tabs;
  const tabMap = new Map((tabsFromState || []).map((t) => [t.id, t]));
  sectionTabs.querySelectorAll(".section-pill").forEach((pill) => {
    const tabId = pill.dataset.sectionId;
    if (!tabId) return;
    const tab = tabMap.get(tabId);
    if (!tab) return;
    if (tab.color) {
      pill.style.backgroundColor = tab.color;
      pill.style.borderColor = tab.color;
      pill.style.color = "#000";
      pill.classList.add("section-pill--colored");
    }
    let iconSpan = pill.querySelector(".section-pill__icon");
    if (iconSpan) iconSpan.remove();
    const content = pill.querySelector(".section-pill__content");
    if (content && tab.icon) {
      const choice = findIconChoice(tab.icon);
      iconSpan = createIconGlyph(choice, tab.icon);
      content.insertBefore(iconSpan, content.firstChild);
    }
  });
}

function renderSectionsBar() {
  if (!sectionTabs) return;
  if (!state.activeTabId) state.activeTabId = "all";
  const hasCurrentSection =
    state.activeTabId === "all" ||
    state.tabs.some((s) => s && s.id === state.activeTabId);
  if (!hasCurrentSection) {
    state.activeTabId = state.tabs[0]?.id || "all";
    state.currentSectionId = state.activeTabId;
  }

  sectionTabs.innerHTML = "";

  const allTab = document.createElement("div");
  allTab.className = "section-pill";
  allTab.textContent = "All";
  allTab.dataset.sectionId = "all";
  if (state.activeTabId === "all") allTab.classList.add("section-pill--active");
  allTab.onclick = () => setCurrentSection("all");
  allTab.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  sectionTabs.appendChild(allTab);

  state.tabs.forEach((section) => {
    if (!section || !section.id) return;
    const locked = !!section.locked;
    const tabEl = document.createElement("div");
    tabEl.dataset.sectionId = section.id;
    tabEl.className = "section-pill";
    if (section.id === state.activeTabId) tabEl.classList.add("section-pill--active");
    if (locked) tabEl.classList.add("section-pill--locked");
    if (dragHoverSectionId === section.id) tabEl.classList.add("section-pill--dragover");
    tabEl.title = section.exportFolder || section.exportPath || "";
    if (section.color) {
      tabEl.style.backgroundColor = section.color;
      tabEl.style.borderColor = section.color;
      tabEl.style.color = "#000";
      tabEl.classList.add("section-pill--colored");
    }
    tabEl.setAttribute("draggable", "true");

    const pillContent = document.createElement("div");
    pillContent.className = "section-pill__content";

    if (section.icon) {
      const glyph = createIconGlyph(findIconChoice(section.icon), section.icon);
      pillContent.appendChild(glyph);
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = section.label || sectionLabel(section.id);
    pillContent.appendChild(nameSpan);

    tabEl.appendChild(pillContent);

    const lockIcon = document.createElement("span");
    lockIcon.className = "section-pill__lock";
    lockIcon.textContent = locked ? "\uD83D\uDD12" : "\uD83D\uDD13";
    lockIcon.title = locked ? "Unlock section" : "Lock section";
    lockIcon.onclick = async (e) => {
      e.stopPropagation();
      const newState = !locked;
      await updateSection(section.id, { locked: newState });
      section.locked = newState;
      updateDeleteButtonsLockState();
      renderLockButtonState();
      window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
      await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
      renderSectionsBar();
      scheduleSaveTabsConfig();
    };
    pillContent.appendChild(lockIcon);

    tabEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTabContextMenu(section.id, e.pageX, e.pageY);
    });
    tabEl.onclick = () => setCurrentSection(section.id);
    tabEl.ondblclick = async () => {
      startInlineRename(section.id);
    };

    tabEl.addEventListener("dragstart", (e) => {
      startTabReorder(section.id);
      dragHoverSectionId = section.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", section.id);
    });
    tabEl.addEventListener("dragenter", (e) => {
      if (draggingClipId) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      dragHoverSectionId = section.id;
      tabEl.classList.add("section-pill--dragover");
    });
    tabEl.addEventListener("dragover", (e) => {
      if (draggingClipId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    tabEl.addEventListener("dragleave", () => {
      tabEl.classList.remove("section-pill--dragover");
    });
    tabEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      tabEl.classList.remove("section-pill--dragover");
      if (draggingClipId) {
        await moveClipToTab(draggingClipId, section.id);
        draggingClipId = null;
        return;
      }
      finishTabReorder(section.id);
    });
    tabEl.addEventListener("dragend", () => {
      dragHoverSectionId = null;
      renderSectionsBar();
    });

    sectionTabs.appendChild(tabEl);
  });

  const addTab = document.createElement("div");
  addTab.id = "addTabButton";
  addTab.className = "add-tab";
  addTab.textContent = "+ Add Tab";
  addTab.onclick = handleCreateTab;
  sectionTabs.appendChild(addTab);

  const activePill = sectionTabs.querySelector(".section-pill--active");
  if (activePill && typeof activePill.scrollIntoView === "function") {
    activePill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
  updateSidebarHeader();
}

function startTabReorder(sectionId) {
  draggingSectionId = sectionId;
}

async function finishTabReorder(targetSectionId) {
  const sourceId = draggingSectionId;
  draggingSectionId = null;
  const fromIndex = state.sections.findIndex((s) => s.id === sourceId);
  if (!sourceId || fromIndex === -1 || sourceId === targetSectionId) {
    renderSectionsBar();
    return;
  }

  const toIndex = targetSectionId
    ? state.sections.findIndex((s) => s.id === targetSectionId)
    : state.sections.length - 1;

  const [moved] = state.sections.splice(fromIndex, 1);
  if (toIndex >= 0) {
    state.sections.splice(toIndex, 0, moved);
  } else {
    state.sections.push(moved);
  }
  const [movedTab] = state.tabs.splice(fromIndex, 1);
  if (toIndex >= 0) state.tabs.splice(toIndex, 0, movedTab);
  state.tabs.forEach((t, idx) => (t.order = idx));

  try {
    await window.api.invoke("save-section-order", state.sections.map((s) => ({ id: s.id, name: s.name })));
  } catch (err) {
    console.error("[SnipBoard] saveSectionOrder failed:", err);
  }

  renderSectionsBar();
  syncSectionsFromTabs();
  scheduleSaveTabsConfig();
}

function closeTabContextMenu() {
  if (!tabContextMenu) return;
  tabContextMenu.style.display = "none";
}

function openTabContextMenu(sectionId, x, y) {
  const menu = document.getElementById("tabContextMenu");
  if (!menu) return;
  menu.dataset.sectionId = sectionId;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = "block";
}

function openSchemaConfigurator(sectionId) {
  const tab = state.tabs.find((t) => t.id === sectionId);
  if (!tab) return;
  const schemaSet = new Set(Array.isArray(tab.schema) && tab.schema.length ? tab.schema : DEFAULT_SCHEMA);
  const existing = document.getElementById("schemaConfigOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "schemaConfigOverlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.background = "rgba(0,0,0,0.35)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "99999";

  const panel = document.createElement("div");
  panel.className = "configure-fields-modal";
  panel.style.background = "#fff";
  panel.style.padding = "18px";
  panel.style.borderRadius = "10px";
  panel.style.minWidth = "300px";
  panel.style.maxWidth = "420px";
  panel.style.boxShadow = "0 8px 20px rgba(0,0,0,0.25)";

  const header = document.createElement("div");
  header.textContent = "Configure Fields";
  header.style.fontWeight = "700";
  header.style.marginBottom = "12px";
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "configure-fields-body";

  const table = document.createElement("div");
  table.className = "configure-fields-table";

  FIELD_OPTIONS.forEach((field) => {
    const row = document.createElement("div");
    row.className = "configure-fields-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = schemaSet.has(field);
    cb.onchange = async () => {
      if (cb.checked) schemaSet.add(field);
      else schemaSet.delete(field);
      if (!schemaSet.size) {
        schemaSet.add(field);
        cb.checked = true;
      }
      tab.schema = Array.from(schemaSet);
      window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
      await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
      applySchemaVisibility(tab.schema);
      renderEditor();
    };

    const text = document.createElement("span");
    text.textContent = field;
    row.appendChild(cb);
    row.appendChild(text);
    table.appendChild(row);
  });

  body.appendChild(table);
  panel.appendChild(body);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.marginTop = "10px";
  closeBtn.onclick = () => overlay.remove();
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

document.addEventListener("click", (evt) => {
  const menu = document.getElementById("tabContextMenu");
  if (menu) menu.style.display = "none";
  const target = evt.target;
  const insideTools =
    target &&
    (sortMenu?.contains(target) ||
      filterMenu?.contains(target) ||
      sortToggleBtn?.contains(target) ||
      filterToggleBtn?.contains(target) ||
      topbarTools?.contains(target));
  if (!insideTools) closeQuickMenus();
});
document.addEventListener("contextmenu", (e) => {
  if (!tabContextMenu) return;
  const within = e.target && tabContextMenu.contains(e.target);
  if (within) e.stopPropagation();
});

function getRenameFocusables() {
  return [renameInput, renameCancelBtn, renameSaveBtn].filter(Boolean);
}

function trapFocusRenameModal(e) {
  if (!renameModal || !renameModal.classList.contains("is-open")) return;
  if (e.key !== "Tab") return;
  const focusables = getRenameFocusables();
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function closeRenameModal() {
  state.pendingRenameSectionId = null;
  state.renameDraft = "";
  if (renameModal) renameModal.classList.remove("is-open");
}

function openRenameModal(sectionId) {
  const sec = state.tabs.find((s) => s.id === sectionId);
  if (!sec || sec.locked) return;
  closeQuickMenus();
  state.pendingRenameSectionId = sectionId;
  state.renameDraft = sec.label || sec.name || sectionLabel(sectionId);
  if (renameInput) {
    renameInput.value = state.renameDraft;
    setTimeout(() => {
      renameInput.focus();
      renameInput.select();
    }, 0);
  }
  if (renameModal) renameModal.classList.add("is-open");
}

function startInlineRename(sectionId) {
  openRenameModal(sectionId);
}

async function commitRename(sectionId, value) {
  if (!sectionId) {
    closeRenameModal();
    return;
  }
  const name = (value || "").trim();
  if (!name) {
    cancelRename();
    return;
  }
  await renameSection(sectionId, name);
  const tab = state.tabs.find((t) => t.id === sectionId);
  if (tab) {
    tab.label = name;
    tab.name = name;
  }
  const sec = state.sections.find((s) => s.id === sectionId);
  if (sec) sec.name = name;
  state.sections = tabsToSections(state.tabs);
  state.editingSectionId = null;
  state.pendingRenameSectionId = null;
  state.renameDraft = "";
  renderSectionsBar();
  updateSidebarHeader();
  scheduleSaveTabsConfig();
  window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
  await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
  closeRenameModal();
}

function cancelRename() {
  state.editingSectionId = null;
  closeRenameModal();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeRenameModal();
    if (colorModal && colorModal.classList.contains("is-open")) colorModal.classList.remove("is-open");
    if (iconModal && iconModal.classList.contains("is-open")) iconModal.classList.remove("is-open");
    closeQuickMenus();
    cancelRename();
  }
});
document.addEventListener("keydown", trapFocusRenameModal, true);

async function toggleLockSection(sectionId) {
  const sec = state.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  const next = !sec.locked;
  await updateSection(sectionId, { locked: next });
  sec.locked = next;
  const tab = state.tabs.find((t) => t.id === sectionId);
  if (tab) tab.locked = next;
  renderSectionsBar();
  updateDeleteButtonsLockState();
  renderLockButtonState();
  scheduleSaveTabsConfig();
}

async function deleteSection(sectionId) {
  const sec = state.sections.find((s) => s.id === sectionId);
  if (protectedSections.has(sectionId) || (sec && sec.locked)) return;
  const confirmDelete = window.confirm("Delete this section and its clips?");
  if (!confirmDelete) return;
  await window.api.invoke("delete-section", sectionId);
  state.tabs = state.tabs.filter((t) => t.id !== sectionId);
  syncSectionsFromTabs();
  if (state.currentSectionId === sectionId) state.currentSectionId = "all";
  state.activeTabId = state.currentSectionId;
  renderSectionsBar();
  renderClipList();
  updateExportPathDisplay();
  scheduleSaveTabsConfig();
}

const tabContextMenuEl = document.getElementById("tabContextMenu");
if (tabContextMenuEl) {
  tabContextMenuEl.addEventListener("click", async (e) => {
    const action = e.target && e.target.dataset ? e.target.dataset.action : null;
    if (!action) return;
    const sectionId = tabContextMenuEl.dataset.sectionId;
    switch (action) {
      case "rename":
        startInlineRename(sectionId);
        break;
      case "color":
        await selectTabColor(sectionId);
        break;
      case "schema":
        openSchemaConfigurator(sectionId);
        break;
      case "icon":
        await selectTabIcon(sectionId);
        break;
      case "folder":
        await assignExportFolder(sectionId);
        break;
      case "lock":
        await toggleLockSection(sectionId);
        break;
      case "delete":
        await deleteSection(sectionId);
        break;
      default:
        break;
    }
    tabContextMenuEl.style.display = "none";
  });
}

if (colorSaveBtn) {
  colorSaveBtn.onclick = async () => {
    const targetId = state.pendingColorSection;
    if (!targetId) {
      if (colorModal) colorModal.classList.remove("is-open");
      return;
    }
    const color = state.selectedColor || "";
    await updateSection(targetId, { color });
    const sec = state.sections.find((s) => s.id === targetId);
    if (sec) sec.color = color;
    const tab = state.tabs.find((t) => t.id === targetId);
    if (tab) tab.color = color;
    const targetTab = window.tabsState?.tabs?.find((t) => t.id === targetId);
    if (targetTab) targetTab.color = color;
    window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
    await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
    renderTabs();
    if (colorModal) colorModal.classList.remove("is-open");
    state.pendingColorSection = null;
    renderSectionsBar();
    scheduleSaveTabsConfig();
  };
}
if (colorCancelBtn) {
  colorCancelBtn.onclick = () => {
    state.pendingColorSection = null;
    if (colorModal) colorModal.classList.remove("is-open");
  };
}

if (iconSaveBtn) {
  iconSaveBtn.onclick = async () => {
    const targetId = state.pendingIconSection;
    if (!targetId) {
      if (iconModal) iconModal.classList.remove("is-open");
      return;
    }
  await updateSection(targetId, { icon: state.selectedIcon || "" });
  const sec = state.sections.find((s) => s.id === targetId);
  if (sec) sec.icon = state.selectedIcon || "";
  const tab = state.tabs.find((t) => t.id === targetId);
  if (tab) tab.icon = state.selectedIcon || "";
  const targetTab = window.tabsState?.tabs?.find((t) => t.id === targetId);
  if (targetTab) targetTab.icon = state.selectedIcon || "";
  if (iconModal) iconModal.classList.remove("is-open");
  state.pendingIconSection = null;
  renderSectionsBar();
  window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
  await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
  renderTabs();
  scheduleSaveTabsConfig();
};
}
if (iconCancelBtn) {
  iconCancelBtn.onclick = () => {
    state.pendingIconSection = null;
    if (iconModal) iconModal.classList.remove("is-open");
  };
}


function getSelectedClipIds() {
  const checkboxes = document.querySelectorAll(".clip-row input[type=checkbox]");
  const ids = [];
  checkboxes.forEach((cb) => {
    if (cb.checked && cb.dataset.clipId) ids.push(cb.dataset.clipId);
  });
  return ids;
}

async function unifiedDelete(ids) {
  const activeTab = window.tabsState?.tabs?.find(t => t.id === state.currentSectionId);
  if (activeTab?.locked) {
    console.warn("Tab is locked. Delete blocked.");
    return; 
  }
  const locked = isSectionLocked(state.currentSectionId);
  if (locked) {
    alert("This section is locked.");
    return;
  }

  const targets =
    Array.isArray(ids) && ids.length
      ? ids
      : state.currentClipId
      ? [state.currentClipId]
      : [];
  if (!targets.length) return;

  const confirmMsg =
    targets.length === 1 ? "Delete this clip?" : `Delete ${targets.length} selected clips?`;
  if (!window.confirm(confirmMsg)) return;

  const res = await window.api.invoke(IPC.DELETE_CLIPS, targets);

  if (res && (res.blocked === true || (Array.isArray(res.blocked) && res.blocked.length))) {
    alert("Unlock section first.");
    return;
  }

  const data = await window.api.invoke(IPC.GET_DATA);
  state.sections = normalizeSections(data.sections || []);
  state.clips = data.clips || [];
  updateSearchIndex(state.clips);
  if (targets.includes(state.currentClipId)) {
    state.currentClipId = null;
  }
  renderSections();
  renderClipList();
  await renderEditor();
  updateExportPathDisplay();
  updateDeleteButtonsLockState();
  renderLockButtonState();
}

function sortClipsForView(clips) {
  const list = Array.isArray(clips) ? [...clips] : [];
  switch (state.sortMode) {
    case "newest":
      return list.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    case "oldest":
      return list.sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
    case "title":
      return list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    default:
      return list;
  }
}

function renderClipList() {
  const clipList = document.getElementById("clipList");
  if (!clipList) return;
  clipList.innerHTML = "";

  const searchTerm = (state.searchText || "").toLowerCase();
  const tagTerm = (state.tagFilter || "").toLowerCase();

  const filtered = state.clips.filter((clip) => {
    if (state.currentSectionId !== "all" && clip.sectionId !== state.currentSectionId) {
      return false;
    }
    if (searchTerm) {
      const idx = searchIndex.get(clip.id) || `${clip.title || ""} ${clip.text || ""} ${(clip.tags || []).join(" ")}`.toLowerCase();
      if (!idx.includes(searchTerm)) return false;
    }
    if (tagTerm) {
      const tags = tagTerm.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tags.length && !tags.every((t) => (clip.tags || []).some((ct) => (ct || "").toLowerCase().includes(t)))) {
        return false;
      }
    }
    return true;
  });

  const sorted = sortClipsForView(filtered);

  sorted.forEach((clip) => {
    const row = document.createElement("div");
    row.className = "clip-row";
    if (clip.id === state.currentClipId) row.classList.add("clip-row--active");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.clipId = clip.id;
    checkbox.addEventListener("click", (ev) => ev.stopPropagation());

    const thumb = document.createElement("div");
    thumb.className = "clip-row__thumb";
    if (Array.isArray(clip.screenshots) && clip.screenshots.length) {
      const firstShot = clip.screenshots[0];
      window.api.invoke("check-screenshot-path", firstShot).then((res) => {
        if (!res || !res.ok || !res.exists) return;
        const img = document.createElement("img");
        img.src = "file:///" + res.fullPath.replace(/\\/g, "/");
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.borderRadius = "8px";
        thumb.innerHTML = "";
        thumb.appendChild(img);
      }).catch(() => {});
    }

    const title = document.createElement("div");
    title.className = "clip-row__title";
    title.textContent = clip.title || "(untitled)";

    row.appendChild(checkbox);
    row.appendChild(thumb);
    row.appendChild(title);
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      draggingClipId = clip.id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", clip.id);
      }
    });
    row.addEventListener("dragend", () => {
      draggingClipId = null;
    });

    row.addEventListener("click", () => {
      state.currentClipId = clip.id;
      renderClipList();
      renderEditor();
    });

    row.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      state.currentClipId = clip.id;
      renderClipList();
      renderEditor();
      const confirmDelete = window.confirm("Delete this clip?");
      if (confirmDelete) {
        await unifiedDelete([clip.id]);
      }
    });

    clipList.appendChild(row);
  });
}

async function moveClipToTab(clipId, targetTabId) {
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return;
  clip.sectionId = targetTabId;
  state.currentSectionId = targetTabId;
  state.activeTabId = targetTabId;
  const saved = await window.api.invoke(IPC.SAVE_CLIP, clip);
  await refreshData(saved?.id || clip.id);
  window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
  await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
  renderSectionsBar();
}

async function renderEditor() {
  const clip = getCurrentClip();
  const activeTab = getActiveTab();
  const schema = activeTab && Array.isArray(activeTab.schema) && activeTab.schema.length ? activeTab.schema : DEFAULT_SCHEMA;
  applySchemaVisibility(schema);

  if (!clip) {
    textInput.value = "";
    titleInput.value = "";
    notesInput.value = "";
    tagsInput.value = "";
    screenshotBox.innerHTML = "";
    sectionSelect.innerHTML = "";
    sourceUrlInput.value = "";
    sourceTitleInput.value = "";
    capturedAtInput.value = "";
    openSourceBtn.disabled = true;
    return;
  }

  textInput.value = clip.text || "";
  titleInput.value = clip.title || "";
  notesInput.value = clip.notes || "";
  tagsInput.value = (clip.tags || []).join(", ");
  sourceUrlInput.value = clip.sourceUrl || "";
  sourceTitleInput.value = clip.sourceTitle || "";
  capturedAtInput.value = formatDateTime(clip.capturedAt);
  openSourceBtn.disabled = !clip.sourceUrl;

  await renderScreenshots(clip);

  sectionSelect.innerHTML = "";
  state.sections.forEach(sec => {
    const opt = document.createElement("option");
    opt.value = sec.id;
    opt.textContent = sec.name;
    if (sec.id === clip.sectionId) opt.selected = true;
    sectionSelect.appendChild(opt);
  });
  sectionSelect.disabled = false;
  textInput.disabled = false;
  titleInput.disabled = false;
  notesInput.disabled = false;
  tagsInput.disabled = false;
  sourceUrlInput.disabled = false;
  sourceTitleInput.disabled = false;
}

// ===============================================================
// EVENT HANDLERS
// ===============================================================

async function handleCreateTab() {
  const baseName = "New Tab";
  const newSection = await window.api.invoke(IPC.CREATE_SECTION, baseName);
  const exportPath = canonicalExportPath(newSection.name || baseName);
  const normalized = {
    id: newSection.id,
    name: newSection.name || baseName,
    locked: !!newSection.locked,
    exportFolder: normalizeExportPath(newSection.exportFolder || newSection.exportPath || "", newSection.name || baseName) || exportPath,
    exportPath: normalizeExportPath(newSection.exportPath || newSection.exportFolder || "", newSection.name || baseName) || exportPath,
    color: newSection.color || "",
    icon: newSection.icon || "",
    order: (state.tabs[state.tabs.length - 1]?.order || state.tabs.length) + 1,
    schema: DEFAULT_SCHEMA.slice(),
  };
  state.tabs.push(normalized);
  window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
  await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
  syncSectionsFromTabs();
  state.currentSectionId = normalized.id;
  state.activeTabId = normalized.id;
  renderSectionsBar();
  renderClipList();
  updateExportPathDisplay();
  updateDeleteButtonsLockState();
  renderLockButtonState();
  scheduleSaveTabsConfig();
  await syncTabsToBackend();
}

async function assignExportFolder(sectionId) {
  const result = await window.api.invoke(IPC.CHOOSE_EXPORT_FOLDER);
  const folder = result && result.ok === false ? null : (result && result.path) || result;
  if (!folder) return;
  await updateSection(sectionId, { exportFolder: folder, exportPath: folder });
  const sec = state.sections.find((s) => s.id === sectionId);
  if (sec) {
    sec.exportFolder = folder;
    sec.exportPath = folder;
  }
  const stateTab = state.tabs.find((t) => t.id === sectionId);
  if (stateTab) stateTab.exportFolder = folder;
  const tabId = sectionId;
  const selectedPath = folder;
  const targetTab = (window.tabsState && window.tabsState.tabs) ? window.tabsState.tabs.find(t => t.id === tabId) : null;
  if (targetTab) {
    targetTab.exportPath = selectedPath;
  }
  window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
  await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
  renderSectionsBar();
  updateExportPathDisplay();
  scheduleSaveTabsConfig();
}

async function selectTabColor(sectionId) {
  const sec = state.sections.find((s) => s.id === sectionId);
  if (!sec || !colorModal || !colorSwatches) return;
  state.pendingColorSection = sectionId;
  const startColor = sec.color || "";
  state.selectedColor = startColor;
  const paletteSelection = SNIPBOARD_COLORS.includes(startColor) ? startColor : "";
  renderColorPalette(
    colorSwatches,
    paletteSelection,
    (color) => {
      state.selectedColor = color || "";
    },
    true
  );
  colorModal.classList.add("is-open");
}

async function selectTabIcon(sectionId) {
  const sec = state.sections.find((s) => s.id === sectionId);
  if (!sec || !iconModal || !iconChoicesContainer) return;
  iconChoicesContainer.classList.add("icon-grid");
  state.pendingIconSection = sectionId;
  state.selectedIcon = sec.icon || "";
  iconChoicesContainer.innerHTML = "";
  iconChoices.forEach((choice) => {
    const item = document.createElement("button");
    item.type = "button";
    const isSelected = state.selectedIcon === choice.id || state.selectedIcon === choice.emoji || state.selectedIcon === choice.icon;
    item.className = "icon-choice icon-choice-btn" + (isSelected ? " selected" : "");
    item.dataset.icon = choice.id || choice.emoji || choice.icon || "";
    const glyph = document.createElement("span");
    glyph.className = "icon-choice__glyph";
    if (choice.svg) glyph.innerHTML = choice.svg;
    else glyph.textContent = choice.emoji || choice.icon || "";
    item.appendChild(glyph);
    item.setAttribute("aria-label", choice.label || choice.id || "icon");
    item.onclick = () => {
      state.selectedIcon = choice.id || choice.emoji || choice.icon || "";
      iconChoicesContainer.querySelectorAll(".icon-choice").forEach((c) => c.classList.remove("selected"));
      item.classList.add("selected");
    };
    iconChoicesContainer.appendChild(item);
  });
  iconModal.classList.add("is-open");
}

async function refreshData(selectId = null) {
  const data = await window.api.invoke(IPC.GET_DATA);
  state.clips = data.clips || [];
  updateSearchIndex(state.clips);
  syncLockedSectionsFromState();
  if (selectId) {
    state.currentClipId = selectId;
    state.selectedClipIds = new Set([selectId]);
  }
  pruneSelected();
  renderSections();
  renderClipList();
  await renderEditor();
  updateExportPathDisplay();
  updateDeleteButtonsLockState();
}

function currentSectionIdOrInbox() {
  if (state.currentSectionId && state.currentSectionId !== "all") return state.currentSectionId;
  return "inbox";
}

function bindHandlersOnce() {
  if (handlersBound) return;
  handlersBound = true;
  if (setExportBtn) setExportBtn.style.display = "none";
  if (clearExportBtn) clearExportBtn.style.display = "none";
  const exportActions = document.querySelector(".export-actions");
  if (exportActions) exportActions.style.display = "none";

  if (saveClipBtn) {
    saveClipBtn.onclick = async () => {
      const clip = getCurrentClip();
      if (!clip) return;

      clip.text = textInput.value;
      clip.title = titleInput.value;
      clip.notes = notesInput.value;
      clip.tags = tagsInput.value.split(",").map(s => s.trim()).filter(Boolean);
      clip.sectionId = sectionSelect.value || null;
      clip.sourceUrl = sourceUrlInput.value;
      clip.sourceTitle = sourceTitleInput.value;

      state.currentSectionId = clip.sectionId || "all";
      const saved = await window.api.invoke(IPC.SAVE_CLIP, clip);
      await refreshData(saved.id);
    };
  }

  if (newClipBtn) newClipBtn.onclick = createClipboardClip;
  if (newSnipBtn) newSnipBtn.onclick = createScreenSnip;
  if (addShotBtn) addShotBtn.onclick = addScreenshotToCurrent;
  if (deleteClipBtn) deleteClipBtn.onclick = async () => { await unifiedDelete(getSelectedClipIds()); };
  if (deleteSelectedBtn) deleteSelectedBtn.onclick = async () => { await unifiedDelete(getSelectedClipIds()); };
  if (listDeleteBtn) listDeleteBtn.onclick = async () => { await unifiedDelete(getSelectedClipIds()); };
  if (listAddBtn) listAddBtn.onclick = createClipboardClip;

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.searchText = searchInput.value || "";
      renderClipList();
    });
  }
  if (sortToggleBtn) {
    sortToggleBtn.onclick = () => toggleQuickMenu(sortMenu);
  }
  if (filterToggleBtn) {
    filterToggleBtn.onclick = () => toggleQuickMenu(filterMenu);
  }
  if (tagFilterInput) {
    tagFilterInput.addEventListener("input", () => {
      applyTagFilterValue(tagFilterInput.value);
    });
    tagFilterInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        applyTagFilterValue(tagFilterInput.value);
        closeQuickMenus();
      }
    });
  }
  if (filterApplyBtn) {
    filterApplyBtn.onclick = () => {
      applyTagFilterValue(tagFilterInput ? tagFilterInput.value : "");
      closeQuickMenus();
    };
  }
  if (filterClearBtn) {
    filterClearBtn.onclick = () => {
      applyTagFilterValue("");
      closeQuickMenus();
    };
  }
  if (sortMenu) {
    sortMenu.querySelectorAll("input[name='sortMode']").forEach((radio) => {
      radio.addEventListener("change", () => {
        state.sortMode = radio.value || "default";
        renderClipList();
        closeQuickMenus();
      });
    });
  }

  if (openSourceBtn) {
    openSourceBtn.onclick = () => {
      const clip = getCurrentClip();
      if (!clip || !clip.sourceUrl) return;
      window.api.invoke(IPC.OPEN_URL, clip.sourceUrl);
    };
  }

  const handleRenameSave = async () => {
    if (!state.pendingRenameSectionId) {
      closeRenameModal();
      return;
    }
    await commitRename(state.pendingRenameSectionId, renameInput ? renameInput.value : "");
  };

  if (renameSaveBtn) renameSaveBtn.onclick = handleRenameSave;
  if (renameCancelBtn) renameCancelBtn.onclick = closeRenameModal;
  if (renameInput) {
    renameInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        await handleRenameSave();
      } else if (e.key === "Escape") {
        closeRenameModal();
      }
    });
  }
  if (renameModal) {
    renameModal.addEventListener("click", (e) => {
      if (e.target === renameModal) closeRenameModal();
    });
  }

  if (setExportBtn) setExportBtn.onclick = null;
  if (clearExportBtn) clearExportBtn.onclick = null;
}
async function createClipboardClip() {
  const text = await window.api.invoke("get-clipboard-text");
  const fallbackTitle = "Clipboard Snip";
  const clip = {
    id: null,
    title: (text || "").split("\n")[0].slice(0, 80) || fallbackTitle,
    text: text || "",
    notes: "",
    tags: [],
    screenshots: [],
    sectionId: currentSectionIdOrInbox(),
    capturedAt: Date.now(),
  };
  state.currentSectionId = clip.sectionId;
  const saved = await window.api.invoke(IPC.SAVE_CLIP, clip);
  await refreshData(saved.id);
}

async function createScreenSnip() {
  try {
    const capture = await window.api.invoke(IPC.CAPTURE_SCREEN);
    if (!capture || !capture.success) {
      console.warn("[SnipBoard] captureScreen failed or returned empty payload", capture);
      return;
    }
    const filenames = Array.isArray(capture.screenshots)
      ? capture.screenshots.map((s) => s.filename)
      : [];
    if (Array.isArray(capture.screenshots)) {
      capture.screenshots.forEach((shot) => {
        // Optionally display previews using shot.dataUrl
        // e.g., add to UI if needed
      });
    }
    const clip = {
      id: null,
      title: "Screen Snip",
      text: "",
      notes: "",
      tags: [],
      screenshots: filenames,
      sectionId: currentSectionIdOrInbox(),
      capturedAt: Date.now(),
    };
  state.currentSectionId = clip.sectionId;
  const saved = await window.api.invoke(IPC.SAVE_CLIP, clip);
  await refreshData(saved.id);
  } catch (err) {
    console.error("[SnipBoard] createScreenSnip failed:", err);
  }
}

async function addScreenshotToCurrent() {
  const clip = getCurrentClip();
  if (!clip) return;
  try {
    const capture = await window.api.invoke(IPC.CAPTURE_SCREEN);
    if (!capture || !capture.success) {
      console.warn("[SnipBoard] captureScreen failed or returned empty payload", capture);
      return;
    }
    const filenames = Array.isArray(capture.screenshots)
      ? capture.screenshots.map((s) => s.filename)
      : [];
    if (Array.isArray(capture.screenshots)) {
      capture.screenshots.forEach((shot) => {
        // Optionally display previews using shot.dataUrl
      });
    }
    clip.screenshots = [...(clip.screenshots || []), ...filenames];
    const saved = await window.api.invoke(IPC.SAVE_CLIP, clip);
    await refreshData(saved.id);
  } catch (err) {
    console.error("[SnipBoard] addScreenshotToCurrent failed:", err);
  }
}

// ===============================================================
// INITIAL LOAD
// ===============================================================

async function init() {
  try {
    const data = await window.api.invoke(IPC.GET_DATA);
    const tabsConfig = await window.api.invoke(IPC.LOAD_TABS);
    const tabsFromConfig = normalizeTabs(tabsConfig?.tabs);
    const fallbackTabs = normalizeTabs(sectionsToTabs(data.sections || []));
    state.tabs = tabsFromConfig.length ? tabsFromConfig : fallbackTabs;
    state.sections = tabsToSections(state.tabs);
    state.activeTabId = tabsConfig?.activeTabId || state.tabs[0]?.id || "all";
    state.currentSectionId = state.activeTabId;
    state.clips = data.clips || [];
    updateSearchIndex(state.clips);
    syncLockedSectionsFromState();
    lastPollSignature = computeSignature(state.clips);
    state.searchText = searchInput ? searchInput.value || "" : "";
    state.tagFilter = tagFilterInput ? tagFilterInput.value || "" : "";
    const checkedSort = sortMenu ? sortMenu.querySelector("input[name='sortMode']:checked") : null;
    state.sortMode = checkedSort ? (checkedSort.value || "default") : "default";

    renderSectionsBar();
    window.tabsState = {
      tabs: state.tabs,
      activeTabId: state.activeTabId || "all",
    };
    renderTabs();
    renderClipList();
    await renderEditor();
    updateExportPathDisplay();
    updateDeleteButtonsLockState();
    renderLockButtonState();
    updateSidebarHeader();
    bindHandlersOnce();
    await syncTabsToBackend();
  } catch (err) {
    console.error("[SnipBoard] init failed:", err);
  }

  setInterval(async () => {
    try {
      const data = await window.api.invoke(IPC.GET_DATA);
      const sig = computeSignature(data.clips || []);

      if (sig !== lastPollSignature) {
        state.clips = data.clips || [];
        updateSearchIndex(state.clips);
        syncLockedSectionsFromState();
        lastPollSignature = sig;
        pruneSelected();
        renderSectionsBar();
        renderClipList();
        await renderEditor();
        updateExportPathDisplay();
        updateDeleteButtonsLockState();
        renderLockButtonState();
      }
    } catch (err) {
      console.warn("Backend poll failed:", err);
    }
  }, 3000);
}

document.addEventListener("DOMContentLoaded", init);
if (document.readyState !== "loading") {
  init();
}
document.addEventListener("DOMContentLoaded", () => {
  const shotModal = document.getElementById("screenshotModal");
  if (shotModal) {
    shotModal.addEventListener("click", (evt) => {
      if (evt.target === shotModal || evt.target.classList.contains("shot-modal-backdrop")) {
        closeScreenshotModal();
      }
    });
  }

  const tabsWrapper = sectionTabs && sectionTabs.parentElement;
  if (tabsWrapper && sectionTabs) {
    tabsWrapper.style.position = "relative";
    sectionTabs.style.overflowX = "auto";
    sectionTabs.style.whiteSpace = "nowrap";
  }
});








async function newSectionCreated(name) {
  const base = (name || "").trim();
  if (!base) return;
  try {
    const created = await window.api.invoke(IPC.CREATE_SECTION, base);
  if (created && created.id) {
    state.sections.push({
      id: created.id,
      name: created.name || base,
      locked: !!created.locked,
      exportPath: normalizeExportPath(created.exportPath || created.exportFolder || "", created.name || base) || canonicalExportPath(created.name || base),
      exportFolder: normalizeExportPath(created.exportFolder || created.exportPath || "", created.name || base) || canonicalExportPath(created.name || base),
      color: created.color || "",
      icon: created.icon || "",
    });
    state.currentSectionId = created.id;
  } else {
    const id = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
    const path = canonicalExportPath(id || base);
    state.sections.push({ id: id || base, name: base, locked: false, exportPath: path, exportFolder: path, color: "", icon: "" });
    state.currentSectionId = id || base;
  }
    renderSections();
    renderClipList();
  } catch (err) {
    console.error("[SnipBoard] newSectionCreated failed:", err);
  }
}

async function renameSection(id, newName) {
  const name = (newName || "").trim();
  if (!id || !name) return;
  try {
    const path = canonicalExportPath(name);
    const updated = await window.api.invoke(IPC.RENAME_SECTION, { id, name });
    if (updated && updated.section) {
      const idx = state.sections.findIndex((s) => s.id === id);
      if (idx >= 0) {
        state.sections[idx] = {
          ...updated.section,
          exportPath: normalizeExportPath(updated.section.exportPath || updated.section.exportFolder || path, name),
          exportFolder: normalizeExportPath(updated.section.exportFolder || updated.section.exportPath || path, name),
        };
      }
    } else {
      const target = state.sections.find((s) => s.id === id);
      if (target) {
        target.name = name;
        target.exportPath = normalizeExportPath(target.exportPath || target.exportFolder || path, name);
        target.exportFolder = normalizeExportPath(target.exportFolder || target.exportPath || path, name);
      }
    }
    const tab = state.tabs.find((t) => t.id === id);
    if (tab) {
      tab.label = name;
      tab.name = name;
      tab.exportFolder = normalizeExportPath(tab.exportFolder || tab.exportPath || path, name);
      tab.exportPath = normalizeExportPath(tab.exportPath || tab.exportFolder || path, name);
    }
    await window.api.invoke(IPC.SET_SECTION_EXPORT_PATH, { id, exportPath: path });
    state.sections = tabsToSections(state.tabs);
    scheduleSaveTabsConfig();
    renderSections();
    window.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
    await window.api.invoke(IPC.SAVE_TABS, window.tabsState);
  } catch (err) {
    console.error("[SnipBoard] renameSection failed:", err);
  }
}





function saveTabsState() {
  window.tabsState = {
    tabs: state.tabs.map((t, idx) => ({
      ...t,
      exportPath: t.exportPath || t.exportFolder || "",
      exportFolder: t.exportFolder || t.exportPath || "",
      order: Number.isFinite(t.order) ? t.order : idx,
    })),
    activeTabId: state.activeTabId || "all",
  };
  window.api.invoke(IPC.SAVE_TABS, window.tabsState);
}
