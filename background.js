/**
 * AdFast - Background Service Worker
 * ===================================
 * Manages trusted CDP (Chrome DevTools Protocol) clicks via chrome.debugger
 * to bypass YouTube's event.isTrusted check on ad skip buttons.
 */

// Track currently attached tabs to prevent concurrent attach collisions
const attachedTabs = new Set();
const pendingClicks = new Map();
const lastTabClickTimes = new Map();
const CLICK_COOLDOWN_MS = 1200;

/**
 * Dispatch a genuine hardware-level mouse click via Chrome DevTools Protocol (CDP).
 * This generates an event with event.isTrusted === true that YouTube's player accepts.
 *
 * @param {number} tabId - Target Chrome tab ID
 * @param {number} x - Viewport X coordinate of the skip button center
 * @param {number} y - Viewport Y coordinate of the skip button center
 * @returns {Promise<{success: boolean, skipped?: boolean, error?: string}>}
 */
async function dispatchTrustedClick(tabId, x, y) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return { success: false, error: 'Invalid tab ID' };
  }

  // 1200ms cooldown per tab to prevent rapid consecutive clicks hitting video scrub bar
  const now = Date.now();
  const lastClick = lastTabClickTimes.get(tabId) || 0;
  if (now - lastClick < CLICK_COOLDOWN_MS) {
    return { success: false, skipped: true, error: 'Cooldown active' };
  }

  // Prevent overlapping click commands on the same tab
  if (pendingClicks.has(tabId)) {
    return pendingClicks.get(tabId);
  }

  lastTabClickTimes.set(tabId, now);

  const clickPromise = (async () => {
    const target = { tabId };
    const clickX = Math.round(x);
    const clickY = Math.round(y);

    try {
      // 1. Attach debugger if not already attached to this tab
      if (!attachedTabs.has(tabId)) {
        try {
          await chrome.debugger.attach(target, '1.3');
          attachedTabs.add(tabId);
        } catch (attachErr) {
          const msg = attachErr?.message || '';
          if (msg.includes('Already attached') || msg.includes('another debugger')) {
            attachedTabs.add(tabId);
          } else {
            throw attachErr;
          }
        }
      }

      // 2. Dispatch mousePressed (left click)
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: clickX,
        y: clickY,
        button: 'left',
        buttons: 1,
        clickCount: 1
      });

      // Small realistic pause between press and release (30ms)
      await new Promise((resolve) => setTimeout(resolve, 30));

      // 3. Dispatch mouseReleased
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: clickX,
        y: clickY,
        button: 'left',
        buttons: 0,
        clickCount: 1
      });

      return { success: true };
    } catch (err) {
      console.warn('[AdFast Background] CDP trusted click error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    } finally {
      // 4. Detach debugger to cleanly dismiss Chrome's debugging banner
      try {
        if (attachedTabs.has(tabId)) {
          await chrome.debugger.detach(target);
          attachedTabs.delete(tabId);
        }
      } catch (detachErr) {
        attachedTabs.delete(tabId);
      }
      pendingClicks.delete(tabId);
    }
  })();

  pendingClicks.set(tabId, clickPromise);
  return clickPromise;
}

// Clean up state if the debugger is detached externally (e.g. user closes infobar or tab closes)
chrome.debugger.onDetach.addListener((source) => {
  if (source && source.tabId) {
    attachedTabs.delete(source.tabId);
    pendingClicks.delete(source.tabId);
  }
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  pendingClicks.delete(tabId);
  lastTabClickTimes.delete(tabId);
});

// Message listener for trusted click requests from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.action === 'adfast:trusted-click' || message.type === 'ADFAST_CLICK_SKIP') {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID available for trusted click' });
      return false;
    }

    const x = typeof message.x === 'number' ? message.x : 0;
    const y = typeof message.y === 'number' ? message.y : 0;

    dispatchTrustedClick(tabId, x, y).then(sendResponse);
    return true; // Keep message channel open for async sendResponse
  }

  return false;
});
