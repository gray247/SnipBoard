(function (global) {
  function initEditor({ state = {}, dom = {}, ipc = {}, helpers = {} } = {}) {
    const app = state;
    const getRendererApi = () => global.SnipRenderer || {};
    const callRefreshClipList = () => getRendererApi().refreshClipList?.();
    const callRefreshEditor = () => getRendererApi().refreshEditor?.();
    const {
      textInput,
      titleInput,
      notesInput,
      tagsInput,
      capturedAtInput,
      sourceUrlInput,
      sourceTitleInput,
      saveClipBtn,
      deleteClipBtn,
    } = dom;

    const { CHANNELS = {}, safeInvoke, invoke } = ipc;
    const executor = safeInvoke || invoke || (async () => {});
    const { validateText = (value) => (value || '').slice(0, 1000), validateUrl = (value) => value || '', DEFAULT_SCHEMA = [] } = helpers;

    const getCurrentClip = () => (app.clips || []).find((clip) => clip.id === app.currentClipId) || null;
    const isSectionLocked = () => {
      const renderer = getRendererApi();
      return renderer?.isSectionLocked?.() || false;
    };
    const getWrapper = (element) => (element && typeof element.closest === 'function' ? element.closest('div') : null);

    const applySchemaVisibility = (schema) => {
      const normalized = Array.isArray(schema) && schema.length ? schema : DEFAULT_SCHEMA;
      // Support case differences (e.g., SourceUrl/SourceTitle) without altering schema keys.
      const schemaSet = new Set(normalized);
      const schemaLower = new Set(normalized.map((f) => (typeof f === 'string' ? f.toLowerCase() : f)));
      const matches = (field) => schemaSet.has(field) || schemaLower.has(field.toLowerCase());
      const toggle = (element, field) => {
        if (!element) return;
        element.style.display = matches(field) ? '' : 'none';
      };
      toggle(getWrapper(titleInput), 'title');
      toggle(getWrapper(textInput), 'text');
      toggle(getWrapper(notesInput), 'notes');
      toggle(getWrapper(tagsInput), 'tags');
      toggle(getWrapper(capturedAtInput), 'capturedAt');
      const sourceUrlWrapper =
        (sourceUrlInput && sourceUrlInput.closest && sourceUrlInput.closest('.source-url')) ||
        (sourceUrlInput && sourceUrlInput.closest && sourceUrlInput.closest('.field-row')) ||
        (sourceUrlInput ? sourceUrlInput.parentElement : null);
      const sourceTitleWrapper =
        (sourceTitleInput && sourceTitleInput.closest && sourceTitleInput.closest('.source-title')) ||
        (sourceTitleInput && sourceTitleInput.closest && sourceTitleInput.closest('.field-row')) ||
        (sourceTitleInput ? sourceTitleInput.parentElement : null);
      toggle(sourceUrlWrapper, 'sourceUrl');
      toggle(sourceTitleWrapper, 'sourceTitle');
    };

    const normalizeTags = (input) => {
      if (Array.isArray(input)) {
        return input
          .map((tag) => (tag ? String(tag).trim() : ''))
          .filter(Boolean);
      }
      if (typeof input === 'string') {
        return input
          .split(',')
          .map((tag) => (tag ? tag.trim() : ''))
          .filter(Boolean);
      }
      return [];
    };

    const ensureScreenshots = (clip) => {
      if (!clip) return [];
      if (!Array.isArray(clip.screenshots)) {
        clip.screenshots = [];
      }
      clip.screenshots = clip.screenshots
        .map((shot) => (shot ? String(shot).trim() : ''))
        .filter(Boolean);
      return clip.screenshots;
    };

    const getEditorFieldValues = () => {
      const rawTags = tagsInput && tagsInput.value ? tagsInput.value : '';
      return {
        title: validateText(titleInput && titleInput.value ? titleInput.value : ''),
        text: validateText(textInput && textInput.value ? textInput.value : ''),
        notes: validateText(notesInput && notesInput.value ? notesInput.value : ''),
        tags: normalizeTags(rawTags),
        capturedAt: capturedAtInput && capturedAtInput.value ? capturedAtInput.value : '',
        sourceUrl: validateUrl(sourceUrlInput && sourceUrlInput.value ? sourceUrlInput.value : ''),
        sourceTitle: validateText(sourceTitleInput && sourceTitleInput.value ? sourceTitleInput.value : ''),
      };
    };

    const loadClipIntoEditor = (clip) => {
      const target = clip || getCurrentClip();
      if (!target) {
        [titleInput, textInput, notesInput, tagsInput, capturedAtInput, sourceUrlInput, sourceTitleInput].forEach((el) => {
          if (el) el.value = '';
        });
        return;
      }
      if (titleInput) titleInput.value = target.title || '';
      if (textInput) textInput.value = target.text || '';
      if (notesInput) notesInput.value = target.notes || '';
      if (tagsInput) {
        const normalizedTags = normalizeTags(target.tags);
        tagsInput.value = normalizedTags.join(', ');
      }
      if (capturedAtInput) capturedAtInput.value = target.capturedAt ? new Date(target.capturedAt).toISOString().slice(0, 16) : '';
      if (sourceUrlInput) sourceUrlInput.value = target.sourceUrl || '';
      if (sourceTitleInput) sourceTitleInput.value = target.sourceTitle || '';
      applySchemaVisibility(target.schema || []);
    };

    const showToast = (message) => {
      if (!message) return;
      if (global.SnipToast && typeof global.SnipToast.show === 'function') {
        global.SnipToast.show(message);
        return;
      }
      const toast = document.createElement('div');
      toast.className = 'sb-toast';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 2000);
    };

    const saveClip = async () => {
      const clip = getCurrentClip();
      if (!clip) {
        showToast('No clip selected.');
        return;
      }
      const values = getEditorFieldValues();
      if (values.sourceUrl && !values.sourceUrl.startsWith('http')) {
        showToast('Invalid URL.');
        return;
      }
      const tagsArray = normalizeTags(values.tags);
      values.tags = tagsArray;
      clip.title = String(values.title || '');
      clip.text = String(values.text || '');
      clip.notes = String(values.notes || '');
      clip.tags = values.tags;
      ensureScreenshots(clip);
      Object.assign(clip, values);
      try {
        await executor(CHANNELS.SAVE_CLIP, clip);
        showToast('Clip saved.');
        loadClipIntoEditor(clip);
        callRefreshClipList();
        callRefreshEditor();
      } catch (err) {
        console.error('[SnipEditor] saveClip failed', err);
        showToast('Failed to save clip.');
      }
    };

    const deleteClip = async () => {
      const clip = getCurrentClip();
      if (!clip) {
        showToast('No clip selected.');
        return;
      }
      if (isSectionLocked()) {
        showToast('Tab is locked: cannot delete clips.');
        return;
      }
      try {
        const deleteChannel = CHANNELS.DELETE_CLIP || 'delete-clip';
        await executor(deleteChannel, clip.id);
        showToast('Clip deleted.');
        app.clips = (app.clips || []).filter((item) => item.id !== clip.id);
        app.currentClipId = null;
        loadClipIntoEditor(null);
        callRefreshClipList();
        callRefreshEditor();
      } catch (err) {
        console.error('[SnipEditor] deleteClip failed', err);
        showToast('Failed to delete clip.');
      }
    };

    const bindEditorEvents = () => {
      if (saveClipBtn) saveClipBtn.onclick = (event) => {
        event.preventDefault();
        saveClip();
      };
      if (deleteClipBtn) deleteClipBtn.onclick = (event) => {
        event.preventDefault();
        deleteClip();
      };
      // Delegated handler for opening source URL; uses stable data-action hook to avoid layout-dependent selectors.
      document.addEventListener('click', (event) => {
        const btn = event.target?.closest?.('[data-action="open-source-url"]');
        if (!btn) return;
        event.preventDefault();
        if (!sourceUrlInput) return;
        const url = validateUrl(sourceUrlInput.value || '');
        if (!url) return;
        if (global.api?.openUrl) {
          global.api.openUrl(url);
        } else if (executor) {
          executor(CHANNELS.OPEN_URL || 'open-url', url);
        }
      });
      if (textInput) {
        textInput.addEventListener('dragover', (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        });
        textInput.addEventListener('drop', (event) => {
          event.preventDefault();
          const dt = event.dataTransfer;
          const clipId = dt?.getData('application/x-snipboard-clip-id') || '';
          const clip = (app.clips || []).find((c) => c.id === clipId);
          const titleLine = clip?.title || '(Untitled)';
          const body = clip?.text || dt?.getData('text/plain') || '';
          const payload = `---\n${titleLine}\n${body}\n---\n`;
          const input = textInput;
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          const before = input.value.slice(0, start);
          const after = input.value.slice(end);
          input.value = `${before}${payload}${after}`;
          const cursor = start + payload.length;
          input.selectionStart = input.selectionEnd = cursor;
          input.focus();
        });
      }
    };

    return {
      loadClipIntoEditor,
      applySchemaVisibility,
      bindEditorEvents,
      getEditorFieldValues,
      saveClip,
      deleteClip,
    };
  }

  global.SnipEditor = { initEditor };
})(window);
