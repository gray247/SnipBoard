(function (global) {
  let tabMenuHandlersBound = false;
  let dragHandlersBound = false;
  let dragSourceTabId = null;

  function initTabs({ state = {}, dom = {}, ipc = {} } = {}) {
    const app = state;
    const doc = global.document;
    const sectionTabs = dom.sectionTabs || (doc ? doc.getElementById('sectionTabs') : null);
    const addTabBtn = dom.addTabBtn || (doc ? doc.getElementById('addTabBtn') : null);
    const tabContextMenu = dom.tabContextMenu || (doc ? doc.getElementById('tabContextMenu') : null);
    const tabChangeListeners = [];
    const CHANNELS = (ipc && ipc.CHANNELS) || {};
    const safeInvoke = ipc?.safeInvoke || ipc?.invoke || (async () => {});
    const SECTION_UPDATED_EVENT = 'snipboard:sections-updated';
    const getRendererApi = () => global.SnipRenderer || {};
    const callRefreshSections = () => getRendererApi().refreshSections?.();
    const callRefreshClipList = () => getRendererApi().refreshClipList?.();
    const callRefreshEditor = () => getRendererApi().refreshEditor?.();
    const notifySectionUpdate = () => {
      const renderer = getRendererApi();
      const activeSection =
        renderer?.getActiveSectionId?.() ||
        app.activeTabId ||
        app.currentSectionId ||
        'all';
      if (renderer?.refreshFull) {
        renderer.refreshFull(undefined, activeSection);
      } else {
        const EventCtor = global.CustomEvent || global.Event;
        if (doc && EventCtor) {
          const event = new EventCtor('snipboard:refresh-data', {
            detail: { type: 'section', id: activeSection },
          });
          doc.dispatchEvent(event);
        }
        dispatchSectionsUpdated();
      }
    };

    const cleanSectionName = (value) => {
      if (value === null || value === undefined) return '';
      return String(value).trim().slice(0, 100);
    };

    const persistTabsConfig = async () => {
      try {
        await safeInvoke(CHANNELS.SAVE_TABS, {
          tabs: app.tabs || [],
          activeTabId: app.activeTabId || 'all',
        });
        return true;
      } catch (err) {
        console.error('[SnipTabs] save tabs failed', err);
        global.alert?.('Unable to save tabs.');
        return false;
      }
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
    const DEFAULT_SCHEMA =
      (Array.isArray(global.SnipState?.DEFAULT_SCHEMA) && global.SnipState.DEFAULT_SCHEMA.length
        ? global.SnipState.DEFAULT_SCHEMA
        : []);
    const slugifyTabName =
      typeof global.SnipState?.slugifyTabName === 'function'
        ? global.SnipState.slugifyTabName
        : (value) => {
            const base = (value || 'tab').toString().toLowerCase().trim();
            const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            return slug || 'tab';
          };

    let editorApi = null;
    let modalsApi = null;

    const setEditorApi = (api) => {
      editorApi = api;
    };

    const setModalsApi = (api) => {
      modalsApi = api;
    };

    const promptForTabName = async () => {
      if (modalsApi?.openPromptModal) {
        return modalsApi.openPromptModal('Create new tab', '');
      }
      if (typeof global.prompt === 'function') {
        return global.prompt('Create new tab', '') || '';
      }
      return '';
    };

    const createTab = async () => {
      const response = await promptForTabName();
      const name = cleanSectionName(response);
      if (!name) return;
      try {
        const created = await safeInvoke(CHANNELS.CREATE_SECTION, name);
        const tabId = (created && created.id) || slugifyTabName(name);
        const schema =
          Array.isArray(created?.schema) && created.schema.length
            ? created.schema
            : DEFAULT_SCHEMA.slice();
        const newTab = {
          id: tabId,
          label: created?.name || name,
          name: created?.name || name,
          locked: Boolean(created?.locked),
          exportPath: created?.exportPath || '',
          exportFolder: created?.folder || created?.exportPath || '',
          color: created?.color || '',
          icon: created?.icon || '',
          order: Array.isArray(app.tabs) ? app.tabs.length : 0,
          schema,
          clipOrder: [],
        };
        app.tabs = [...(app.tabs || []), newTab];
        renderTabs();
        setActiveTab(newTab.id);
        const savedTabs = await persistTabsConfig();
        if (!savedTabs) return;
        notifySectionUpdate();
      } catch (err) {
        console.error('[SnipTabs] create tab failed', err);
        global.alert?.('Unable to create tab.');
      }
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

    const toggleTabLock = async (tab) => {
      if (!tab) return;
      try {
        const result = await safeInvoke(CHANNELS.SET_SECTION_LOCKED, {
          id: tab.id,
          locked: !tab.locked,
        });
        if (!result?.ok) {
          global.alert?.(result?.error || 'Unable to update lock state.');
          return;
        }
        tab.locked = !tab.locked;
        renderTabs();
        const persisted = await persistTabsConfig();
        if (!persisted) return;
        notifySectionUpdate();
      } catch (err) {
        console.error('[SnipTabs] lock toggle failed', err);
      }
    };

    const handleTabContextAction = async (action, sectionId) => {
      if (!action || !sectionId) return;
      const tab = (app.tabs || []).find((item) => item.id === sectionId);
      if (!tab) return;
      if (action === 'schema') {
        modalsApi?.openConfigureFieldsModal?.(tab, async (schema) => {
          const nextSchema = Array.isArray(schema) && schema.length ? schema : tab.schema;
          tab.schema = nextSchema;
          const savedTabs = await persistTabsConfig();
          if (!savedTabs) return;
          notifySectionUpdate();
        });
      } else if (action === 'rename') {
        modalsApi?.openRenameSectionModal?.(tab, async (newName) => {
          const cleaned = cleanSectionName(newName);
          if (!cleaned) return;
          tab.name = cleaned;
          tab.label = tab.name;
          const savedTabs = await persistTabsConfig();
          if (!savedTabs) return;
          const persisted = await persistSectionOrder();
          if (!persisted) return;
          notifySectionUpdate();
        });
      } else if (action === 'color') {
        modalsApi?.openChangeClipColorModal?.(tab, {
          section: true,
          onSave: async (color) => {
            tab.color = color || '';
            const savedTabs = await persistTabsConfig();
            if (!savedTabs) return;
            notifySectionUpdate();
          },
        });
      } else if (action === 'icon') {
        modalsApi?.openChangeClipIconModal?.(tab, {
          section: true,
          onSave: async (icon) => {
            tab.icon = icon || '';
            const savedTabs = await persistTabsConfig();
            if (!savedTabs) return;
            notifySectionUpdate();
          },
        });
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
          renderTabs();
          const persisted = await persistTabsConfig();
          if (!persisted) return;
          notifySectionUpdate();
        } catch (err) {
          console.error('[SnipTabs] lock toggle failed', err);
        }
      } else if (action === 'delete') {
        if (tab.locked) {
          global.SnipToast?.show?.('Tab is locked: cannot delete section.');
          return;
        }
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
      const schemaItem = tabContextMenu.querySelector('[data-action="schema"]');
      if (schemaItem) {
        schemaItem.classList.remove('disabled');
        schemaItem.style.display = '';
        schemaItem.removeAttribute('aria-hidden');
      }
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

    const bindCreateTabButton = () => {
      if (!addTabBtn) return;
      addTabBtn.addEventListener('click', (event) => {
        event.preventDefault();
        createTab();
      });
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

      if (addTabBtn) {
        sectionTabs.appendChild(addTabBtn);
      }

      const renderButton = (tab, isAll = false) => {
        const el = doc ? doc.createElement('button') : null;
        if (!el) return null;
        el.type = 'button';
        el.className = 'section-pill';
        if ((isAll && getActiveTabId() === 'all') || (!isAll && tab && tab.id === getActiveTabId())) {
          el.classList.add('section-pill--active');
        }
        const content = doc.createElement('span');
        content.className = 'section-pill__content';
        if (!isAll) {
          const iconChoice =
            modalsApi?.findIconChoice?.(tab?.icon) ||
            tab?.icon ||
            '';
          let glyph = null;
          if (typeof modalsApi?.createIconGlyph === 'function') {
            glyph = modalsApi.createIconGlyph(iconChoice);
          }
          const iconWrapper = doc.createElement('span');
          iconWrapper.className = 'section-pill__icon';
          if (glyph) {
            glyph.classList?.add('section-pill__icon-glyph');
            iconWrapper.appendChild(glyph);
          } else if (typeof iconChoice === 'string' && iconChoice) {
            iconWrapper.textContent = iconChoice;
          }
          content.appendChild(iconWrapper);
        }
        const labelText = doc.createElement('span');
        labelText.textContent = isAll ? 'All' : tab.label || tab.name || tab.id || 'Tab';
        content.appendChild(labelText);

        const lockedState = !isAll && tab ? Boolean(tab.locked) : false;
        const lockEl = doc.createElement('span');
        lockEl.className = 'section-pill__lock';
        const lockIcon = lockedState ? '🔒' : '🔓';
        lockEl.textContent = lockIcon;
        lockEl.dataset.icon = lockIcon;
        lockEl.setAttribute('aria-label', lockedState ? 'Locked section' : 'Unlocked section');
        lockEl.dataset.locked = lockedState ? 'true' : 'false';
        if (!isAll && tab) {
          lockEl.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleTabLock(tab);
          });
        }
        content.appendChild(lockEl);

        if (lockedState) {
          el.classList.add('section-pill--locked');
        } else {
          el.classList.remove('section-pill--locked');
        }
        if (!isAll && tab?.color) {
          el.classList.add('section-pill--colored');
          el.style.setProperty('background-color', tab.color);
          el.style.setProperty('border-color', tab.color);
        }

        el.appendChild(content);
        el.dataset.sectionId = isAll ? 'all' : tab.id;
        el.draggable = !isAll;
        el.onclick = () => setActiveTab(el.dataset.sectionId);
        if (!isAll) {
          el.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
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
    bindCreateTabButton();

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
