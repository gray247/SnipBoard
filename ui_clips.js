(function (global) {
  let sharedClipMenu = null;
  let clipMenuHandlersBound = false;

  const hideSharedClipMenu = () => {
    if (!sharedClipMenu) return;
    sharedClipMenu.style.display = 'none';
    sharedClipMenu.removeAttribute('data-clip-id');
  };

  const handleSharedClipMenuKey = (event) => {
    if (event.key === 'Escape') {
      hideSharedClipMenu();
    }
  };

  const ensureSharedClipMenu = (doc) => {
    if (!doc) return null;
    if (!sharedClipMenu) {
      sharedClipMenu = doc.createElement('div');
      sharedClipMenu.className = 'context-menu';
      sharedClipMenu.innerHTML = `
        <ul>
          <li data-action="rename">Rename clip</li>
          <li data-action="icon">Change icon</li>
          <li data-action="color">Change color</li>
          <li data-action="delete" class="danger">Delete clip</li>
        </ul>
      `;
      doc.body?.appendChild(sharedClipMenu);
    }
    if (!clipMenuHandlersBound) {
      doc.addEventListener('click', hideSharedClipMenu);
      doc.addEventListener('scroll', hideSharedClipMenu, true);
      doc.addEventListener('keydown', handleSharedClipMenuKey);
      clipMenuHandlersBound = true;
    }
    return sharedClipMenu;
  };

  function initClips({ state = {}, dom = {} } = {}) {
    const app = state;
    const doc = global.document;
    const api = global.api || {};
    const clipListEl = dom.clipListContainer || (doc ? doc.getElementById('clipList') : null);
    const getRendererApi = () => global.SnipRenderer || {};
    const callRefreshClipList = () => getRendererApi().refreshClipList?.();
    const callRefreshEditor = () => getRendererApi().refreshEditor?.();
    const clipSelectedListeners = [];
    let editorApi = null;
    let modalsApi = null;
    let dragSourceId = null;

    const triggerGlobalRefresh = () => {
      modalsApi?.refreshData?.();
    };

    const createClipIconElement = (clip) => {
      if (!doc) return null;
      const choice = modalsApi?.findIconChoice?.(clip?.icon || "") || null;
      const glyph =
        modalsApi?.createIconGlyph?.(choice || clip?.icon || "") ||
        doc.createElement("span");
      if (!glyph.classList?.contains("icon-choice__glyph")) {
        glyph.classList?.add("icon-choice__glyph");
      }
      const wrapper = doc.createElement("span");
      wrapper.className = "clip-icon";
      wrapper.appendChild(glyph);
      return wrapper;
    };

    const getActiveSectionId = () => app.activeTabId || 'all';

    const setEditorApi = (apiRef) => {
      editorApi = apiRef;
    };

    const setModalsApi = (apiRef) => {
      modalsApi = apiRef;
    };

    const onClipSelected = (callback) => {
      if (typeof callback === 'function') clipSelectedListeners.push(callback);
    };

    const notifySelection = (clip) => {
      clipSelectedListeners.forEach((cb) => {
        try {
          cb(clip);
        } catch (err) {
          console.warn('[SnipClips] onClipSelected handler failed', err);
        }
      });
    };

    const reorderClips = (sourceId, targetId) => {
      const clips = app.clips || [];
      const sourceIndex = clips.findIndex((clip) => clip.id === sourceId);
      if (sourceIndex === -1) return;
      const targetIndex = clips.findIndex((clip) => clip.id === targetId);
      const [moved] = clips.splice(sourceIndex, 1);
      if (targetIndex === -1) {
        clips.push(moved);
      } else {
        clips.splice(targetIndex, 0, moved);
      }
    };

    const persistClip = async (clip) => {
      if (!clip) return;
      try {
        const saved = await (api.saveClip ? api.saveClip(clip) : Promise.resolve(clip));
        const normalized = saved || clip;
        const existingIndex = (app.clips || []).findIndex((item) => item.id === normalized.id);
        if (existingIndex !== -1) {
          app.clips[existingIndex] = normalized;
        } else {
          app.clips.push(normalized);
        }
        app.currentClipId = normalized.id;
        renderClipList();
        editorApi?.loadClipIntoEditor?.(normalized);
        callRefreshClipList();
        if (app.currentClipId === normalized.id) {
          callRefreshEditor();
        }
        triggerGlobalRefresh();
      } catch (err) {
        console.error('[SnipClips] persistClip failed', err);
      }
    };

    const deleteClip = async (clip) => {
      if (!clip) return;
      const question = `Delete clip "${clip.title || clip.id}"?`;
      const confirmed = await modalsApi?.openConfirmModal?.(question);
      if (!confirmed) return;
      try {
        const result = await (api.deleteClip ? api.deleteClip(clip.id) : Promise.resolve({ ok: true }));
        if (result?.blocked) {
          global.alert?.('Clip is in a locked section.');
          return;
        }
        app.clips = (app.clips || []).filter((item) => item.id !== clip.id);
        if (app.currentClipId === clip.id) {
          app.currentClipId = app.clips[0]?.id || null;
        }
        renderClipList();
        const nextClip = app.clips.find((item) => item.id === app.currentClipId) || null;
        editorApi?.loadClipIntoEditor?.(nextClip);
        callRefreshClipList();
        callRefreshEditor();
        triggerGlobalRefresh();
      } catch (err) {
        console.error('[SnipClips] deleteClip failed', err);
      }
    };

    const clipActions = {
      rename: (clip) => {
        modalsApi?.openRenameClipModal?.(clip, async (value) => {
          if (!value) return;
          clip.title = value;
          await persistClip(clip);
        });
      },
      icon: (clip) => {
        modalsApi?.openChangeClipIconModal?.(clip, async (value) => {
          if (!value) return;
          clip.icon = value;
          await persistClip(clip);
        });
      },
      color: (clip) => {
        modalsApi?.openChangeClipColorModal?.(clip, async (value) => {
          if (!value) return;
          clip.appearanceColor = value;
          clip.color = value;
          await persistClip(clip);
        });
      },
      delete: (clip) => {
        deleteClip(clip);
      },
    };

    const clipMenu = ensureSharedClipMenu(doc);

    const handleMenuClick = (event) => {
      event.stopPropagation();
      const action = event.target?.dataset?.action;
      if (!action) return;
      const clipId = clipMenu?.dataset?.clipId;
      const clip = (app.clips || []).find((item) => item.id === clipId);
      if (!clip) return;
      const handler = clipActions[action];
      if (handler) handler(clip);
      hideSharedClipMenu();
    };

    if (clipMenu) {
      if (clipMenu._handler) {
        clipMenu.removeEventListener('click', clipMenu._handler);
      }
      clipMenu._handler = handleMenuClick;
      clipMenu.addEventListener('click', handleMenuClick);
    }

    const showClipContextMenu = (clip, x, y) => {
      if (!clip || !clipMenu) return;
      clipMenu.dataset.clipId = clip.id;
      clipMenu.style.left = `${x}px`;
      clipMenu.style.top = `${y}px`;
      clipMenu.style.display = 'block';
    };

    const renderClipList = () => {
      if (!clipListEl) return;
      clipListEl.innerHTML = '';
      const clips = (app.clips || []).filter(
        (clip) => getActiveSectionId() === 'all' || clip.sectionId === getActiveSectionId()
      );
      clips.forEach((clip) => {
        if (!doc) return;
        const row = doc.createElement('div');
        row.className = 'clip-row';
        row.dataset.clipId = clip.id;
        row.draggable = true;

        if (clip.id === app.currentClipId) {
          row.classList.add('clip-row--active', 'active');
        }

        const checkbox = doc.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.clipId = clip.id;
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        row.appendChild(checkbox);
        const iconEl = createClipIconElement(clip);
        if (iconEl) {
          row.appendChild(iconEl);
        }

        const thumbContainer = doc.createElement('div');
        thumbContainer.className = 'clip-row__thumb';
        row.appendChild(thumbContainer);

        const title = doc.createElement('div');
        title.className = 'clip-row__title';
        title.textContent = clip.title || '(Untitled)';
        row.appendChild(title);

        row.addEventListener('click', () => {
          app.currentClipId = clip.id;
          notifySelection(clip);
          renderClipList();
        });

        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          showClipContextMenu(clip, event.clientX, event.clientY);
        });

        row.addEventListener('dragstart', () => {
          dragSourceId = clip.id;
          row.classList.add('clip-row--dragging');
        });

        row.addEventListener('dragend', () => {
          dragSourceId = null;
          row.classList.remove('clip-row--dragging');
        });

        row.addEventListener('dragover', (event) => {
          event.preventDefault();
          row.classList.add('clip-row--drop-target');
        });

        row.addEventListener('dragleave', () => {
          row.classList.remove('clip-row--drop-target');
        });

        row.addEventListener('drop', () => {
          if (dragSourceId && dragSourceId !== clip.id) {
            reorderClips(dragSourceId, clip.id);
          }
          row.classList.remove('clip-row--drop-target');
          renderClipList();
        });

        clipListEl.appendChild(row);
      });
    };

    if (clipListEl) {
      clipListEl.addEventListener('dragover', (event) => {
        if (dragSourceId) event.preventDefault();
      });

      clipListEl.addEventListener('drop', () => {
        if (dragSourceId) {
          dragSourceId = null;
          renderClipList();
        }
      });
    }

    return {
      renderClipList,
      onClipSelected,
      setEditorApi,
      setModalsApi,
    };
  }

  global.SnipClips = { initClips };
})(window);
