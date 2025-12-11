const { app, BrowserWindow, ipcMain, desktopCapturer, clipboard, shell, dialog, screen } = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs");

const BASE_DATA_DIR = path.join("C:\\Dev2\\SnipBoard", "data");
const DATA_DIR = BASE_DATA_DIR;
const CLIPS_FILE = path.join(DATA_DIR, "clips.json");
const SECTIONS_FILE = path.join(DATA_DIR, "sections.json");
const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");
const SECTION_DIR = path.join(DATA_DIR, "sections");
const TABS_FILE = path.join(DATA_DIR, "tabs.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const INVALID_FILENAME_CHARS = new RegExp("[\\\\/?%*:|\"<>]", "g");

function migrateDataFiles() {
  const oldDataDir = path.join(__dirname, "data");
  const oldTabsFile = path.join(app.getPath("userData"), "tabs.json");
  const targets = [
    { from: path.join(oldDataDir, "clips.json"), to: CLIPS_FILE },
    { from: path.join(oldDataDir, "sections.json"), to: SECTIONS_FILE },
    { from: path.join(oldDataDir, "tabs.json"), to: TABS_FILE },
    { from: oldTabsFile, to: TABS_FILE },
    { from: path.join(oldDataDir, "config.json"), to: CONFIG_FILE },
  ];

  ensureDir(BASE_DATA_DIR);
  ensureDir(SCREENSHOTS_DIR);
  ensureDir(SECTION_DIR);

  for (const entry of targets) {
    try {
      if (fs.existsSync(entry.from) && !fs.existsSync(entry.to)) {
        ensureDir(path.dirname(entry.to));
        fs.renameSync(entry.from, entry.to);
      }
    } catch (err) {
      console.warn("[SnipBoard] Migration move failed:", entry.from, err);
    }
  }

  const oldShotsDir = path.join(oldDataDir, "screenshots");
  if (fs.existsSync(oldShotsDir) && !fs.existsSync(SCREENSHOTS_DIR)) {
    try {
      fs.renameSync(oldShotsDir, SCREENSHOTS_DIR);
    } catch (err) {
      console.warn("[SnipBoard] Migration screenshots move failed:", err);
    }
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadTabsConfigFromDisk() {
  const fallback = { tabs: [], activeTabId: "inbox" };
  const data = readJson(TABS_FILE, fallback);
  if (Array.isArray(data)) return { tabs: data, activeTabId: "inbox" };
  const tabs = Array.isArray(data.tabs) ? data.tabs : [];
  const activeTabId = typeof data.activeTabId === "string" ? data.activeTabId : "inbox";
  return { tabs, activeTabId };
}

function saveTabsConfigToDisk(config) {
  const tabs = Array.isArray(config?.tabs) ? config.tabs : [];
  const activeTabId = typeof config?.activeTabId === "string" ? config.activeTabId : "inbox";
  writeJson(TABS_FILE, { tabs, activeTabId });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[SnipBoard] Failed to read JSON", file, err);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[SnipBoard] Failed to write JSON", file, err);
  }
}

function loadData() {
  ensureDir(DATA_DIR);
  ensureDir(SCREENSHOTS_DIR);
  ensureDir(SECTION_DIR);
  migrateDataFiles();

  const defaultSections = [
    { id: "inbox", name: "Inbox", locked: false, exportPath: "", folder: path.join(SECTION_DIR, "inbox") },
    { id: "common-prompts", name: "Common Prompts", locked: false, exportPath: "", folder: path.join(SECTION_DIR, "common-prompts") },
    { id: "black-skies", name: "Black Skies", locked: false, exportPath: "", folder: path.join(SECTION_DIR, "black-skies") },
    { id: "errors", name: "Errors", locked: false, exportPath: "", folder: path.join(SECTION_DIR, "errors") },
    { id: "misc", name: "Misc", locked: false, exportPath: "", folder: path.join(SECTION_DIR, "misc") },
  ];

  const sectionsRaw = readJson(SECTIONS_FILE, defaultSections);
  const sections = Array.isArray(sectionsRaw)
    ? sectionsRaw.map((s) => ({
        ...s,
        locked: Boolean(s && s.locked),
        exportPath: typeof s?.exportPath === "string" ? s.exportPath : "",
        folder:
          typeof s?.folder === "string"
            ? s.folder
            : path.join(SECTION_DIR, s.id || "section"),
      }))
    : defaultSections;
  const clips = readJson(CLIPS_FILE, []);
  return { sections, clips };
}

function saveSections(sections) {
  writeJson(SECTIONS_FILE, sections);
}

function saveClips(clips) {
  writeJson(CLIPS_FILE, clips);
}

function slugifyTitle(name) {
  const base = (name || "").toString().toLowerCase().trim();
  const spaced = base.replace(/\s+/g, "-");
  const cleaned = spaced.replace(/[^a-z0-9-]/g, "-");
  const collapsed = cleaned.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed || "";
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(INVALID_FILENAME_CHARS, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function getExportDirForSection(sectionId, sections) {
  const section = Array.isArray(sections) ? sections.find((s) => s.id === sectionId) : null;
  if (section && section.exportPath) return section.exportPath;
  return null;
}

function resolveClipFilename(clip, sections, previousFilename) {
  const baseSlug = slugifyTitle(clip?.title || "");
  const base = baseSlug || clip?.id || "clip";
  const exportDir = getExportDirForSection(clip?.sectionId, sections);
  const defaultName = `${base}.json`;
  if (!exportDir) {
    return { filename: defaultName, filePath: null, exportDir: null };
  }
  ensureDir(exportDir);
  let candidate = defaultName;
  let counter = 2;
  while (fs.existsSync(path.join(exportDir, candidate)) && candidate !== previousFilename) {
    candidate = `${base}-${counter}.json`;
    counter += 1;
  }
  return { filename: candidate, filePath: path.join(exportDir, candidate), exportDir };
}

async function mirrorClipToExport(clip, sections) {
  try {
    if (!clip || !clip.sectionId) return;
    const exportInfo = resolveClipFilename(clip, sections, clip.exportFilename);
    if (!exportInfo || !exportInfo.filePath) {
      console.log(`[SnipBoard] Export folder not set for section "${clip.sectionId}", skipping mirror.`);
      return;
    }
    const filePath = exportInfo.filePath;
    ensureDir(path.dirname(filePath));
    const payload = {
      id: clip.id,
      sectionId: clip.sectionId,
      title: clip.title || "",
      text: clip.text || "",
      notes: clip.notes || "",
      tags: clip.tags || [],
      sourceUrl: clip.sourceUrl || "",
      sourceTitle: clip.sourceTitle || "",
      capturedAt: clip.capturedAt || Date.now(),
      screenshots: clip.screenshots || [],
      icon: Object.prototype.hasOwnProperty.call(clip, "icon") ? clip.icon : null,
      color: Object.prototype.hasOwnProperty.call(clip, "color") ? clip.color : null,
      appearanceColor: Object.prototype.hasOwnProperty.call(clip, "appearanceColor")
        ? clip.appearanceColor
        : (Object.prototype.hasOwnProperty.call(clip, "userColor") ? clip.userColor : null),
    };
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`[SnipBoard] Mirrored clip ${clip.id} to ${filePath}`);
  } catch (err) {
    console.error("[SnipBoard] Failed to mirror clip to export folder:", err);
  }
}

async function persistClip(incomingClip, options = {}) {
  const { clips, sections } = loadData();
  let clip = clips.find((c) => c.id === incomingClip.id);
  const existing = clip ? { ...clip } : null;

  if (!clip) {
    const newId = "clip-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    clip = { ...incomingClip, id: newId };
    clips.push(clip);
  } else {
    Object.assign(clip, incomingClip);
  }

  const exportInfo = resolveClipFilename(clip, sections, existing?.exportFilename);
  if (exportInfo?.filename) {
    clip.exportFilename = exportInfo.filename;
  }

  saveClips(clips);
  if (options.mirror !== false) {
    await mirrorClipToExport(clip, sections);
  }

  if (existing?.exportFilename) {
    const oldDir = getExportDirForSection(existing.sectionId, sections);
    const oldPath = oldDir ? path.join(oldDir, existing.exportFilename) : null;
    const newPath = exportInfo?.filePath || null;
    if (oldPath && oldPath !== newPath && fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch (err) {
        console.warn("[SnipBoard] Failed to remove old clip export file:", err);
      }
    }
  }
  return clip;
}

function isSectionLockedById(sections, id) {
  if (!id) return false;
  const sec = sections.find((s) => s.id === id);
  return Boolean(sec && sec.locked);
}

const HTTP_HOST = "127.0.0.1";
const HTTP_PORT = 4050;
let httpServer = null;

function sendJsonResponse(res, status, payload) {
  const body = JSON.stringify(payload || {});
  if (!res.headersSent) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": globalThis.Buffer.byteLength(body),
    });
  }
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        const err = new Error("Request body too large");
        err.statusCode = 413;
        reject(err);
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function normalizeClipPayload(payload = {}) {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  if (!title && !text) {
    const err = new Error("Payload must include title or text");
    err.statusCode = 400;
    throw err;
  }

  const sectionCandidate = payload.sectionId || payload.section || "inbox";
  const sectionId =
    typeof sectionCandidate === "string" && sectionCandidate.trim()
      ? sectionCandidate.trim()
      : "inbox";

  const tagList = Array.isArray(payload.tags)
    ? payload.tags
        .map((item) => (item == null ? "" : String(item)))
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof payload.tags === "string"
    ? payload.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const capturedValue = Number(payload.capturedAt);
  const capturedAt =
    Number.isFinite(capturedValue) && capturedValue > 0 ? capturedValue : Date.now();

  return {
    id: payload.id || null,
    title,
    text,
    notes: typeof payload.notes === "string" ? payload.notes : "",
    tags: tagList,
    screenshots: Array.isArray(payload.screenshots)
      ? payload.screenshots.filter(Boolean)
      : [],
    sectionId,
    sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : "",
    sourceTitle: typeof payload.sourceTitle === "string" ? payload.sourceTitle : "",
    capturedAt,
  };
}

async function handleHttpRequest(req, res) {
  const allowedOrigins = [
    "https://chat.openai.com",
    "https://chatgpt.com",
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (origin && origin.startsWith("chrome-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const normalizedPath = (req.url || "").split("?")[0] || "";
  if (req.method === "GET" && normalizedPath.startsWith("/screenshots/")) {
    const filename = decodeURIComponent(normalizedPath.replace("/screenshots/", ""));
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { "Content-Type": "image/png" });
    stream.pipe(res);
    return;
  }
  if (req.method !== "POST" || normalizedPath !== "/add-clip") {
    sendJsonResponse(res, 404, { ok: false, error: "Not found" });
    return;
  }

  try {
    const rawBody = await readRequestBody(req);
    if (!rawBody) {
      const err = new Error("Missing request body");
      err.statusCode = 400;
      throw err;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      err.statusCode = 400;
      throw err;
    }

    const clip = normalizeClipPayload(payload);
    await persistClip(clip);
    sendJsonResponse(res, 200, { ok: true });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error("[SnipBoard http]", err);
    sendJsonResponse(res, status, {
      ok: false,
      error: err.message || "Unexpected error",
    });
  }
}

function startHttpBridge() {
  if (httpServer) return;

  httpServer = http.createServer((req, res) => {
    handleHttpRequest(req, res);
  });

  httpServer.on("error", (err) => {
    console.error("[SnipBoard http] Server error:", err);
  });

  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`[SnipBoard http] Listening on http://${HTTP_HOST}:${HTTP_PORT}`);
  });
}

function stopHttpBridge() {
  if (!httpServer) return;

  httpServer.close((err) => {
    if (err) {
      console.error("[SnipBoard http] Failed to stop server:", err);
    } else {
      console.log("[SnipBoard http] Server stopped");
    }
  });
  httpServer = null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      enableRemoteModule: false
    },
  });

  win.loadFile("index.html");
  return win;
}

app.whenReady().then(() => {
  ensureDir(DATA_DIR);
  ensureDir(SCREENSHOTS_DIR);
  migrateDataFiles();
  createWindow();
  startHttpBridge();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (globalThis.process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopHttpBridge();
});

/*
=================================================
  DATA IPC
=================================================
*/

ipcMain.handle("get-data", async () => {
  const { sections, clips } = loadData();
  return { sections, clips };
});

ipcMain.handle("save-clip", async (_event, incomingClip, options = {}) => {
  return persistClip(incomingClip, options);
});

ipcMain.handle("delete-clip", async (_event, id) => {
  const { sections, clips } = loadData();
  const target = clips.find((c) => c.id === id);
  if (target && isSectionLockedById(sections, target.sectionId)) {
    return { blocked: true, reason: "locked-section" };
  }
  const next = clips.filter((c) => c.id !== id);
  saveClips(next);
  return { ok: true };
});

ipcMain.handle("delete-clips", async (_event, ids) => {
  const { sections, clips } = loadData();
  const idSet = new Set(Array.isArray(ids) ? ids : []);
  const blocked = [];
  const keep = [];

  for (const clip of clips) {
    if (!idSet.has(clip.id)) {
      keep.push(clip);
      continue;
    }
    if (isSectionLockedById(sections, clip.sectionId)) {
      blocked.push(clip.id);
      keep.push(clip);
    }
  }

  saveClips(keep);
  return { ok: true, blocked };
});

ipcMain.handle("create-section", async (_event, name) => {
  migrateDataFiles();
  const { sections } = loadData();
  const base = String(name || "Section").trim() || "Section";
  const id = base.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const existing = sections.find((s) => s.id === id);
  const finalId = existing ? id + "-" + Math.random().toString(16).slice(2, 6) : id;

  const folder = path.join(SECTION_DIR, finalId);
  ensureDir(folder);
  const section = { id: finalId, name: base, locked: false, exportPath: "", folder };
  sections.push(section);
  saveSections(sections);
  return section;
});

ipcMain.handle("rename-section", async (_event, payload) => {
  const { sections } = loadData();
  const { id, name } = payload || {};
  const target = sections.find((s) => s.id === id);
  if (!target) return { ok: false, error: "Section not found" };
  const newName = String(name || "").trim();
  if (!newName) return { ok: false, error: "Invalid name" };
  target.name = newName;
  saveSections(sections);
  return { ok: true, section: target };
});

ipcMain.handle("update-section", async (_event, payload) => {
  const { sections } = loadData();
  const { id, patch } = payload || {};
  const target = sections.find((s) => s.id === id);
  if (!target) return { ok: false, error: "Section not found" };
  if (patch && typeof patch === "object") {
    if (patch.name !== undefined) target.name = patch.name;
    if (patch.locked !== undefined) target.locked = !!patch.locked;
    if (patch.exportPath !== undefined) target.exportPath = patch.exportPath || "";
    if (patch.color !== undefined) target.color = patch.color || "";
    if (patch.icon !== undefined) target.icon = patch.icon || "";
    if (patch.exportFolder !== undefined) target.exportFolder = patch.exportFolder || "";
  }
  saveSections(sections);
  return { ok: true, section: target };
});

ipcMain.handle("delete-section", async (_event, id) => {
  const { sections, clips } = loadData();
  const protectedIds = new Set(["inbox", "common-prompts", "black-skies", "errors", "misc"]);
  const target = sections.find((s) => s.id === id);
  if (protectedIds.has(id) || (target && target.locked)) {
    return { ok: false, error: "Cannot delete protected section." };
  }

  const nextSections = sections.filter((s) => s.id !== id);
  const nextClips = clips.filter((c) => c.sectionId !== id);

  saveSections(nextSections);
  saveClips(nextClips);
  return { ok: true };
});

ipcMain.handle("save-section-order", async (_event, sectionsPayload) => {
  const { sections } = loadData();
  if (!Array.isArray(sectionsPayload)) {
    return { ok: false, error: "Invalid sections payload" };
  }
  const known = new Map(sections.map((s) => [s.id, s]));
  const reordered = [];

  for (const incoming of sectionsPayload) {
    const existing = known.get(incoming.id);
    if (existing) {
      reordered.push({ ...existing, name: incoming.name || existing.name });
      known.delete(incoming.id);
    }
  }
  for (const leftover of known.values()) {
    reordered.push(leftover);
  }

  saveSections(reordered);
  return { ok: true, sections: reordered };
});

ipcMain.handle("set-section-locked", async (_event, payload) => {
  const { sections } = loadData();
  const { id, locked } = payload || {};
  if (!id) return { ok: false, error: "Missing section id" };
  const target = sections.find((s) => s.id === id);
  if (!target) return { ok: false, error: "Section not found" };
  target.locked = Boolean(locked);
  saveSections(sections);
  return { ok: true, section: target };
});

ipcMain.handle("set-section-export-path", async (_event, payload) => {
  const { sections } = loadData();
  const { id, exportPath } = payload || {};
  if (!id) return { ok: false, error: "Missing section id" };
  const target = sections.find((s) => s.id === id);
  if (!target) return { ok: false, error: "Section not found" };
  target.exportPath = exportPath || "";
  saveSections(sections);
  return { ok: true, section: target };
});

ipcMain.handle("choose-export-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { ok: false, path: null };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("get-clipboard-text", async () => {
  try {
    return clipboard.readText() || "";
  } catch (err) {
    console.error("[SnipBoard] Failed to read clipboard:", err);
    return "";
  }
});

/*
=================================================
  SCREENSHOT STORAGE IPC
=================================================
*/

ipcMain.handle("save-screenshot", async (_event, payload) => {
  try {
    ensureDir(SCREENSHOTS_DIR);
    const items = Array.isArray(payload) ? payload : [payload];
    const results = [];

    for (const item of items) {
      if (!item || !item.dataUrl) continue;
      const base64 = item.dataUrl.split(",")[1];
      if (!base64) continue;
      const fallbackShotName = `shot-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
      const rawName =
        typeof item.filename === "string" && item.filename.trim()
          ? item.filename.trim()
          : fallbackShotName;
      const filename = sanitizeFilename(rawName) || fallbackShotName;
      const buffer = globalThis.Buffer.from(base64, "base64");
      const filePath = path.join(SCREENSHOTS_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      results.push({ filename, fullPath: filePath });
    }

    return results;
  } catch (err) {
    console.error("[SnipBoard] save-screenshot failed:", err);
    throw err;
  }
});

ipcMain.handle("delete-screenshot", async (_event, payload) => {
  try {
    const { clipId, filename } = payload || {};
    if (!clipId || !filename) return { success: false, error: "Missing clipId or filename" };

    const clipData = readJson(CLIPS_FILE, []);
    const clipIdx = clipData.findIndex((c) => c.id === clipId);
    if (clipIdx === -1) return { success: false, error: "Clip not found" };

    const filePath = path.join(SCREENSHOTS_DIR, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn("[SnipBoard] Failed to delete screenshot file:", err);
      }
    }

    clipData[clipIdx].screenshots = (clipData[clipIdx].screenshots || []).filter((s) => s !== filename);
    writeJson(CLIPS_FILE, clipData);

    return { success: true, clip: clipData[clipIdx] };
  } catch (err) {
    console.error("[SnipBoard] delete-screenshot failed:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-screenshot-url", async (_event, filename) => {
  try {
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    return "file://" + filePath.replace(/\\/g, "/");
  } catch (err) {
    console.error("[SnipBoard] get-screenshot-url failed:", err);
    return "";
  }
});

ipcMain.handle("check-screenshot-path", async (_event, filename) => {
  try {
    if (!filename) return { ok: false, exists: false, fullPath: "" };
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    const exists = fs.existsSync(filePath);
    return { ok: true, exists, fullPath: filePath };
  } catch (err) {
    console.error("[SnipBoard] check-screenshot-path failed:", err);
    return { ok: false, exists: false, fullPath: "" };
  }
});

/*
=================================================
  DISPLAY ENUMERATION & CAPTURE
=================================================
*/

ipcMain.handle("list-displays", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 400, height: 225 },
    });

    return sources.map((src, index) => {
      const thumb = src.thumbnail;
      const hasThumb = thumb && !thumb.isEmpty();
      const dataUrl = hasThumb
        ? "data:image/png;base64," + thumb.toPNG().toString("base64")
        : "";

      return {
        id: src.id,
        label: "Screen " + (index + 1),
        name: src.name || "",
        display_id: src.display_id || null,
        hasThumb,
        thumbnail: dataUrl,
      };
    });
  } catch (err) {
    console.error("[SnipBoard] list-displays failed:", err);
    return [];
  }
});

ipcMain.handle("debug-list-displays", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 200, height: 200 },
    });

    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      size: s.thumbnail.getSize(),
      display_id: s.display_id || null,
      hasThumb: !s.thumbnail.isEmpty(),
    }));
  } catch (err) {
    console.error("[SnipBoard] debug-list-displays failed:", err);
    return [];
  }
});

async function captureAllMonitors() {
  const mainDisplay = screen.getPrimaryDisplay();
  const fullSize = mainDisplay && mainDisplay.size ? mainDisplay.size : { width: 1920, height: 1080 };
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    fetchWindowIcons: false,
    thumbnailSize: { width: fullSize.width, height: fullSize.height },
  });

  const captures = [];
  sources.forEach((source, index) => {
    const img = source.thumbnail;
    if (!img || img.isEmpty()) {
      console.warn("[SnipBoard] Empty thumbnail for", source.id, source.name);
      return;
    }
    const buffer = img.toPNG();
    if (!buffer || buffer.length < 1000) {
      console.warn("[SnipBoard] Tiny/invalid PNG for", source.id, source.name);
      return;
    }
    captures.push({
      id: source.id,
      index,
      buffer,
      width: img.getSize().width,
      height: img.getSize().height,
    });
  });

  return captures;
}

async function saveAllMonitorScreenshots() {
  ensureDir(SCREENSHOTS_DIR);
  const captures = await captureAllMonitors();
  const timestamp = Date.now();
  const files = [];

  captures.forEach((capture) => {
    const fileName = `Monitor-${capture.index + 1}-${timestamp}.png`;
    const filePath = path.join(SCREENSHOTS_DIR, fileName);
    if (!capture.buffer || capture.buffer.length < 1000) {
      console.warn("[SnipBoard] Ignoring empty capture for", capture.id);
      return;
    }
    fs.writeFileSync(filePath, capture.buffer);
    files.push({
      filename: fileName,
      buffer: capture.buffer,
      dataUrl: "data:image/png;base64," + capture.buffer.toString("base64"),
      path: filePath,
    });
  });

  console.log("[SnipBoard] Multi-monitor capture:", {
    requested: captures.length,
    saved: files.length,
    files: files.map(f => f.filename),
  });

  return { count: files.length, files };
}

ipcMain.handle("capture-screen", async () => {
  try {
    const result = await saveAllMonitorScreenshots();
    return {
      success: true,
      monitorsCaptured: result.count,
      screenshots: result.files.map((f) => ({
        filename: f.filename,
        dataUrl: f.dataUrl,
      })),
    };
  } catch (err) {
    console.error("[SnipBoard] capture-screen failed:", err);
    throw err;
  }
});

/*
=================================================
  URL OPEN
=================================================
*/

function isValidUrl(url) {
  try {
    const u = new globalThis.URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

ipcMain.handle("open-url", async (_event, url) => {
  try {
    if (!url || !isValidUrl(url)) {
      await dialog.showMessageBox({
        type: "warning",
        title: "Invalid URL",
        message: "This link cannot be opened: Unsupported or unsafe URL scheme.",
        buttons: ["OK"],
      });
      return { success: false };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error("[SnipBoard] open-url failed:", err);
    return { success: false, error: err?.message };
  }
});

/*
=================================================
  TABS CONFIG
=================================================
*/

ipcMain.handle("tabs:load", async () => {
  return loadTabsConfigFromDisk();
});

ipcMain.handle("reorder-tabs", async (_event, payload) => {
  const orderedTabIds = Array.isArray(payload?.orderedTabIds) ? payload.orderedTabIds : [];
  if (!orderedTabIds.length) {
    return { ok: false, error: "Invalid reorder payload" };
  }
  const config = loadTabsConfigFromDisk();
  const tabs = Array.isArray(config.tabs) ? config.tabs : [];
  const map = new Map(tabs.map((tab) => [tab.id, tab]));
  const reordered = [];
  orderedTabIds.forEach((id) => {
    const tab = map.get(id);
    if (tab) {
      reordered.push(tab);
      map.delete(id);
    }
  });
  map.forEach((tab) => reordered.push(tab));
  config.tabs = reordered;
  config.activeTabId = config.activeTabId || "all";
  saveTabsConfigToDisk(config);
  return { ok: true, tabs: config.tabs, activeTabId: config.activeTabId };
});

ipcMain.handle("reorder-clips", async (_event, payload) => {
  const { sectionId, orderedClipIds } = payload || {};
  if (!sectionId || !Array.isArray(orderedClipIds)) {
    return { ok: false, error: "Invalid reorder payload" };
  }
  const config = loadTabsConfigFromDisk();
  if (!Array.isArray(config.tabs)) config.tabs = [];
  const target = config.tabs.find((tab) => tab.id === sectionId);
  if (!target) {
    return { ok: false, error: "Tab not found" };
  }
  const normalizedOrder = [];
  const seen = new Set();
  orderedClipIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    normalizedOrder.push(id);
  });
  target.clipOrder = normalizedOrder;
  saveTabsConfigToDisk(config);
  return { ok: true, tabs: config.tabs, activeTabId: config.activeTabId };
});

ipcMain.handle("tabs:save", async (_event, config) => {
  saveTabsConfigToDisk(config || {});
  return { ok: true };
});
