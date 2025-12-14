(function (global) {
  /**
   * SnipBoard Module: state.js
   *
   * Responsibilities:
   *  - Define core application constants and default data structures.
   *  - Provide pure helpers for normalizing and validating state.
   *  - Expose shared data-model utilities (tab/clip transforms, signatures).
   *
   * Exports:
   *  - window.SnipState (constants, defaults, helper functions).
   *
   * Does NOT handle:
   *  - DOM manipulation.
   *  - IPC calls or persistence side effects.
   *
   * Dependencies:
   *  - Native browser APIs only (no globals injected).
   *
   * Notes:
   *  - Pure module; safe for reuse in any renderer context.
   *  - Assumes renderer.js bootstraps and injects SnipState into other modules.
   */
  /**
   * Data Model:
   * Clip {
   *   id: string
   *   title: string
   *   text: string
   *   tags: string[]
   *   screenshots: string[]
   *   icon: string|null
   *   color: string|null
   *   sectionId: string
   *   createdAt?: number
   *   modifiedAt?: number
   *   sourceUrl?: string
   *   sourceTitle?: string
   *   notes?: string
   *   capturedAt?: number
   * }
   *
   * Tab {
   *   id: string
   *   name: string
   *   label?: string
   *   icon: string|null
   *   color: string|null
   *   exportPath: string
   *   exportFolder: string
   *   locked: boolean
   *   order: number
   *   schema: string[]
   * }
   *
   * AppState {
   *   sections: Array
   *   clips: Array
   *   currentSectionId: string
   *   tabs: Array
   *   activeTabId: string
   *   currentClipId: string|null
   *   selectedClipIds: Set<string>
   *   searchText: string
   *   tagFilter: string
   *   editingSectionId: string|null
   *   renameDraft: string
   *   pendingColorSection: string|null
   *   pendingIconSection: string|null
   *   selectedIcon: string
   *   selectedColor: string
   *   pendingRenameSectionId: string|null
   *   sortMode: string
   *   lockedSections: Set<string>
   *   draggingClipId: string|null
  *   searchIndex: Map<string,string>
  * }
  */
  const AppState = {
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
    lockedSections: new Set(),
    draggingClipId: null,
    searchIndex: new Map(),
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

  const DEFAULT_TABS = [
    { id: "inbox", label: "Inbox", locked: false, exportFolder: "", color: "", icon: "", order: 0, schema: DEFAULT_SCHEMA.slice(), clipOrder: [] },
    { id: "common-prompts", label: "Common Prompts", locked: false, exportFolder: "", color: "", icon: "", order: 1, schema: DEFAULT_SCHEMA.slice(), clipOrder: [] },
    { id: "black-skies", label: "Black Skies", locked: false, exportFolder: "", color: "", icon: "", order: 2, schema: DEFAULT_SCHEMA.slice(), clipOrder: [] },
    { id: "errors", label: "Errors", locked: false, exportFolder: "", color: "", icon: "", order: 3, schema: DEFAULT_SCHEMA.slice(), clipOrder: [] },
    { id: "misc", label: "Misc", locked: false, exportFolder: "", color: "", icon: "", order: 4, schema: DEFAULT_SCHEMA.slice(), clipOrder: [] },
  ];

  const EXPORT_BASE = "data/exports";

  const DEFAULT_CLIP_DISPLAY = {
    icon: null,
    color: null,
  };

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

  /**
   * Returns a human-readable label for a section id.
   * @param {string} id
   * @returns {string}
   */
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

  /**
   * Locate an icon choice definition by id/emoji/icon.
   * @param {string} value
   * @param {Array<Object>} [choices=iconChoices]
   * @returns {Object|null}
   */
  function findIconChoice(value, choices = iconChoices) {
    if (!value) return null;
    const list = Array.isArray(choices) ? choices : iconChoices;
    return list.find((c) => c.id === value || c.emoji === value || c.icon === value) || null;
  }

  /**
   * Produce a JSON signature for shallow change detection.
   * @param {Array|Object} arr
   * @returns {string}
   */
  function computeSignature(arr) {
    try {
      return JSON.stringify(arr);
    } catch {
      return "";
    }
  }

  /**
   * Normalize clip fields and ensure required defaults.
   * @param {Object} raw
   * @returns {Object}
   */
  function normalizeClip(raw = {}) {
    const base = { ...raw };
    if (base.title === undefined) base.title = "";
    if (base.text === undefined) base.text = "";
    if (!Array.isArray(base.screenshots)) base.screenshots = [];
    if (!Array.isArray(base.tags)) base.tags = [];
    if (!base.sectionId && base.section) {
      base.sectionId = base.section.id || base.section;
    }
    if (base.icon === undefined) base.icon = DEFAULT_CLIP_DISPLAY.icon;
    if ((base.color === undefined || base.color === null || base.color === "") && (base.appearanceColor || base.userColor)) {
      base.color = base.appearanceColor || base.userColor;
    }
    if (base.color === undefined) base.color = DEFAULT_CLIP_DISPLAY.color;
    if (base.appearanceColor !== undefined) delete base.appearanceColor;
    if (base.userColor !== undefined) delete base.userColor;
    return base;
  }

  /**
   * Format a numeric timestamp into a locale string.
   * @param {number|string} ts
   * @returns {string}
   */
  function formatDateTime(ts) {
    if (!ts) return "";
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }

  /**
   * Convert a tab name to a slug-safe identifier.
   * @param {string} name
   * @returns {string}
   */
  function slugifyTabName(name) {
    const base = (name || "tab").toString().toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "tab";
  }

  /**
   * Convert a clip/title string to a slug-safe identifier.
   * @param {string} name
   * @returns {string}
   */
  function slugifyTitle(name) {
    const base = (name || "").toString().toLowerCase().trim();
    const spaced = base.replace(/\s+/g, "-");
    const cleaned = spaced.replace(/[^a-z0-9\-]/g, "-");
    const collapsed = cleaned.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    return collapsed || "";
  }

  /**
   * Build a filename (with .json) for a clip based on its title.
   * @param {Object} clip
   * @returns {string}
   */
  function buildClipFilename(clip) {
    const slug = slugifyTitle(clip?.title || "");
    const base = slug || clip?.id || "clip";
    return `${base}.json`;
  }

  /**
   * Compute the default export path for a tab name.
   * @param {string} name
   * @returns {string}
   */
  function canonicalExportPath(name) {
    return `${EXPORT_BASE}/${slugifyTabName(name)}`;
  }

  /**
   * Normalize an export path to a safe default if needed.
   * @param {string} pathValue
   * @param {string} name
   * @returns {string}
   */
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

  /**
   * Normalize persisted tab configs to runtime tab objects.
   * @param {Array<Object>} tabs
   * @returns {Array<Object>}
   */
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
      const normalizeClipOrder = (order) => {
        if (!Array.isArray(order)) return [];
        const seen = new Set();
        return order
          .map((id) => (typeof id === "string" ? id : ""))
          .filter((id) => id && !seen.has(id) && seen.add(id));
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
        clipOrder: normalizeClipOrder(t.clipOrder),
        }))
        .sort((a, b) => a.order - b.order);
    }

  /**
   * Convert normalized tabs to section objects.
   * @param {Array<Object>} tabs
   * @returns {Array<Object>}
   */
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
      clipOrder: Array.isArray(t.clipOrder) ? t.clipOrder : [],
    }));
  }

  /**
   * Convert sections array into tab definitions.
   * @param {Array<Object>} sections
   * @returns {Array<Object>}
   */
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
      clipOrder: Array.isArray(s.clipOrder) ? s.clipOrder : [],
    }));
  }

  /**
   * Ensure sections have default export/icon/color values.
   * @param {Array<Object>} sections
   * @returns {Array<Object>}
   */
  function normalizeSections(sections) {
    return (sections || []).map((s) => ({
      ...s,
      exportFolder: s.exportFolder ?? s.exportPath ?? "",
      exportPath: s.exportPath ?? s.exportFolder ?? "",
      color: s.color || "",
      icon: s.icon || "",
      clipOrder: Array.isArray(s.clipOrder) ? s.clipOrder : [],
    }));
  }

  /**
   * Normalize and clamp text input.
   * @param {string} str
   * @param {number} [max=2000]
   * @returns {string}
   */
  function validateText(str, max = 2000) {
    if (!str) return "";
    return String(str).trim().slice(0, max);
  }

  /**
   * Return a safe http/https URL or empty string.
   * @param {string} url
   * @returns {string}
   */
  function validateUrl(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      return (u.protocol === "http:" || u.protocol === "https:") ? url : "";
    } catch {
      return "";
    }
  }

  /**
   * Build a lowercase search index map keyed by clip id.
   * @param {Array<Object>} clips
   * @returns {Map<string,string>}
   */
  function updateSearchIndex(clips) {
    const map = new Map();
    (clips || []).forEach((clip) => {
      const tagsString = Array.isArray(clip.tags) ? clip.tags.join(" ") : "";
      const entry = `${clip.title || ""} ${clip.text || ""} ${clip.notes || ""} ${tagsString}`.toLowerCase();
      map.set(clip.id, entry);
    });
    return map;
  }

  const SnipState = {
    AppState,
    DEFAULT_SCHEMA,
    FIELD_OPTIONS,
    TAB_COLORS,
    DEFAULT_TABS,
    EXPORT_BASE,
    DEFAULT_CLIP_DISPLAY,
    iconChoices,
    sectionLabel,
    findIconChoice,
    computeSignature,
    normalizeClip,
    formatDateTime,
    slugifyTabName,
    slugifyTitle,
    buildClipFilename,
    canonicalExportPath,
    normalizeExportPath,
    normalizeTabs,
    tabsToSections,
    sectionsToTabs,
    normalizeSections,
    updateSearchIndex,
    validateText,
    validateUrl,
  };

  // Public API:
  // {
  //   AppState,
  //   DEFAULT_SCHEMA,
  //   FIELD_OPTIONS,
  //   TAB_COLORS,
  //   DEFAULT_TABS,
  //   EXPORT_BASE,
  //   DEFAULT_CLIP_DISPLAY,
  //   iconChoices,
  //   sectionLabel,
  //   findIconChoice,
  //   computeSignature,
  //   normalizeClip,
  //   formatDateTime,
  //   slugifyTabName,
  //   slugifyTitle,
  //   buildClipFilename,
  //   canonicalExportPath,
  //   normalizeExportPath,
  //   normalizeTabs,
  //   tabsToSections,
  //   sectionsToTabs,
  //   normalizeSections,
  //   updateSearchIndex,
  //   validateText,
  //   validateUrl,
  // }

  global.SnipState = SnipState;
})(window);
