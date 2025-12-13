(function (global) {
  /**
   * SnipBoard Module: modals.js
   *
   * Responsibilities:
   *  - Manage modal dialogs (icon/color pickers, rename, screenshot preview).
   *  - Wire modal buttons to provided helpers/state.
   *  - Provide lightweight toast notifications (SnipToast).
   *
   * Exports:
   *  - window.SnipModals.initModals (returns modal API methods).
   *  - window.SnipToast (success/error toast helpers).
   *
   * Does NOT handle:
   *  - Core state management or data persistence.
   *  - Rendering tabs/clips/editor contents.
   *
   * Dependencies:
   *  - SnipIPC invoke for persistence.
   *  - DOM elements passed in via renderer bootstrap.
   *
   * Notes:
   *  - Interacts with IPC channels for saving sections/clip appearance.
   *  - Assumes renderer.js initializes and injects dependencies.
   */
  function initModals({ state, ipc, dom, helpers }) {
    const { invoke, CHANNELS } = ipc || {};
    const {
      iconModal = document.getElementById("iconModal"),
      iconChoicesContainer = document.getElementById("iconChoices"),
      iconSaveBtn = document.getElementById("iconSaveBtn"),
      iconCancelBtn = document.getElementById("iconCancelBtn"),
      colorModal = document.getElementById("colorModal"),
      colorSwatches = document.getElementById("colorSwatches"),
      colorSaveBtn = document.getElementById("colorSaveBtn"),
      colorCancelBtn = document.getElementById("colorCancelBtn"),
      renameModal = document.getElementById("renameModal"),
      renameInput = document.getElementById("renameInput"),
      renameSaveBtn = document.getElementById("renameSaveBtn"),
      renameCancelBtn = document.getElementById("renameCancelBtn"),
      screenshotModal = document.getElementById("screenshotModal"),
      shotModalImage = document.getElementById("shotModalImage"),
      configureFieldsModal = document.getElementById("configureFieldsModal"),
      configureFieldsList = document.getElementById("configureFieldsList"),
      configureFieldsSaveBtn = document.getElementById("configureFieldsSaveBtn"),
      configureFieldsCloseBtn = document.getElementById("configureFieldsCloseBtn"),
    } = dom || {};

    const {
      renderColorPalette: providedRenderColorPalette,
      iconChoices = [],
      updateSection,
      renderSectionsBar,
      renderTabs,
      scheduleSaveTabsConfig,
      closeQuickMenus,
      commitRename,
      cancelRename,
      persistClipAppearance,
    } = helpers || {};
    const iconChoicesList = (Array.isArray(iconChoices) && iconChoices.length)
      ? iconChoices
      : (Array.isArray(state?.iconChoices) && state.iconChoices.length
        ? state.iconChoices
        : (global.SnipState?.iconChoices || []));
    const defaultSwatches = (Array.isArray(global.SnipState?.TAB_COLORS) && global.SnipState.TAB_COLORS.length)
      ? global.SnipState.TAB_COLORS
      : ["#FF4F4F", "#FF914D", "#FFC145", "#F7F3D6", "#7ED957", "#3CB371", "#2ECCFA", "#3A7BEB", "#485B9A", "#6A5ACD", "#A56BF5", "#FF66C4", "#C13CFF", "#6E6E6E", "#CFCFCF"];
    const renderColorPalette = typeof providedRenderColorPalette === "function"
      ? providedRenderColorPalette
      : (container, selectedColor, onSelect, includeNone = false) => {
          if (!container) return;
          container.innerHTML = "";
          if (includeNone) {
            const noneBtn = document.createElement("button");
            noneBtn.type = "button";
            noneBtn.className = "color-swatch" + (!selectedColor ? " selected" : "");
            noneBtn.dataset.color = "";
            noneBtn.textContent = "×";
            noneBtn.onclick = () => {
              if (typeof onSelect === "function") onSelect("");
              container.querySelectorAll(".color-swatch").forEach((c) => c.classList.remove("selected"));
              noneBtn.classList.add("selected");
            };
            container.appendChild(noneBtn);
          }
          defaultSwatches.forEach((color) => {
            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = "color-swatch" + (color === selectedColor ? " selected" : "");
            swatch.style.backgroundColor = color;
            swatch.dataset.color = color;
            swatch.onclick = () => {
              if (typeof onSelect === "function") onSelect(color);
              container.querySelectorAll(".color-swatch").forEach((c) => c.classList.remove("selected"));
              swatch.classList.add("selected");
            };
            container.appendChild(swatch);
          });
        };
    const sbModal = document.getElementById('sbModal');
    const sbModalMessage = document.getElementById('sbModalMessage');
    const sbModalInput = document.getElementById('sbModalInput');
    const sbModalOk = document.getElementById('sbModalOk');
    const sbModalCancel = document.getElementById('sbModalCancel');

    const toastEl = document.getElementById("toast");
    /**
      * Display a transient toast message.
      * @param {string} message
      * @param {string} [color="#222"]
      */
    function showToast(message, color = "#222") {
      if (!toastEl) return;
      toastEl.textContent = message || "";
      toastEl.style.background = color;
      toastEl.classList.add("show");
      toastEl.classList.remove("hidden");
      setTimeout(() => {
        toastEl.classList.remove("show");
        toastEl.classList.add("hidden");
      }, 2500);
    }

    global.SnipToast = {
      error(msg) { showToast(msg, "#c0392b"); },
      success(msg) { showToast(msg, "#2e8b57"); },
      show(msg) { showToast(msg); },
    };

    let pendingClipIconId = null;
    let pendingClipColorId = null;
    let pendingSectionColorCallback = null;
    let pendingSectionIconCallback = null;
    const schemaOptions =
      (Array.isArray(global.SnipState?.FIELD_OPTIONS) && global.SnipState.FIELD_OPTIONS.length
        ? global.SnipState.FIELD_OPTIONS
        : Array.isArray(global.SnipState?.DEFAULT_SCHEMA)
        ? global.SnipState.DEFAULT_SCHEMA
        : []);

    function closeRenameModal() {
      state.pendingRenameSectionId = null;
      state.renameDraft = "";
      if (renameModal) renameModal.classList.remove("is-open");
    }

    /**
     * Open the rename modal for a given section.
     * @param {string} sectionId
     */
    function openRenameModal(sectionId) {
      const sec = state.tabs.find((s) => s.id === sectionId);
      if (!sec || sec.locked) return;
      if (closeQuickMenus) closeQuickMenus();
      state.pendingRenameSectionId = sectionId;
      state.renameDraft = sec.label || sec.name || sectionId;
      if (renameInput) {
        renameInput.value = state.renameDraft;
        setTimeout(() => {
          renameInput.focus();
          renameInput.select();
        }, 0);
      }
      if (renameModal) renameModal.classList.add("is-open");
    }

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

    /**
     * Show icon picker for a clip.
     * @param {Object} clip
     */
    function openClipIconPicker(clip, opts = {}) {
      if (!iconModal || !iconChoicesContainer) return;
      const hasCallback = typeof opts.onSave === "function";
      pendingClipIconId = clip.id;
      pendingSectionIconCallback = hasCallback ? opts.onSave : null;
      if (opts.section) {
        state.pendingIconSection = clip.id;
        pendingClipIconId = null;
      } else {
        state.pendingIconSection = null;
      }
      state.selectedIcon = clip.icon || "";
      iconChoicesContainer.innerHTML = "";
      iconChoicesList.forEach((choice) => {
        const isSelected =
          state.selectedIcon === choice.id ||
          state.selectedIcon === choice.emoji ||
          state.selectedIcon === choice.icon;
        const item = document.createElement("button");
        item.type = "button";
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

    /**
     * Show color picker for a clip.
     * @param {Object} clip
     */
    function openClipColorPicker(clip, opts = {}) {
      if (!colorModal || !colorSwatches) return;
      const hasCallback = typeof opts.onSave === "function";
      pendingClipColorId = clip.id;
      pendingSectionColorCallback = hasCallback ? opts.onSave : null;
      if (opts.section) {
        state.pendingColorSection = clip.id;
        pendingClipColorId = null;
      } else {
        state.pendingColorSection = null;
      }
      state.selectedColor = clip.color || "";
      renderColorPalette(colorSwatches, state.selectedColor, (color) => {
        state.selectedColor = color || "";
      }, true);
      colorModal.classList.add("is-open");
    }

    /**
     * Open screenshot preview modal.
     * @param {string} src
     */
    function openScreenshotModal(src) {
      if (!screenshotModal || !shotModalImage || !src) return;
      shotModalImage.src = src;
      screenshotModal.classList.add("is-open");
      const escHandler = (evt) => {
        if (evt.key === "Escape") {
          closeScreenshotModal();
        }
      };
      screenshotModal._escHandler = escHandler;
      document.addEventListener("keydown", escHandler);
    }

    function closeScreenshotModal() {
      if (!screenshotModal || !shotModalImage) return;
      screenshotModal.classList.remove("is-open");
      shotModalImage.src = "";
      if (screenshotModal._escHandler) {
        document.removeEventListener("keydown", screenshotModal._escHandler);
        screenshotModal._escHandler = null;
      }
    }

    // Event bindings
    if (colorSaveBtn) {
      colorSaveBtn.onclick = async () => {
        if (pendingClipColorId) {
          const clip = state.clips.find((c) => c.id === pendingClipColorId);
          if (pendingSectionColorCallback) {
            await pendingSectionColorCallback(state.selectedColor || "", pendingClipColorId);
          } else if (clip && persistClipAppearance) {
            await persistClipAppearance(clip, { color: state.selectedColor || null });
          }
          pendingClipColorId = null;
          pendingSectionColorCallback = null;
          state.pendingColorSection = null;
          if (colorModal) colorModal.classList.remove("is-open");
          return;
        }
        const targetId = state.pendingColorSection;
        if (!targetId) {
          if (colorModal) colorModal.classList.remove("is-open");
          return;
        }
        if (pendingSectionColorCallback) {
          await pendingSectionColorCallback(state.selectedColor || "", targetId);
        } else if (persistClipAppearance) {
          await persistClipAppearance({ id: targetId }, { color: state.selectedColor || "" });
        } else {
          const color = state.selectedColor || "";
          await updateSection(targetId, { color });
          const sec = state.sections.find((s) => s.id === targetId);
          if (sec) sec.color = color;
          const tab = state.tabs.find((t) => t.id === targetId);
          if (tab) tab.color = color;
          const targetTab = global.tabsState?.tabs?.find((t) => t.id === targetId);
          if (targetTab) targetTab.color = color;
          global.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
          await invoke(CHANNELS.SAVE_TABS, global.tabsState);
          renderTabs();
        }
        if (colorModal) colorModal.classList.remove("is-open");
        pendingSectionColorCallback = null;
        state.pendingColorSection = null;
        renderSectionsBar();
        scheduleSaveTabsConfig();
      };
    }
    if (colorCancelBtn) {
      colorCancelBtn.onclick = () => {
        pendingClipColorId = null;
        state.pendingColorSection = null;
        pendingSectionColorCallback = null;
        if (colorModal) colorModal.classList.remove("is-open");
      };
    }

    if (iconSaveBtn) {
      iconSaveBtn.onclick = async () => {
        if (pendingClipIconId) {
          const clip = state.clips.find((c) => c.id === pendingClipIconId);
          if (pendingSectionIconCallback) {
            await pendingSectionIconCallback(state.selectedIcon || "", pendingClipIconId);
          } else if (clip && persistClipAppearance) {
            await persistClipAppearance(clip, { icon: state.selectedIcon || null });
          }
          pendingClipIconId = null;
          pendingSectionIconCallback = null;
          state.pendingIconSection = null;
          if (iconModal) iconModal.classList.remove("is-open");
          return;
        }
        const targetId = state.pendingIconSection;
        if (!targetId) {
          if (iconModal) iconModal.classList.remove("is-open");
          return;
        }
        if (pendingSectionIconCallback) {
          await pendingSectionIconCallback(state.selectedIcon || "", targetId);
        } else if (persistClipAppearance) {
          await persistClipAppearance({ id: targetId }, { icon: state.selectedIcon || "" });
        } else {
          await updateSection(targetId, { icon: state.selectedIcon || "" });
          const sec = state.sections.find((s) => s.id === targetId);
          if (sec) sec.icon = state.selectedIcon || "";
          const tab = state.tabs.find((t) => t.id === targetId);
          if (tab) tab.icon = state.selectedIcon || "";
          const targetTab = global.tabsState?.tabs?.find((t) => t.id === targetId);
          if (targetTab) targetTab.icon = state.selectedIcon || "";
          global.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
          await invoke(CHANNELS.SAVE_TABS, global.tabsState);
          renderTabs();
          scheduleSaveTabsConfig();
        }
        pendingSectionIconCallback = null;
        if (iconModal) iconModal.classList.remove("is-open");
        state.pendingIconSection = null;
        renderSectionsBar();
      };
    }
    if (iconCancelBtn) {
      iconCancelBtn.onclick = () => {
        pendingClipIconId = null;
        state.pendingIconSection = null;
        pendingSectionIconCallback = null;
        if (iconModal) iconModal.classList.remove("is-open");
      };
    }

    if (renameSaveBtn) {
      renameSaveBtn.onclick = async () => {
        if (!state.pendingRenameSectionId) {
          closeRenameModal();
          return;
        }
        if (commitRename) {
          await commitRename(state.pendingRenameSectionId, renameInput ? renameInput.value : "");
        }
      };
    }
    if (renameCancelBtn) renameCancelBtn.onclick = cancelRename || closeRenameModal;
    if (renameInput) {
      renameInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          if (commitRename) await commitRename(state.pendingRenameSectionId, renameInput.value);
        } else if (e.key === "Escape") {
          (cancelRename || closeRenameModal)();
        }
      });
    }
    if (renameModal) {
      renameModal.addEventListener("click", (e) => {
        if (e.target === renameModal) closeRenameModal();
      });
    }

    if (screenshotModal) {
      screenshotModal.addEventListener("click", (evt) => {
        if (evt.target === screenshotModal || evt.target.classList.contains("shot-modal-backdrop")) {
          closeScreenshotModal();
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeRenameModal();
        if (colorModal && colorModal.classList.contains("is-open")) colorModal.classList.remove("is-open");
        if (iconModal && iconModal.classList.contains("is-open")) iconModal.classList.remove("is-open");
        if (closeQuickMenus) closeQuickMenus();
        if (cancelRename) cancelRename();
      }
    });
    document.addEventListener("keydown", trapFocusRenameModal, true);

    // Public API:
    // {
    //   openClipIconPicker,
    //   openClipColorPicker,
    //   openRenameModal,
    //   closeRenameModal,
    //   openScreenshotModal,
    //   closeScreenshotModal,
    //   setModalsApi: available through initModals return,
    // }

    const iconGlyphMap = {
      star: "⭐",
      gear: "⚙",
      bug: "🐞",
      spark: "✨",
      folder: "📁",
      idea: "💡",
      rocket: "🚀",
    };

    function findIconChoice(value) {
      if (!value) return null;
      const normalized = String(value).trim().toLowerCase();
      const match = iconChoicesList.find(
        (choice) =>
          (choice.id && choice.id.toLowerCase() === normalized) ||
          (choice.emoji && choice.emoji === value) ||
          (choice.icon && choice.icon.toLowerCase() === normalized)
      );
      if (match) return match;
      if (iconGlyphMap[normalized]) return { id: normalized, emoji: iconGlyphMap[normalized] };
      const glyph = Object.values(iconGlyphMap).find((char) => char === value);
      if (glyph) return { id: value, emoji: glyph };
      return null;
    }

    function createIconGlyph(choice) {
      const glyph = document.createElement("span");
      glyph.className = "icon-choice__glyph";
      if (!choice) {
        glyph.textContent = "⭐";
        return glyph;
      }
      if (typeof choice === "string") {
        glyph.textContent = choice;
      } else if (choice.emoji) {
        glyph.textContent = choice.emoji;
      } else if (choice.icon) {
        glyph.textContent = choice.icon;
      } else if (choice.svg) {
        glyph.innerHTML = choice.svg;
      } else {
        glyph.textContent = iconGlyphMap[choice.id] || "⭐";
      }
      return glyph;
    }

    function refreshData() {
      const EventCtor = global.CustomEvent || global.Event;
      if (!EventCtor) return;
      const event = new EventCtor("snipboard:refresh-data");
      global.document?.dispatchEvent?.(event);
    }

    function cleanInput(str) {
      if (str === null || str === undefined) return "";
      return String(str).trim().slice(0, 100);
    }

    function closePromptModal() {
      if (!sbModal) return;
      sbModal.hidden = true;
    }

    function openPromptModal(message, defaultValue = '') {
      return new Promise((resolve) => {
        if (!sbModal || !sbModalMessage || !sbModalInput || !sbModalOk || !sbModalCancel) {
          resolve(null);
          return;
        }
        sbModalMessage.textContent = message || '';
        sbModalInput.value = defaultValue || '';
        sbModalInput.style.display = '';
        sbModal.hidden = false;
        sbModalInput.focus();
        const cleanup = () => {
          sbModalInput.removeEventListener('keydown', keyHandler);
          sbModalOk.onclick = null;
          sbModalCancel.onclick = null;
          closePromptModal();
        };
        const ok = () => {
          cleanup();
          resolve(sbModalInput.value.trim());
        };
        const cancel = () => {
          cleanup();
          resolve(null);
        };
        const keyHandler = (event) => {
          if (event.key === 'Enter') {
            ok();
          } else if (event.key === 'Escape') {
            cancel();
          }
        };
        sbModalOk.onclick = ok;
        sbModalCancel.onclick = cancel;
        sbModalInput.addEventListener('keydown', keyHandler);
      });
    }

    const openTextModal = (message, defaultValue = '') =>
      openPromptModal(message, defaultValue);

    function openConfirmModal(message) {
      return new Promise((resolve) => {
        if (!sbModal || !sbModalMessage || !sbModalOk || !sbModalCancel) {
          resolve(false);
          return;
        }
        sbModalMessage.textContent = message || '';
        if (sbModalInput) sbModalInput.style.display = 'none';
        sbModal.hidden = false;
        const confirmKeyHandler = (event) => {
          if (event.key === 'Escape') {
            cancel();
          }
        };
        const cleanup = () => {
          if (sbModalInput) {
            sbModalInput.value = '';
            sbModalInput.removeEventListener('keydown', confirmKeyHandler);
            sbModalInput.style.display = '';
          }
          sbModalOk.onclick = null;
          sbModalCancel.onclick = null;
          closePromptModal();
        };
        const ok = () => {
          cleanup();
          resolve(true);
        };
        const cancel = () => {
          cleanup();
          resolve(false);
        };
        sbModalOk.onclick = ok;
        sbModalCancel.onclick = cancel;
        if (sbModalInput) {
          sbModalInput.addEventListener('keydown', confirmKeyHandler);
        }
      });
    }

    async function openRenameClipModal(clip, onSave) {
      if (!clip || typeof onSave !== "function") return;
      const response = await openTextModal("Rename clip", clip.title || "");
      const value = cleanInput(response);
      if (!value) return;
      onSave(value, clip);
    }

    function openChangeClipIconModal(entity, opts = {}) {
      if (!entity) return;
      openClipIconPicker(entity, opts);
    }

    function openChangeClipColorModal(entity, opts = {}) {
      if (!entity) return;
      openClipColorPicker(entity, opts);
    }

    function closeConfigureFieldsModal() {
      if (configureFieldsModal) configureFieldsModal.classList.remove("is-open");
      if (configureFieldsList) configureFieldsList.innerHTML = "";
    }

    function openConfigureFieldsModal(tab, onSave) {
      if (!tab || !configureFieldsModal || !configureFieldsList) return;
      // Modal rows depend on native checkbox styling; CSS overrides are scoped to this container.
      const activeSchema = Array.isArray(tab.schema) && tab.schema.length
        ? tab.schema
        : (Array.isArray(global.SnipState?.DEFAULT_SCHEMA) ? global.SnipState.DEFAULT_SCHEMA : []);
      configureFieldsList.innerHTML = "";
      schemaOptions.forEach((field) => {
        const row = document.createElement("label");
        row.className = "configure-field-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = field;
        input.checked = activeSchema.includes(field);
        const span = document.createElement("span");
        span.textContent = field;
        row.appendChild(input);
        row.appendChild(span);
        configureFieldsList.appendChild(row);
      });
      configureFieldsModal.classList.add("is-open");
      const saveHandler = async () => {
        const checked = Array.from(configureFieldsList.querySelectorAll('input[type="checkbox"]'))
          .filter((el) => el.checked)
          .map((el) => el.value)
          .filter(Boolean);
        const normalized = checked.length
          ? checked.filter((field) => schemaOptions.includes(field))
          : (Array.isArray(global.SnipState?.DEFAULT_SCHEMA) ? global.SnipState.DEFAULT_SCHEMA : []);
        if (typeof onSave === "function") {
          await onSave(normalized, tab);
        }
        closeConfigureFieldsModal();
      };
      if (configureFieldsSaveBtn) {
        configureFieldsSaveBtn.onclick = saveHandler;
      }
      if (configureFieldsCloseBtn) {
        configureFieldsCloseBtn.onclick = closeConfigureFieldsModal;
      }
      configureFieldsModal.addEventListener("click", (event) => {
        if (event.target === configureFieldsModal) {
          closeConfigureFieldsModal();
        }
      });
    }

    async function openRenameSectionModal(section, onSave) {
      if (!section || typeof onSave !== "function") return;
      const response = await openTextModal("Rename section", section.label || section.name || section.id || "");
      const value = cleanInput(response);
      if (!value) return;
      onSave(value, section);
    }

    return {
      openClipIconPicker,
      openClipColorPicker,
      openRenameModal,
      closeRenameModal,
      openScreenshotModal,
      closeScreenshotModal,
      findIconChoice,
      createIconGlyph,
      refreshData,
      openRenameClipModal,
      openChangeClipIconModal,
      openChangeClipColorModal,
      openRenameSectionModal,
      openPromptModal,
      openConfirmModal,
      openConfigureFieldsModal,
      closeConfigureFieldsModal,
    };
  }

  global.SnipModals = { initModals };
})(window);
