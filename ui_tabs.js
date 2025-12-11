(function (global) {
  let tabMenuHandlersBound = false;
  let dragHandlersBound = false;
  let dragSourceTabId = null;

  function initTabs({ state = {}, dom = {}, ipc = {} } = {}) {
    const app = state;
    const doc = global.document;
    const sectionTabs = dom.sectionTabs || (doc ? doc.getElementById('sectionTabs') : null);
    const tabContextMenu = dom.tabContextMenu || (doc ? doc.getElementById('tabContextMenu') : null);
    const tabChangeListeners = [];
    const CHANNELS = (ipc && ipc.CHANNELS) || {};
    const safeInvoke = ipc?.safeInvoke || ipc?.invoke || (async () => {});
    const SECTION_UPDATED_EVENT = 'snipboard:sections-updated';
    const getRendererApi = () => global.SnipRenderer || {};
    const callRefreshSections = () => getRendererApi().refreshSections?.();
    const callRefreshClipList = () => getRendererApi().refreshClipList?.();
    const callRefreshEditor = () => getRendererApi().refreshEditor?.();
    const sanitizePromptValue = (value) => {
      if (value === null || value === undefined) return '';
      return String(value).trim().slice(0, 100);
    };
    const notifySectionUpdate = () => {
      callRefreshSections();
      callRefreshClipList();
      dispatchSectionsUpdated();
      modalsApi?.refreshData?.();
    };

    const cleanSectionName = (value) => {
      if (value === null || value === undefined) return '';
      return String(value).trim().slice(0, 100);
    };

    const persistSectionOrder = async () => {
      const payload = (app.tabs || []).map((tab) => ({
        id: tab.id,
        name: tab.label || tab.name || tab.id,
      }));
      try {
        const result = await safeInvoke(CHANNELS.SAVE_SECTION_ORDER, payload);
        if (result?.ok === false) {
          global.alert?.(result.error || 'Failed to save section order.');
          return false;
        }
        return true;
      } catch (err) {
        console.warn('[SnipTabs] persistSectionOrder failed', err);
        return false;
      }
    };

    const dispatchSectionsUpdated = () => {
      if (!doc) return;
      const EventCtor = global.CustomEvent || global.Event;
      if (!EventCtor) return;
      const event = new EventCtor(SECTION_UPDATED_EVENT);
      doc.dispatchEvent(event);
    };

    const getActiveTabId = () => app.activeTabId || 'all';
    const getActiveTab = () => (app.tabs || []).find((tab) => tab.id === getActiveTabId()) || null;
    const getActiveTabSchema = () => {
      const tab = getActiveTab();
      return tab && Array.isArray(tab.schema) && tab.schema.length ? tab.schema : [];
    };

    let editorApi = null;
    let modalsApi = null;

    const setEditorApi = (api) => {
      editorApi = api;
    };

    const setModalsApi = (api) => {
      modalsApi = api;
    };

    const onTabChange = (callback) => {
      if (typeof callback === 'function') tabChangeListeners.push(callback);
    };

    const notifyTabChange = () => {
      const active = getActiveTab();
      tabChangeListeners.forEach((cb) => {
        try {
          cb(active);
        } catch (err) {
          console.warn('[SnipTabs] onTabChange handler failed', err);
        }
      });
    };

    const hideTabContextMenu = () => {
      if (!tabContextMenu) return;
      tabContextMenu.classList.remove('open');
      tabContextMenu.removeAttribute('data-section-id');
      tabContextMenu.style.display = 'none';
    };

    const handleTabMenuKey = (event) => {
      if (event.key === 'Escape') hideTabContextMenu();
    };

    const handleTabContextAction = async (action, sectionId) => {
      if (!action || !sectionId) return;
      const tab = (app.tabs || []).find((item) => item.id === sectionId);
      if (!tab) return;
      if (action === 'rename') {
        modalsApi?.openRenameSectionModal?.(tab, async (newName) => {
          const cleaned = cleanSectionName(newName);
          if (!cleaned) return;
          tab.label = cleaned;
          const persisted = await persistSectionOrder();
          if (!persisted) return;
          notifySectionUpdate();
        });
      } else if (action === 'color') {
        const raw = await modalsApi?.openPromptModal?.(
          'Section color (e.g. #ffcc00)',
          tab.color || ''
        );
        const cleaned = sanitizePromptValue(raw);
        if (!cleaned) return;
        try {
          const result = await safeInvoke(CHANNELS.UPDATE_SECTION, {
            id: tab.id,
            patch: { color: cleaned },
          });
          if (!result?.ok) {
            global.alert?.(result?.error || 'Unable to change section color.');
            return;
          }
          tab.color = cleaned;
          notifySectionUpdate();
        } catch (err) {
          console.error('[SnipTabs] color update failed', err);
        }
      } else if (action === 'icon') {
        const raw = await modalsApi?.openPromptModal?.(
          'Section icon (emoji or short code)',
          tab.icon || ''
        );
        const cleaned = sanitizePromptValue(raw);
        if (!cleaned) return;
        try {
          const result = await safeInvoke(CHANNELS.UPDATE_SECTION, {
            id: tab.id,
            patch: { icon: cleaned },
          });
          if (!result?.ok) {
            global.alert?.(result?.error || 'Unable to change section icon.');
            return;
          }
          tab.icon = cleaned;
          notifySectionUpdate();
        } catch (err) {
          console.error('[SnipTabs] icon update failed', err);
        }
      } else if (action === 'folder') {
        try {
          const folderResult = await safeInvoke(CHANNELS.CHOOSE_EXPORT_FOLDER);
          if (!folderResult?.ok || !folderResult.path) return;
          const result = await safeInvoke(CHANNELS.SET_SECTION_EXPORT_PATH, {
            id: tab.id,
            exportPath: folderResult.path,
          });
          if (!result?.ok) {
            global.alert?.(result?.error || 'Unable to update export folder.');
            return;
          }
          tab.exportPath = folderResult.path;
          notifySectionUpdate();
        } catch (err) {
          console.error('[SnipTabs] folder update failed', err);
        }
      } else if (action === 'lock') {
        try {
          const targetLocked = !tab.locked;
          const result = await safeInvoke(CHANNELS.SET_SECTION_LOCKED, {
            id: tab.id,
            locked: targetLocked,
          });
          if (!result?.ok) {
            global.alert?.(result?.error || 'Unable to update lock state.');
            return;
          }
          tab.locked = targetLocked;
          notifySectionUpdate();
        } catch (err) {
          console.error('[SnipTabs] lock toggle failed', err);
        }
      } else if (action === 'delete') {
        const confirmed = await modalsApi?.openConfirmModal?.(
          `Delete section "${tab.label || tab.id}"?`
        );
        if (!confirmed) {
          return;
        }
        try {
          const result = await safeInvoke(CHANNELS.DELETE_SECTION, tab.id);
          if (!result?.ok) {
            global.alert?.(result?.error || 'Unable to delete section.');
            return;
          }
          app.tabs = (app.tabs || []).filter((item) => item.id !== tab.id);
          if (app.activeTabId === tab.id) {
            app.activeTabId = 'all';
            app.currentSectionId = 'all';
            callRefreshEditor();
          }
          callRefreshSections();
          callRefreshClipList();
          dispatchSectionsUpdated();
        } catch (err) {
          console.error('[SnipTabs] delete section failed', err);
          global.alert?.('Failed to delete section.');
        }
      }
    };

    const handleTabMenuClick = (event) => {
      event.stopPropagation();
      const action = event.target?.dataset?.action;
      const sectionId = tabContextMenu?.dataset?.sectionId;
      if (!action) return;
      handleTabContextAction(action, sectionId);
      hideTabContextMenu();
    };

    const ensureTabMenuHandlers = () => {
      if (tabMenuHandlersBound || !tabContextMenu || !doc) return;
      tabContextMenu.addEventListener('click', handleTabMenuClick);
      doc.addEventListener('click', (event) => {
        if (!tabContextMenu?.contains(event.target)) hideTabContextMenu();
      });
      doc.addEventListener('keydown', handleTabMenuKey);
      tabMenuHandlersBound = true;
    };

    const showTabContextMenu = (tab, x, y) => {
      if (!tabContextMenu || !tab) return;
      tabContextMenu.dataset.sectionId = tab.id;
      tabContextMenu.style.left = `${x}px`;
      tabContextMenu.style.top = `${y}px`;
      tabContextMenu.classList.add('open');
      tabContextMenu.style.display = 'block';
    };

    const reorderTabs = async (sourceId, targetId) => {
      const tabs = app.tabs || [];
      const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
      if (sourceIndex === -1) return;
      const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
      const [moved] = tabs.splice(sourceIndex, 1);
      if (targetIndex === -1) {
        tabs.push(moved);
      } else {
        tabs.splice(targetIndex, 0, moved);
      }
      tabs.forEach((tab, index) => {
        tab.order = index;
      });
      callRefreshSections();
      try {
        await safeInvoke(
          CHANNELS.SAVE_SECTION_ORDER,
          tabs.map((tab) => ({ id: tab.id, name: tab.label || tab.name || tab.id }))
        );
      } catch (err) {
        console.warn('[SnipTabs] save section order failed', err);
      }
      callRefreshClipList();
      dispatchSectionsUpdated();
    };

    const handleTabDragStart = (event) => {
      const target = event.target?.closest?.('button.section-pill');
      const id = target?.dataset?.sectionId;
      if (!id || id === 'all') return;
      dragSourceTabId = id;
      target?.classList.add('section-pill--dragging');
      event.dataTransfer?.setData('text/plain', id);
    };

    const handleTabDragOver = (event) => {
      if (!dragSourceTabId) return;
      event.preventDefault();
    };

    const handleTabDrop = (event) => {
      if (!dragSourceTabId) return;
      event.preventDefault();
      const target = event.target?.closest?.('button.section-pill');
      const targetId = target?.dataset?.sectionId;
      if (!targetId || targetId === 'all' || targetId === dragSourceTabId) {
        dragSourceTabId = null;
        return;
      }
      reorderTabs(dragSourceTabId, targetId);
      dragSourceTabId = null;
    };

    const bindDragHandlers = () => {
      if (!sectionTabs || dragHandlersBound) return;
      sectionTabs.addEventListener('dragstart', handleTabDragStart);
      sectionTabs.addEventListener('dragover', handleTabDragOver);
      sectionTabs.addEventListener('drop', handleTabDrop);
      dragHandlersBound = true;
    };

    const setActiveTab = (tabId) => {
      const targetId = tabId || 'all';
      if (app.activeTabId === targetId) return;
      app.activeTabId = targetId;
      app.currentSectionId = targetId;
      const schema = getActiveTabSchema();
      editorApi?.applySchemaVisibility?.(schema);
      callRefreshSections();
      callRefreshClipList();
      callRefreshEditor();
      notifyTabChange();
    };

    const renderTabs = () => {
      if (!sectionTabs) return;
      sectionTabs.innerHTML = '';

      const renderButton = (tab, isAll = false) => {
        const el = doc ? doc.createElement('button') : null;
        if (!el) return null;
        el.type = 'button';
        el.className = 'section-pill';
        if ((isAll && getActiveTabId() === 'all') || (!isAll && tab && tab.id === getActiveTabId())) {
          el.classList.add('section-pill--active');
        }
        el.textContent = isAll ? 'All' : tab.label || tab.name || tab.id || 'Tab';
        el.dataset.sectionId = isAll ? 'all' : tab.id;
        el.draggable = !isAll;
        el.onclick = () => setActiveTab(el.dataset.sectionId);
        if (!isAll) {
          el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            showTabContextMenu(tab, event.clientX, event.clientY);
          });
        }
        return el;
      };

      const allButton = renderButton(null, true);
      if (allButton) sectionTabs.appendChild(allButton);

      (app.tabs || []).forEach((tab) => {
        const tabEl = renderButton(tab);
        if (tabEl) sectionTabs.appendChild(tabEl);
      });
    };

    ensureTabMenuHandlers();
    bindDragHandlers();

    return {
      getActiveTab,
      getActiveTabSchema,
      getActiveTabId,
      onTabChange,
      setEditorApi,
      setModalsApi,
      renderTabs,
    };
  }

  global.SnipTabs = { initTabs };
})(window);
