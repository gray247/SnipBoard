(() => {
  const api = window.api || {};
  const {
    AppState,
    DEFAULT_SCHEMA,
    normalizeClip,
    updateSearchIndex,
    sectionLabel,
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

  const getCurrentClip = () =>
    state.clips.find((clip) => clip.id === state.currentClipId) || null;

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
      const url = await api.getScreenshotUrl?.(filename);
      if (!url) {
        if (!missingScreenshotSet.has(filename)) {
          console.warn('Missing screenshot:', filename);
          missingScreenshotSet.add(filename);
        }
        screenshotUrlCache.set(filename, null);
        return null;
      }
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
      thumb.appendChild(img);

      thumb.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', thumb.dataset.file);
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
    const url = await api.getScreenshotUrl?.(filename);
    if (!url) {
      console.warn('No URL for screenshot', filename);
      return;
    }
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

  function getCurrentSection() {
    const sectionId = state.currentSectionId || state.activeTabId || 'all';
    return (state.sections || []).find((sec) => sec.id === sectionId) || null;
  }

  function updateActiveSectionLabel() {
    if (!clipTabNameEl) return;
    const section = getCurrentSection();
    if (!section) {
      clipTabNameEl.textContent = '';
      if (clipTabPathEl) clipTabPathEl.textContent = '';
      return;
    }
    clipTabNameEl.textContent = section.name || section.id || '';
    if (clipTabPathEl) {
      clipTabPathEl.textContent = section.exportPath || '';
    }
  }

  function refreshSections() {
    syncSectionsFromTabs();
    tabsApi?.renderTabs?.();
    updateActiveSectionLabel();
    refreshSectionSelect();
  }

  function refreshClipList() {
    clipsApi?.renderClipList?.();
    refreshClipThumbnails();
  }

  function refreshClipThumbnails() {
    void renderClipThumbnails();
  }

  async function refreshEditor() {
    const clip =
      state.clips.find((item) => item.id === state.currentClipId) ||
      state.clips[0] ||
      null;
    if (!clip) {
      editorApi?.loadClipIntoEditor?.(null);
      if (screenshotBox) screenshotBox.innerHTML = '';
      return;
    }
    ensureCurrentClipSection(clip);
    state.currentClipId = clip.id;
    state.currentSectionId = clip.sectionId;
    refreshSectionSelect();
    editorApi?.loadClipIntoEditor?.(clip);
    const schema =
      tabsApi?.getActiveTabSchema?.() || clip?.schema || DEFAULT_SCHEMA;
    editorApi?.applySchemaVisibility?.(schema);
    await renderEditorScreenshots(clip);
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

  async function createNewClip() {
    const clip = {
      title: '',
      text: '',
      notes: '',
      tags: [],
      screenshots: [],
      sectionId: state.currentSectionId || state.activeTabId || 'inbox',
      capturedAt: Date.now(),
    };
    try {
      const saved = (await api.saveClip?.(clip)) || clip;
      const clipId = saved?.id || clip.id;
      if (!clipId) return;
      await refreshFull(clipId);
    } catch (err) {
      console.error('[SnipBoard] createNewClip failed', err);
    }
  }

  const sectionTabs = document.getElementById('sectionTabs');
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

  const modalsApi = initModals
    ? initModals({
        state,
        ipc: { CHANNELS, invoke, safeInvoke },
        dom: {},
      })
    : null;

  const tabsApi = initTabs
    ? initTabs({
        state,
        ipc: { CHANNELS, invoke, safeInvoke },
        dom: { sectionTabs },
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

  const hydrateState = (payload = {}) => {
    state.clips = (payload.clips || state.clips || [])
      .map(normalizeClip)
      .map((clip) => sanitizeClipData(clip));
    state.tabs = payload.tabs || state.tabs;
    state.activeTabId =
      payload.activeTabId || state.activeTabId || state.tabs[0]?.id || 'all';
    state.currentSectionId = state.activeTabId;
    state.searchIndex = updateSearchIndex(state.clips);
    lastSignature = computeSignature(state.clips);
    state.currentClipId = state.currentClipId || state.clips[0]?.id || null;
    syncSectionsFromTabs();
    refreshSectionSelect();
  };

  const renderAll = () => {
    refreshSections();
    refreshClipList();
    void refreshEditor();
  };

  const refreshFull = async (selectedClipId) => {
    try {
      if (selectedClipId) {
        state.currentClipId = selectedClipId;
      }
      const data = await api.getData?.();
      const tabsConfig = await safeChannel(CHANNELS.LOAD_TABS);
      hydrateState({
        clips: data?.clips,
        tabs: tabsConfig?.tabs,
        activeTabId: tabsConfig?.activeTabId,
      });
      if (selectedClipId) {
        const exists = (state.clips || []).some((clip) => clip.id === selectedClipId);
        if (exists) {
          state.currentClipId = selectedClipId;
        }
      }
      renderAll();
    } catch (err) {
      console.warn('[SnipBoard] refreshFull failed', err);
    }
  };

  window.SnipRenderer = {
    refreshSections,
    refreshClipList,
    refreshEditor,
    refreshClipThumbnails,
    updateActiveSectionLabel,
    getCurrentSection,
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
      state.tabs = tabsConfig?.tabs || state.tabs;
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
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value.trim();
        clipsApi?.renderClipList?.();
      });
    }
    if (tagFilterInput) {
      tagFilterInput.addEventListener('input', () => {
        state.tagFilter = tagFilterInput.value.trim();
        clipsApi?.renderClipList?.();
      });
    }
    if (sortMenu) {
      sortMenu.addEventListener('change', () => {
        state.sortMode = sortMenu.value || 'default';
        clipsApi?.renderClipList?.();
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
