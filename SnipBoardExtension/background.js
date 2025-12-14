let selectModeActive = false;

async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

chrome.action.onClicked.addListener(async () => {
  const tab = await getActiveTab();
  if (!tab) return;

  if (!selectModeActive) {
    selectModeActive = true;
    chrome.action.setBadgeText({ text: "S" });
    chrome.action.setBadgeBackgroundColor({ color: "#3B82F6" });
    console.log("[SnipBoard EXT] Sending select mode toggle: on");
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SELECT_MODE" }, () => {
      if (chrome.runtime.lastError) {
        console.debug("No content script:", chrome.runtime.lastError.message);
      }
    });
  } else {
    selectModeActive = false;
    chrome.action.setBadgeText({ text: "" });
    console.log("[SnipBoard EXT] Sending select mode toggle: off");
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SELECT_MODE" }, () => {
      if (chrome.runtime.lastError) {
        console.debug("No content script:", chrome.runtime.lastError.message);
      }
    });
  }
});
