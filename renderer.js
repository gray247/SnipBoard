/* global File */
(() => {
  const api = window.api || {};
  const {
    AppState,
    DEFAULT_SCHEMA,
    normalizeClip,
    updateSearchIndex,
    sectionLabel,
    FIELD_OPTIONS,
  } = window.SnipState || {};

  const {
    CHANNELS,
    invoke: rawInvoke,
    safeInvoke,
  } = window.SnipIPC || {};

  const { initTabs } = window.SnipTabs || {};
  const { initClips } = window.SnipClips || {};
  const { initEditor } = window.SnipEditor || {};
  const { initModals } = window.SnipModals || {};

  const invoke = rawInvoke || (async () => {});
  const safeChannel = safeInvoke || invoke;
  const SCREENSHOT_BASE_URL = "http://127.0.0.1:4050/screenshots";

  const labelForSection = typeof sectionLabel === "function" ? sectionLabel : (id) => id || "Section";
  const state = AppState || {
    tabs: [],
    sections: [],
    clips: [],
    activeTabId: 'all',
    currentClipId: null,
    searchQuery: '',
    tagFilter: '',
  };

window.__SNIPBOARD_STATE__ = state;

  let refreshFullQueue = Promise.resolve();

  const resolveClipForSection = (sectionId) => {
    const clips = state.clips || [];
    const targetSection = sectionId || getActiveSectionId();
    if (targetSection === 'all') {
      return clips.find((clip) => clip.id === state.currentClipId) || clips[0] || null;
    }
    const currentInSection = clips.find(
      (clip) => clip.id === state.currentClipId && clip.sectionId === targetSection
    );
    if (currentInSection) return currentInSection;
    return clips.find((clip) => clip.sectionId === targetSection) || null;
  };

  const normalizeTabSchemas = (tabs = []) => {
    const options = Array.isArray(FIELD_OPTIONS) && FIELD_OPTIONS.length
      ? FIELD_OPTIONS
      : Array.isArray(DEFAULT_SCHEMA) ? DEFAULT_SCHEMA : [];
    const allowedLower = new Set(options.map((f) => (typeof f === 'string' ? f.toLowerCase() : f)));
    return (Array.isArray(tabs) ? tabs : []).map((tab) => {
      const rawSchema = Array.isArray(tab?.schema) ? tab.schema : [];
      const normalized = rawSchema
        .map((f) => (typeof f === 'string' ? f.trim() : ''))
        .filter(Boolean)
        .map((f) => {
          const lower = f.toLowerCase();
          if (!allowedLower.has(lower)) return null;
          const match = options.find((opt) => typeof opt === 'string' && opt.toLowerCase() === lower);
          return match || lower;
        })
        .filter(Boolean);
      const schema = normalized.length ? normalized : options.slice();
      return { ...tab, schema };
    });
  };

  const getCurrentClip = () => resolveClipForSection(getActiveSectionId());

  function normalizeTags(raw) {
    if (Array.isArray(raw)) {
      return raw.map((tag) => (tag ? String(tag).trim() : '')).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((tag) => tag.trim()).filter(Boolean);
    }
    return [];
  }

  function sanitizeClipData(clip) {
    if (!clip) return clip;
    if (!Array.isArray(clip.screenshots)) {
      clip.screenshots = [];
    }
    clip.screenshots = clip.screenshots
      .map((name) => (typeof name === 'string' ? name.trim() : ''))
      .filter(Boolean);
    if (!Array.isArray(clip.tags)) {
      if (typeof clip.tags === 'string') {
        clip.tags = clip.tags
          .split(',')
          .map((tag) => (tag ? tag.trim() : ''))
          .filter(Boolean);
      } else {
        clip.tags = [];
      }
    } else {
      clip.tags = clip.tags
        .map((tag) => (tag ? String(tag).trim() : ''))
        .filter(Boolean);
    }
    if ((clip.color === undefined || clip.color === null || clip.color === '') && (clip.appearanceColor || clip.userColor)) {
      clip.color = clip.appearanceColor || clip.userColor || '';
    }
    if (clip.appearanceColor !== undefined) delete clip.appearanceColor;
    if (clip.userColor !== undefined) delete clip.userColor;
    if (!clip.sectionId) clip.sectionId = 'inbox';
    clip.tags = normalizeTags(clip.tags);
    normalizeClipScreenshots(clip);
    return clip;
  }

  let screenshotContextMenu = null;

  function ensureScreenshotContextMenu() {
    if (screenshotContextMenu) return screenshotContextMenu;
    const menu = document.createElement('div');
    menu.className = 'sb-screenshot-menu';
    menu.style.position = 'absolute';
    menu.style.display = 'none';
    menu.style.zIndex = '99999';
    menu.innerHTML = `
      <button data-action="view">View Screenshot</button>
      <button data-action="edit">Edit Screenshot</button>
      <button data-action="remove">Remove from Clip</button>
    `;
    menu.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      if (!action) return;
      const filename = menu.dataset.filename;
      const index = Number(menu.dataset.index);
      menu.style.display = 'none';
      const clip = getCurrentClip();
      if (!clip) return;
      if (action === 'view') {
        openScreenshotViewer(filename);
        return;
      }
      if (action === 'edit') {
        openScreenshotEditor(filename);
        return;
      }
      if (action === 'remove') {
        const locked = isCurrentSectionLocked(clip.sectionId);
        if (locked) return;
        if (!Number.isFinite(index)) return;
        const updated = [...clip.screenshots];
        updated.splice(index, 1);
        clip.screenshots = updated;
        const saved = await api.saveClip?.(clip, { mirror: false });
        if (saved) {
          const idx = (state.clips || []).findIndex((item) => item.id === saved.id);
          if (idx !== -1) {
            state.clips[idx] = sanitizeClipData(normalizeClip(saved));
          }
        }
        await refreshEditor();
        refreshClipThumbnails();
      }
    });
    document.body.appendChild(menu);
    screenshotContextMenu = menu;
    return menu;
  }

  document.addEventListener('click', () => {
    if (screenshotContextMenu) {
      screenshotContextMenu.style.display = 'none';
    }
  });

  function normalizeClipScreenshots(clip) {
    if (!clip) return clip;
    if (!Array.isArray(clip.screenshots)) {
      clip.screenshots = [];
    }
    clip.screenshots = clip.screenshots.filter(
      (name) => typeof name === 'string' && name.trim().length > 0
    );
    return clip;
  }

  const missingScreenshotSet = new Set();
  const screenshotUrlCache = new Map();

  async function getCachedScreenshotUrl(filename) {
    if (!filename) return null;
    if (screenshotUrlCache.has(filename)) {
      return screenshotUrlCache.get(filename);
    }
    try {
      const url = `${SCREENSHOT_BASE_URL}/${encodeURIComponent(filename)}`;
      screenshotUrlCache.set(filename, url);
      return url;
    } catch {
      if (!missingScreenshotSet.has(filename)) {
        console.warn('Missing screenshot:', filename);
        missingScreenshotSet.add(filename);
      }
      screenshotUrlCache.set(filename, null);
      return null;
    }
  }

  const syncSectionsFromTabs = () => {
    state.sections = (state.tabs || []).map((tab) => ({
      id: tab.id,
      name:
        tab.label ||
        tab.name ||
        labelForSection(tab.id) ||
        tab.id ||
        'Section',
      locked: Boolean(tab.locked),
      color: tab.color || '',
      icon: tab.icon || '',
    }));
  };

  const refreshSectionSelect = () => {
    if (!sectionSelect) return;
    const options = (state.sections || [])
      .map((sec) => {
        const label = sec.name || labelForSection(sec.id);
        return `<option value="${sec.id}">${label}</option>`;
      })
      .join('');
    sectionSelect.innerHTML = options;
    const clip = getCurrentClip();
    sectionSelect.value = clip?.sectionId || state.activeTabId || '';
  };

  const ensureCurrentClipSection = (clip) => {
    if (!clip) return;
    const hasSection = (state.sections || []).some((sec) => sec.id === clip.sectionId);
    if (!hasSection) {
      clip.sectionId = state.sections[0]?.id || 'all';
    }
  };

  function isCurrentSectionLocked(sectionId) {
    const sectionIdToCheck = sectionId || getActiveSectionId();
    if (sectionIdToCheck === 'all') return false;
    const section = (state.sections || []).find((sec) => sec.id === sectionIdToCheck);
    return Boolean(section?.locked);
  }

  function updateEditorControls() {
    const clip = getCurrentClip();
    const enabled = Boolean(clip);
    const locked = isCurrentSectionLocked();
    if (saveClipBtn) saveClipBtn.disabled = !enabled;
    if (deleteClipBtn) deleteClipBtn.disabled = !enabled || locked;
    if (addShotBtn) addShotBtn.disabled = !enabled;
  }

  const sanitizeAppearancePatch = (patch = {}) => {
    const clean = {};
    if (typeof patch.color === 'string') {
      const c = patch.color.trim();
      if (c && !/[<>]/.test(c) && c.length <= 64) clean.color = c;
    }
    if (typeof patch.icon === 'string') {
      const i = patch.icon.trim();
      if (i && !/[<>]/.test(i) && i.length <= 16) clean.icon = i;
    }
    return clean;
  };

  // Editor screenshots are independent of the clip list so we load them separately.
  async function renderEditorScreenshots(clip) {
    if (!screenshotBox) return;
    screenshotBox.innerHTML = '';
    normalizeClipScreenshots(clip);
    const screenshots = (clip?.screenshots || []).filter(
      (file) => file && typeof file === 'string' && file.trim() !== ''
    );
    clip.screenshots = screenshots;
    for (let index = 0; index < screenshots.length; index += 1) {
      const file = screenshots[index];
      const url = await getCachedScreenshotUrl(file);
      if (!url) continue;
      const thumb = document.createElement('div');
      thumb.className = 'screenshot-thumb';
      thumb.draggable = true;
      thumb.dataset.index = String(index);
      thumb.dataset.file = file;
      const img = document.createElement('img');
      img.className = 'thumb';
      img.alt = clip?.title || 'Screenshot';
      img.src = url;
      img.style.width = '120px';
      img.style.height = '90px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '10px';
      img.onerror = () => {
        thumb.style.display = 'none';
      };
      thumb.appendChild(img);

      thumb.addEventListener('dragstart', async (event) => {
        event.dataTransfer.effectAllowed = 'copyMove';
        const filename = thumb.dataset.file;
        if (filename) {
          try {
            event.dataTransfer.setData('text/plain', filename);
            const fileUrl = `${SCREENSHOT_BASE_URL}/${encodeURIComponent(filename)}`;
            event.dataTransfer.setData('text/uri-list', fileUrl);
            if (typeof File !== 'undefined') {
              try {
                const response = await fetch(fileUrl);
                const blob = await response.blob();
                if (blob && event.dataTransfer?.items) {
                  const fileObj = new File([blob], filename, { type: blob.type || 'image/png' });
                  event.dataTransfer.items.add(fileObj);
                }
              } catch (err) {
                console.warn('[SnipBoard] drag image blob failed', err);
              }
            }
          } catch (err) {
            console.warn('[SnipBoard] screenshot dragstart failed', err);
          }
        }
        thumb.classList.add('screenshot-thumb--dragging');
      });
      thumb.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        thumb.classList.add('screenshot-thumb--drag-over');
      });
      thumb.addEventListener('dragleave', () => {
        thumb.classList.remove('screenshot-thumb--drag-over');
      });
      thumb.addEventListener('drop', (event) => {
        event.preventDefault();
        thumb.classList.remove('screenshot-thumb--drag-over');
        const dragged = event.dataTransfer.getData('text/plain');
        const clip = getCurrentClip();
        if (!clip || !dragged) return;
        const updated = (clip.screenshots || []).filter((shot) => shot !== dragged);
        const targetIndex = Number(thumb.dataset.index);
        if (!Number.isFinite(targetIndex)) return;
        const insertAt = targetIndex > updated.length ? updated.length : targetIndex;
        updated.splice(insertAt, 0, dragged);
        clip.screenshots = updated;
        renderEditorScreenshots(clip);
        refreshClipThumbnails();
      });
      thumb.addEventListener('dragend', () => {
        thumb.classList.remove('screenshot-thumb--drag-over');
      });
      thumb.addEventListener('click', () => {
        openScreenshotViewer(file);
      });
      thumb.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = ensureScreenshotContextMenu();
        const clip = getCurrentClip();
        const locked = isCurrentSectionLocked(clip?.sectionId);
        const removeBtn = menu.querySelector('[data-action="remove"]');
        if (removeBtn) {
          removeBtn.disabled = Boolean(locked);
          if (locked) {
            removeBtn.classList.add('disabled');
            removeBtn.setAttribute('aria-disabled', 'true');
          } else {
            removeBtn.classList.remove('disabled');
            removeBtn.removeAttribute('aria-disabled');
          }
        }
        menu.dataset.filename = file;
        menu.dataset.index = thumb.dataset.index;
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;
        menu.style.display = 'block';
      });

      screenshotBox.appendChild(thumb);
    }
  }

  async function openScreenshotViewer(filename) {
    if (!filename) return;
    const existing = document.querySelector('.screenshot-viewer-overlay');
    if (existing) existing.remove();
    const url = `${SCREENSHOT_BASE_URL}/${encodeURIComponent(filename)}`;
    const overlay = document.createElement('div');
    overlay.className = 'screenshot-viewer-overlay';
    overlay.innerHTML = `
      <div class="screenshot-viewer-backdrop"></div>
      <div class="screenshot-viewer-dialog">
        <button class="screenshot-viewer-close" aria-label="Close">&times;</button>
        <img class="screenshot-viewer-image" src="${url}" alt="Screenshot preview" />
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      window.removeEventListener('keydown', escHandler);
    };
    const backdrop = overlay.querySelector('.screenshot-viewer-backdrop');
    const closeButton = overlay.querySelector('.screenshot-viewer-close');
    backdrop?.addEventListener('click', close);
    closeButton?.addEventListener('click', close);
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', escHandler);
  }

  function getCanvasCoords(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  /** Screenshot editor overlay **/
  const screenshotEditorPalette = ['#111111', '#0f4ac6', '#c0392b', '#f39c12', '#27ae60', '#ef476f'];
  let screenshotEditor = null;

  function ensureScreenshotEditor() {
    if (screenshotEditor) return screenshotEditor;
    const overlay = document.createElement('div');
    overlay.className = 'screenshot-editor-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="screenshot-editor-dialog">
        <div class="screenshot-editor-toolbar">
          <button type="button" class="screenshot-editor-tool active" data-tool="pen" aria-label="Pen tool">Pen</button>
          <button type="button" class="screenshot-editor-tool" data-tool="eraser" aria-label="Eraser tool">Eraser</button>
          <input type="color" class="screenshot-editor-color-picker" value="#0f172a" aria-label="Brush color" />
          <div class="screenshot-editor-swatches">
            ${screenshotEditorPalette
              .map(
                (color) =>
                  `<button type="button" class="color-swatch" data-color="${color}" style="background:${color}" aria-label="Color ${color}"></button>`
              )
              .join('')}
          </div>
          <div class="screenshot-editor-actions">
            <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
            <button type="button" class="btn" data-action="save">Save</button>
          </div>
        </div>
        <canvas class="screenshot-editor-canvas"></canvas>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.screenshot-editor-canvas');
    const ctx = canvas.getContext('2d');
    const colorInput = overlay.querySelector('.screenshot-editor-color-picker');
    const toolButtons = overlay.querySelectorAll('[data-tool]');
    const swatchButtons = overlay.querySelectorAll('.screenshot-editor-swatches .color-swatch');
    const actionButtons = overlay.querySelectorAll('[data-action]');

    const state = {
      tool: 'pen',
      color: colorInput.value || '#0f172a',
      filename: null,
      isDrawing: false,
      pointerId: null,
      escHandler: null,
    };

    const applyBrushSettings = () => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = state.tool === 'eraser' ? 28 : 6;
      ctx.globalCompositeOperation = state.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = state.color;
    };

    const pointerDown = (event) => {
      event.preventDefault();
      state.isDrawing = true;
      state.pointerId = event.pointerId;
      applyBrushSettings();
      const { x, y } = getCanvasCoords(event, canvas);
      ctx.beginPath();
      ctx.moveTo(x, y);
      canvas.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event) => {
      if (!state.isDrawing || state.pointerId !== event.pointerId) return;
      const { x, y } = getCanvasCoords(event, canvas);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const stopDrawing = () => {
      if (!state.isDrawing) return;
      state.isDrawing = false;
      if (state.pointerId && canvas.hasPointerCapture(state.pointerId)) {
        canvas.releasePointerCapture(state.pointerId);
      }
      state.pointerId = null;
    };

    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    canvas.addEventListener('pointerleave', stopDrawing);

    toolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        toolButtons.forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        state.tool = button.dataset.tool || 'pen';
      });
    });

    colorInput.addEventListener('input', () => {
      state.color = colorInput.value;
    });

    swatchButtons.forEach((swatch) => {
      swatch.addEventListener('click', () => {
        const next = swatch.dataset.color;
        if (!next) return;
        state.color = next;
        colorInput.value = next;
      });
    });

    const close = () => {
      overlay.style.display = 'none';
      state.filename = null;
      state.isDrawing = false;
      state.pointerId = null;
      if (state.escHandler) {
        window.removeEventListener('keydown', state.escHandler);
        state.escHandler = null;
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close();
      }
    });

    const handleSave = async () => {
      if (!state.filename) return;
      try {
        const dataUrl = canvas.toDataURL('image/png');
        await api.saveScreenshot?.([{ filename: state.filename, dataUrl }]);
        screenshotUrlCache.delete(state.filename);
        window.SnipToast?.show?.('Screenshot saved');
        const clip = getCurrentClip();
        if (clip) {
          await renderEditorScreenshots(clip);
        }
        refreshClipThumbnails();
      } catch (err) {
        console.error('[SnipBoard] screenshot edit save failed', err);
        window.SnipToast?.show?.('Failed to save screenshot');
      } finally {
        close();
      }
    };

    actionButtons.forEach((button) => {
      const action = button.dataset.action;
      if (action === 'save') {
        button.addEventListener('click', handleSave);
        return;
      }
      if (action === 'cancel') {
        button.addEventListener('click', close);
      }
    });

    screenshotEditor = {
      overlay,
      canvas,
      ctx,
      state,
      close,
    };
    return screenshotEditor;
  }

    async function openScreenshotEditor(filename) {
      if (!filename) return;
      const editor = ensureScreenshotEditor();
      const url = await getCachedScreenshotUrl(filename);
      if (!url) {
        window.SnipToast?.show?.('Screenshot missing');
        return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = img.naturalWidth || img.width || 800;
      const height = img.naturalHeight || img.height || 600;
      editor.canvas.width = width * dpr;
      editor.canvas.height = height * dpr;
      editor.canvas.style.width = `${Math.min(width, window.innerWidth - 80)}px`;
      editor.canvas.style.height = `${Math.min(height, window.innerHeight - 160)}px`;
      editor.ctx.setTransform(1, 0, 0, 1, 0, 0);
      editor.ctx.clearRect(0, 0, editor.canvas.width, editor.canvas.height);
      editor.ctx.save();
      editor.ctx.scale(dpr, dpr);
      editor.ctx.drawImage(img, 0, 0, width, height);
      editor.ctx.restore();
      editor.overlay.style.display = 'flex';
    };
    img.onerror = () => {
      window.SnipToast?.show?.('Unable to load screenshot');
    };
    img.src = url;
    editor.state.filename = filename;
    if (editor.state.escHandler) {
      window.removeEventListener('keydown', editor.state.escHandler);
    }
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        editor.close();
      }
    };
    editor.state.escHandler = escHandler;
    window.addEventListener('keydown', escHandler);
  }
  async function renderClipThumbnails() {
    if (!clipList) return;
    const rows = clipList.querySelectorAll('.clip-row');
    for (const row of rows) {
      const clipId = row.dataset.clipId;
      const container = row.querySelector('.clip-row__thumb');
      if (!clipId || !container) continue;
      const clip = state.clips.find((item) => item.id === clipId);
      if (!clip) {
        container.innerHTML = '';
        continue;
      }
      normalizeClipScreenshots(clip);
      const firstShot = (clip.screenshots || [])[0];
      if (!firstShot) {
        container.innerHTML = '';
        continue;
      }
      const url = await getCachedScreenshotUrl(firstShot);
      if (!url) {
        container.innerHTML = '';
        continue;
      }
      container.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'clip-thumbnail';
      img.alt = clip.title || 'Screenshot';
      img.src = url;
      container.appendChild(img);
    }
  }

  function getActiveSectionId() {
    return state.activeTabId || state.currentSectionId || 'all';
  }

  function getCurrentSection() {
    const sectionId = getActiveSectionId();
    return (state.sections || []).find((sec) => sec.id === sectionId) || null;
  }

  function updateActiveSectionLabel() {
    if (!clipTabNameEl) return;
    const section = getCurrentSection();
    const activeSectionId = getActiveSectionId();
    if (!section) {
      if (activeSectionId === 'all') {
        clipTabNameEl.textContent = 'All';
        if (clipTabPathEl) clipTabPathEl.textContent = '';
      } else {
        clipTabNameEl.textContent = '';
        if (clipTabPathEl) clipTabPathEl.textContent = '';
      }
      return;
    }
    // Sidebar header is derived exclusively from renderer state; avoid patching this from other modules.
    const lockedIconEl = document.createElement('span');
    lockedIconEl.className = 'sidebar-lock-icon';
    lockedIconEl.textContent = section.locked ? '🔒' : '🔓';

    const nameEl = document.createElement('span');
    nameEl.className = 'sidebar-tab-name';
    nameEl.textContent = section.name || section.id || '';

    clipTabNameEl.innerHTML = '';
    clipTabNameEl.appendChild(lockedIconEl);
    clipTabNameEl.appendChild(nameEl);
    if (clipTabPathEl) clipTabPathEl.textContent = section.exportPath || '';
  }

  function refreshSections() {
    syncSectionsFromTabs();
    tabsApi?.renderTabs?.();
    updateActiveSectionLabel();
    refreshSectionSelect();
  }

  function refreshClipList() {
    const prev = new Map((state.clips || []).map((c) => [c.id, c]));
    clipsApi?.renderClipList?.();
    // Preserve screenshots on any new clip instances added by renderClipList.
    state.clips = (state.clips || []).map((clip) => {
      if (Array.isArray(clip.screenshots)) return clip;
      const prevClip = prev.get(clip.id);
      if (prevClip && Array.isArray(prevClip.screenshots)) {
        return { ...clip, screenshots: prevClip.screenshots.slice() };
      }
      return clip;
    });
    refreshClipThumbnails();
  }

  function refreshClipThumbnails() {
    void renderClipThumbnails();
  }

  async function refreshEditor() {
    const activeSectionId = getActiveSectionId();
    const clip = resolveClipForSection(activeSectionId);
    if (!clip) {
      state.currentClipId = null;
      editorApi?.loadClipIntoEditor?.(null);
      if (screenshotBox) screenshotBox.innerHTML = '';
      updateEditorControls();
      return;
    }
    ensureCurrentClipSection(clip);
    state.currentClipId = clip.id;
    if (state.currentSectionId === null || state.currentSectionId === undefined) {
      state.currentSectionId = clip.sectionId;
    }
    refreshSectionSelect();
    editorApi?.loadClipIntoEditor?.(clip);
    const tabSchema = tabsApi?.getActiveTabSchema?.();
    const schema =
      (Array.isArray(tabSchema) && tabSchema.length ? tabSchema : null) ||
      (Array.isArray(clip?.schema) && clip.schema.length ? clip.schema : null) ||
      DEFAULT_SCHEMA;
    editorApi?.applySchemaVisibility?.(schema);
    const allowScreenshots = Array.isArray(schema) ? schema.includes('screenshots') : true;
    if (!allowScreenshots) {
      if (screenshotBox) {
        const row = screenshotBox.closest('.field-row');
        if (row) row.style.display = 'none';
        screenshotBox.innerHTML = '';
      }
    } else {
      if (screenshotBox) {
        const row = screenshotBox.closest('.field-row');
        if (row) row.style.display = '';
      }
      await renderEditorScreenshots(clip);
    }
    updateEditorControls();
  }

  async function handleAddScreenshot() {
    const clip = getCurrentClip();
    if (!clip) return;
    const displays = await api.listDisplays?.();
    if (!Array.isArray(displays) || displays.length === 0) return;
    const display = displays[0];
    const shot = await api.captureScreen?.(display?.id);
    const captures = Array.isArray(shot?.screenshots)
      ? shot.screenshots
      : shot?.dataUrl
      ? [{ dataUrl: shot.dataUrl, filename: shot.filename }]
      : [];
    if (!captures.length) return;
    const payload = captures
      .map((item) => ({
        dataUrl: item?.dataUrl,
        filename: item?.filename,
      }))
      .filter((item) => item.dataUrl);
    if (!payload.length) return;
    const savedFiles = await api.saveScreenshot?.(payload);
    const filenames =
      Array.isArray(savedFiles) && savedFiles.length
        ? savedFiles
            .map((item) => (item && typeof item.filename === 'string' ? item.filename : null))
            .filter(Boolean)
        : [];
    if (!filenames.length) return;
    clip.screenshots = Array.isArray(clip.screenshots) ? clip.screenshots : [];
    clip.screenshots.push(...filenames);
    normalizeClipScreenshots(clip);
    await api.saveClip?.(clip, { mirror: false });
    await refreshFull(clip.id);
  }

  const resolveNewClipSectionId = () => {
    const activeSection = getActiveSectionId();
    if (activeSection && activeSection !== 'all') return activeSection;
    if (state.currentSectionId && state.currentSectionId !== 'all') return state.currentSectionId;
    if (state.activeTabId && state.activeTabId !== 'all') return state.activeTabId;
    return 'inbox';
  };

  const readClipboardText = async () => {
    try {
      if (typeof api.getClipboardText === 'function') {
        const value = await api.getClipboardText();
        if (typeof value === 'string') return value;
      }
    } catch (err) {
      console.warn('[SnipBoard] Clipboard read via IPC failed', err);
    }
    try {
      if (navigator?.clipboard?.readText) {
        const value = await navigator.clipboard.readText();
        if (typeof value === 'string') return value;
      }
    } catch (err) {
      console.warn('[SnipBoard] Clipboard read via navigator failed', err);
    }
    return '';
  };

  async function createNewClip() {
    const sectionId = resolveNewClipSectionId();
    const clipboardText = await readClipboardText();
    const clip = {
      title: '',
      text: clipboardText,
      notes: '',
      tags: [],
      screenshots: [],
      sectionId,
      capturedAt: Date.now(),
    };
    try {
      const saved = (await api.saveClip?.(clip, { mirror: false })) || clip;
      const clipId = saved?.id || clip.id;
      if (!clipId) return;
      await refreshFull(clipId);
    } catch (err) {
      console.error('[SnipBoard] createNewClip failed', err);
    }
  }

  const sectionTabs = document.getElementById('sectionTabs');
  const addTabBtn = document.getElementById('addTabBtn');
  const clipList = document.getElementById('clipList');
  const sectionSelect = document.getElementById('sectionSelect');
  if (sectionSelect) {
    sectionSelect.onchange = () => {
      const clip = getCurrentClip();
      if (clip) {
        clip.sectionId = sectionSelect.value;
        state.currentSectionId = sectionSelect.value;
      }
    };
  }
  const clipTabNameEl = document.getElementById('clipTabName');
  const clipTabPathEl = document.getElementById('clipTabPath');

  const titleInput = document.getElementById('titleInput');
  const textInput = document.getElementById('textInput');
  const notesInput = document.getElementById('notesInput');
  const tagsInput = document.getElementById('tagsInput');
  const capturedAtInput = document.getElementById('capturedAtInput');
  const capturedAtInputs = Array.from(document.querySelectorAll('#capturedAtInput'));
  if (capturedAtInputs.length > 1) {
    capturedAtInputs.slice(1).forEach((node) => {
      const parentRow = node.closest('.field-row');
      if (parentRow && parentRow.parentNode) {
        parentRow.parentNode.removeChild(parentRow);
      } else if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
  }
  const sourceUrlInput = document.getElementById('sourceUrlInput');
  const sourceTitleInput = document.getElementById('sourceTitleInput');
  const screenshotBox = document.getElementById('screenshotContainer');
  if (screenshotBox) screenshotBox.classList.add('screenshots-container');

  const saveClipBtn = document.getElementById('saveClipBtn');
  const deleteClipBtn = document.getElementById('deleteClipBtn');
  const addShotBtn = document.getElementById('addShotBtn');
  const listAddBtn = document.getElementById('listAddBtn');

  const searchInput = document.getElementById('searchInput');
  const tagFilterInput = document.getElementById('tagFilterInput');
  const sortMenu = document.getElementById('sortMenu');
  const filterMenu = document.getElementById('filterMenu');
  const sortToggleBtn = document.getElementById('sortToggleBtn');
  const filterToggleBtn = document.getElementById('filterToggleBtn');
  const filterApplyBtn = document.getElementById('filterApplyBtn');
  const filterClearBtn = document.getElementById('filterClearBtn');

  function persistClipAppearance(entity, patch = {}) {
    if (!entity || !entity.id) return;
    const sanitized = sanitizeAppearancePatch(patch);
    if (typeof entity.sectionId === 'string') {
      const clip = { ...entity, ...sanitized };
      return api
        .saveClip?.(clip, { mirror: false })
        .then((saved) => {
          if (saved) {
            const normalized = sanitizeClipData(normalizeClip(saved));
            const idx = (state.clips || []).findIndex((item) => item.id === saved.id);
            if (idx !== -1) {
              state.clips[idx] = normalized;
            } else {
              state.clips.push(normalized);
            }
          }
          refreshClipList();
          void refreshEditor();
        })
        .catch((err) => {
          console.error('[SnipBoard] persistClipAppearance failed', err);
          window.SnipToast?.show?.('Failed to save appearance');
        });
    }
    return safeInvoke?.(CHANNELS.UPDATE_SECTION, { id: entity.id, patch: sanitized })
      .then((result) => {
        if (!result?.ok) return;
        const tab = (state.tabs || []).find((item) => item.id === entity.id);
        if (tab) Object.assign(tab, sanitized);
        syncSectionsFromTabs();
        refreshSections();
        refreshClipList();
      })
      .catch((err) => {
        console.error('[SnipBoard] persistClipAppearance failed', err);
        window.SnipToast?.show?.('Failed to save appearance');
      });
  }

  const updateSection = (id, patch) =>
    safeChannel?.(CHANNELS.UPDATE_SECTION, { id, patch });

  const renderSectionsBar = () => tabsApi?.renderTabs?.();

  const scheduleSaveTabsConfig = async () => {
    try {
      const payload = {
        tabs: state.tabs || [],
        activeTabId: state.activeTabId || 'all',
      };
      await safeChannel?.(CHANNELS.SAVE_TABS, payload);
    } catch (err) {
      console.warn('[SnipBoard] scheduleSaveTabsConfig failed', err);
    }
  };

  const modalsApi = initModals
    ? initModals({
        state,
        ipc: { CHANNELS, invoke, safeInvoke },
        dom: {},
        helpers: {
          persistClipAppearance,
          updateSection,
          renderSectionsBar,
          renderTabs: () => tabsApi?.renderTabs?.(),
          scheduleSaveTabsConfig,
          closeQuickMenus: () => {},
          commitRename: () => {},
          cancelRename: () => {},
        },
      })
    : null;

  const tabsApi = initTabs
    ? initTabs({
        state,
        ipc: { CHANNELS, invoke, safeInvoke },
        dom: { sectionTabs, addTabBtn },
      })
    : null;

  const clipsApi = initClips
    ? initClips({
        state,
        ipc: { CHANNELS, invoke, safeInvoke },
        dom: { clipListContainer: clipList },
      })
    : null;

  const editorApi = initEditor
    ? initEditor({
        state,
        ipc: { CHANNELS, invoke, safeInvoke },
        dom: {
          titleInput,
          textInput,
          notesInput,
          tagsInput,
          capturedAtInput,
          sourceUrlInput,
          sourceTitleInput,
          screenshotBox,
        },
        helpers: {
          normalizeClip,
          DEFAULT_SCHEMA,
        },
      })
    : null;

  if (tabsApi?.setEditorApi) tabsApi.setEditorApi(editorApi);
  if (clipsApi?.setEditorApi) clipsApi.setEditorApi(editorApi);
  if (tabsApi?.setModalsApi) tabsApi.setModalsApi(modalsApi);
  if (clipsApi?.setModalsApi) clipsApi.setModalsApi(modalsApi);

  tabsApi?.onTabChange?.((tab) => {
    screenshotUrlCache.clear();
    missingScreenshotSet.clear();
    state.activeTabId = tab?.id || 'all';
    state.currentSectionId = state.activeTabId;
    refreshSections();
    refreshClipList();
    refreshClipThumbnails();
    void refreshEditor();
  });

  clipsApi?.onClipSelected?.((clip) => {
    state.currentClipId = clip?.id || null;
    void refreshEditor();
  });

  const computeSignature = (clips = []) =>
    clips
      .map((clip) => `${clip.id}:${clip.updatedAt || clip.capturedAt || ''}`)
      .join('|');

  let lastSignature = '';

  const hydrateState = (payload = {}, selectedSectionId) => {
    const prevById = new Map((state.clips || []).map((clip) => [clip.id, clip]));
    const prevActive = selectedSectionId || state.activeTabId || state.currentSectionId;
    const prevClip = state.currentClipId;
    state.clips = (payload.clips || state.clips || [])
      .map((clip) => {
        const normalized = normalizeClip(clip);
        if (!Array.isArray(normalized.screenshots)) {
          const prev = prevById.get(normalized.id);
          if (prev && Array.isArray(prev.screenshots)) {
            normalized.screenshots = prev.screenshots.slice();
          }
        }
        return sanitizeClipData(normalized);
      });
    state.tabs = payload.tabs || state.tabs;
    const tabsList = state.tabs || [];
    const targetSection = selectedSectionId || prevActive;
    const hasPrev = tabsList.some((t) => t.id === targetSection);
    state.activeTabId =
      (hasPrev && targetSection) ||
      state.activeTabId ||
      payload.activeTabId ||
      tabsList[0]?.id ||
      'all';
    state.currentSectionId = state.activeTabId;
    state.searchIndex = updateSearchIndex(state.clips);
    lastSignature = computeSignature(state.clips);

    const activeSectionId = getActiveSectionId();
    const clips = state.clips || [];
    let nextClip = null;
    if (prevClip) {
      const prevClipObj = clips.find((c) => c.id === prevClip);
      if (prevClipObj && (activeSectionId === 'all' || prevClipObj.sectionId === activeSectionId)) {
        nextClip = prevClipObj;
      }
    }
    if (!nextClip) {
      nextClip = resolveClipForSection(activeSectionId);
    }
    state.currentClipId = nextClip ? nextClip.id : null;
    syncSectionsFromTabs();
    refreshSectionSelect();
  };

  const renderAll = () => {
    refreshSections();
    refreshClipList();
    void refreshEditor();
  };

  const refreshFull = (selectedClipId, selectedSectionId) => {
    // Single authoritative full refresh; preserves selection while hydrating from backend state.
    refreshFullQueue = refreshFullQueue.then(async () => {
      try {
        if (selectedClipId) {
          state.currentClipId = selectedClipId;
        }
        const targetSectionId =
          selectedSectionId || state.activeTabId || state.currentSectionId || 'all';
        const data = await api.getData?.();
        const tabsConfig = await safeChannel(CHANNELS.LOAD_TABS);
        const normalizedTabs = normalizeTabSchemas(tabsConfig?.tabs || state.tabs);
        hydrateState({
          clips: data?.clips,
          tabs: normalizedTabs,
          activeTabId: tabsConfig?.activeTabId,
        }, targetSectionId);
        if (selectedClipId) {
          const exists = (state.clips || []).some((clip) => clip.id === selectedClipId);
          if (exists) {
            state.currentClipId = selectedClipId;
          }
        }
        renderAll();
      } catch (err) {
        console.warn('[SnipBoard] refreshFull failed', err);
      } finally {
        updateEditorControls();
      }
    });
    refreshFullQueue = refreshFullQueue.catch(() => {});
    return refreshFullQueue;
  };

  window.SnipRenderer = {
    refreshSections,
    refreshClipList,
    refreshEditor,
    refreshClipThumbnails,
    updateActiveSectionLabel,
    getCurrentSection,
    getActiveSectionId,
    refreshFull,
    isSectionLocked: isCurrentSectionLocked,
  };

  const REFRESH_EVENT = 'snipboard:refresh-data';
  async function refreshClip(id) {
    if (!id) return;
    try {
      const payload = await safeChannel(CHANNELS.GET_DATA);
      const rawClip = (payload?.clips || []).find((item) => item.id === id);
      if (!rawClip) {
        state.clips = (state.clips || []).filter((item) => item.id !== id);
      } else {
      const normalized = sanitizeClipData(normalizeClip(rawClip));
        const idx = (state.clips || []).findIndex((item) => item.id === id);
        if (idx !== -1) {
          state.clips[idx] = normalized;
        } else {
          state.clips.push(normalized);
        }
        if (state.currentClipId === id) {
          await refreshEditor();
        }
      }
      refreshClipList();
    } catch (err) {
      console.warn('[SnipBoard] refreshClip failed', err);
    }
  }

  async function refreshSectionsFromBackend() {
    try {
      const tabsConfig = await safeChannel(CHANNELS.LOAD_TABS);
      state.tabs = normalizeTabSchemas(tabsConfig?.tabs || state.tabs);
      state.activeTabId = tabsConfig?.activeTabId || state.activeTabId;
      refreshSections();
      refreshClipList();
    } catch (err) {
      console.warn('[SnipBoard] refreshSections failed', err);
    }
  }

  document.addEventListener(REFRESH_EVENT, (event) => {
    const detail = event?.detail || {};
    if (detail?.type === 'clip' && detail?.id) {
      void refreshClip(detail.id);
      return;
    }
    if (detail?.type === 'section') {
      void refreshSectionsFromBackend();
      return;
    }
    void refreshFull();
  });

  const SECTIONS_UPDATED_EVENT = 'snipboard:sections-updated';
  document.addEventListener(SECTIONS_UPDATED_EVENT, () => {
    syncSectionsFromTabs();
    refreshSectionSelect();
  });

  const pollBackend = () => {
    setInterval(async () => {
      try {
        const payload = await safeChannel(CHANNELS.GET_DATA);
        const signature = computeSignature(payload?.clips || []);
        if (signature !== lastSignature) {
          hydrateState({ clips: payload?.clips });
          renderAll();
        }
      } catch (err) {
        console.warn('[SnipBoard] poll failed', err);
      }
    }, 3000);
  };

  const bindToolbar = () => {
    if (saveClipBtn) {
      saveClipBtn.addEventListener('click', () => editorApi?.saveClip?.());
    }
    if (deleteClipBtn) {
      deleteClipBtn.addEventListener('click', () => editorApi?.deleteClip?.());
    }
    if (addShotBtn) {
      addShotBtn.onclick = async () => {
        await handleAddScreenshot();
      };
    }
    if (listAddBtn) {
      listAddBtn.onclick = async () => {
        await createNewClip();
      };
    }
  };

  const bindFilters = () => {
    const closeMenus = () => {
      if (sortMenu) sortMenu.classList.remove('is-open');
      if (filterMenu) filterMenu.classList.remove('is-open');
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const value = searchInput.value.trim();
        state.searchQuery = value;
        state.searchText = value;
        clipsApi?.renderClipList?.();
      });
    }

    const applyTagFilter = () => {
      const value = tagFilterInput ? tagFilterInput.value.trim() : '';
      state.tagFilter = value;
      clipsApi?.renderClipList?.();
    };

    if (tagFilterInput) {
      tagFilterInput.addEventListener('input', applyTagFilter);
    }

    const handleSortChange = (value) => {
      state.sortMode = value || 'default';
      const selected = sortMenu?.querySelector(
        `input[name="sortMode"][value="${state.sortMode}"]`
      );
      if (selected) selected.checked = true;
      clipsApi?.renderClipList?.();
    };

    if (sortMenu) {
      const radios = Array.from(sortMenu.querySelectorAll('input[name="sortMode"]'));
      radios.forEach((radio) => {
        radio.addEventListener('change', () => {
          handleSortChange(radio.value);
          closeMenus();
        });
      });
      const initial = radios.find((radio) => radio.value === (state.sortMode || 'default')) || radios[0];
      if (initial) initial.checked = true;
    }

    if (filterApplyBtn) {
      filterApplyBtn.addEventListener('click', () => {
        applyTagFilter();
        closeMenus();
      });
    }

    if (filterClearBtn) {
      filterClearBtn.addEventListener('click', () => {
        if (tagFilterInput) tagFilterInput.value = '';
        state.tagFilter = '';
        clipsApi?.renderClipList?.();
        closeMenus();
      });
    }

    if (sortToggleBtn && sortMenu) {
      sortToggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !sortMenu.classList.contains('is-open');
        closeMenus();
        if (willOpen) sortMenu.classList.add('is-open');
      });
    }

    if (filterToggleBtn && filterMenu) {
      filterToggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !filterMenu.classList.contains('is-open');
        closeMenus();
        if (willOpen) filterMenu.classList.add('is-open');
      });
    }

    if (document) {
      document.addEventListener('click', (event) => {
        const target = event.target;
        const inSortMenu = sortMenu && (sortMenu === target || sortMenu.contains(target));
        const inFilterMenu = filterMenu && (filterMenu === target || filterMenu.contains(target));
        const onToggle =
          (sortToggleBtn && (sortToggleBtn === target || sortToggleBtn.contains(target))) ||
          (filterToggleBtn && (filterToggleBtn === target || filterToggleBtn.contains(target)));
        if (!inSortMenu && !inFilterMenu && !onToggle) {
          closeMenus();
        }
      });
    }
  };

  const init = async () => {
    await refreshFull();
    bindToolbar();
    bindFilters();
    editorApi?.bindEditorEvents?.();
    pollBackend();
  };

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') {
    init();
  }
})();
