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
      iconModal,
      iconChoicesContainer,
      iconSaveBtn,
      iconCancelBtn,
      colorModal,
      colorSwatches,
      colorSaveBtn,
      colorCancelBtn,
      renameModal,
      renameInput,
      renameSaveBtn,
      renameCancelBtn,
      screenshotModal,
      shotModalImage,
    } = dom || {};

    const {
      renderColorPalette,
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
    function openClipIconPicker(clip) {
      if (!iconModal || !iconChoicesContainer) return;
      pendingClipIconId = clip.id;
      state.selectedIcon = clip.icon || "";
      iconChoicesContainer.innerHTML = "";
      iconChoices.forEach((choice) => {
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
    function openClipColorPicker(clip) {
      if (!colorModal || !colorSwatches) return;
      pendingClipColorId = clip.id;
      state.selectedColor = clip.appearanceColor || "";
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
          if (clip && persistClipAppearance) {
            await persistClipAppearance(clip, { appearanceColor: state.selectedColor || null });
          }
          pendingClipColorId = null;
          if (colorModal) colorModal.classList.remove("is-open");
          return;
        }
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
        const targetTab = global.tabsState?.tabs?.find((t) => t.id === targetId);
        if (targetTab) targetTab.color = color;
        global.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
        await invoke(CHANNELS.SAVE_TABS, global.tabsState);
        renderTabs();
        if (colorModal) colorModal.classList.remove("is-open");
        state.pendingColorSection = null;
        renderSectionsBar();
        scheduleSaveTabsConfig();
      };
    }
    if (colorCancelBtn) {
      colorCancelBtn.onclick = () => {
        pendingClipColorId = null;
        state.pendingColorSection = null;
        if (colorModal) colorModal.classList.remove("is-open");
      };
    }

    if (iconSaveBtn) {
      iconSaveBtn.onclick = async () => {
        if (pendingClipIconId) {
          const clip = state.clips.find((c) => c.id === pendingClipIconId);
          if (clip && persistClipAppearance) {
            await persistClipAppearance(clip, { icon: state.selectedIcon || null });
          }
          pendingClipIconId = null;
          if (iconModal) iconModal.classList.remove("is-open");
          return;
        }
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
        const targetTab = global.tabsState?.tabs?.find((t) => t.id === targetId);
        if (targetTab) targetTab.icon = state.selectedIcon || "";
        if (iconModal) iconModal.classList.remove("is-open");
        state.pendingIconSection = null;
        renderSectionsBar();
        global.tabsState = { tabs: state.tabs, activeTabId: state.activeTabId || "all" };
        await invoke(CHANNELS.SAVE_TABS, global.tabsState);
        renderTabs();
        scheduleSaveTabsConfig();
      };
    }
    if (iconCancelBtn) {
      iconCancelBtn.onclick = () => {
        pendingClipIconId = null;
        state.pendingIconSection = null;
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
      const match = iconChoices.find(
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

    async function openChangeClipIconModal(clip, onSave) {
      if (!clip || typeof onSave !== "function") return;
      const response = await openTextModal("Icon (emoji or short code)", clip.icon || "");
      const value = cleanInput(response);
      if (!value) return;
      onSave(value, clip);
    }

    async function openChangeClipColorModal(clip, onSave) {
      if (!clip || typeof onSave !== "function") return;
      const current = clip.appearanceColor || clip.color || "";
      const response = await openTextModal("Color value (e.g. #ffcc00)", current);
      const value = cleanInput(response);
      if (!value) return;
      onSave(value, clip);
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
    };
  }

  global.SnipModals = { initModals };
})(window);
