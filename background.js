/**
 * AdFast - Background Service Worker / Event Page
 * ===============================================
 * Lightweight background handler for extension lifecycle and settings synchronization.
 * Operates without elevated permissions for universal Edge, Firefox, and Chrome compatibility.
 */

// Initialize default storage on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.get({ enabled: true, hideShorts: false, adsSkippedCount: 0 }, (items) => {
      chrome.storage.local.set(items);
    });
  }
});

// Runtime message listener for communications across components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.action === 'adfast:ping') {
    sendResponse({ success: true, active: true });
    return true;
  }

  // Gracefully acknowledge any legacy click requests
  if (message.action === 'adfast:trusted-click' || message.type === 'ADFAST_CLICK_SKIP') {
    sendResponse({ success: true, bypassed: true });
    return true;
  }

  return false;
});
