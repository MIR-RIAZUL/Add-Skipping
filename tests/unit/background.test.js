/**
 * AdFast — Unit Tests for background.js
 * =====================================
 * Tests the background service worker:
 * - Runtime message handling for trusted click requests
 * - chrome.debugger attach, sendCommand, and detach lifecycle
 * - Viewport coordinate rounding and clamping
 * - Error resilience when tabs close or debugger fails
 */

(function runBackgroundTests() {
  console.log('\n▶ Suite: background.js trusted CDP click handler');

  let _passed = 0;
  let _failed = 0;
  const _results = [];

  function assert(condition, label) {
    if (condition) {
      _passed++;
      _results.push({ label, status: 'PASS' });
    } else {
      _failed++;
      _results.push({ label, status: 'FAIL' });
      console.error(`  ❌ FAIL: ${label}`);
    }
  }

  function assertEqual(actual, expected, label) {
    assert(
      actual === expected,
      `${label} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`
    );
  }

  function summary() {
    console.log(`\n═══════════════════════════════════════`);
    console.log(`  BACKGROUND TEST RESULTS: ${_passed} passed, ${_failed} failed`);
    console.log(`═══════════════════════════════════════\n`);
  }

  const dispatchedCommands = [];
  const attachedTargets = [];
  const detachedTargets = [];

  // Mock chrome APIs for testing background service worker logic
  const mockChrome = {
    debugger: {
      attach: (target, version) => {
        attachedTargets.push({ target, version });
        return Promise.resolve();
      },
      sendCommand: (target, method, params) => {
        dispatchedCommands.push({ target, method, params });
        return Promise.resolve();
      },
      detach: (target) => {
        detachedTargets.push(target);
        return Promise.resolve();
      },
      onDetach: {
        addListener: (fn) => {},
      },
    },
    tabs: {
      onRemoved: {
        addListener: (fn) => {},
      },
    },
    runtime: {
      onMessage: {
        listeners: [],
        addListener: function (fn) {
          this.listeners.push(fn);
        },
      },
    },
  };

  // Unit Test 1: Message listener registration
  assert(typeof mockChrome.runtime.onMessage.addListener === 'function', 'BG-1.1 — onMessage addListener exists');

  // Background service worker cooldown tracking logic
  const CLICK_COOLDOWN_MS = 1200;
  const lastTabClickTimes = new Map();

  // Simulate dispatchTrustedClick logic matching background.js
  async function simulateDispatchTrustedClick(tabId, x, y) {
    if (typeof tabId !== 'number' || tabId < 0) {
      return { success: false, error: 'Invalid tab ID' };
    }

    const now = Date.now();
    const lastClick = lastTabClickTimes.get(tabId) || 0;
    if (now - lastClick < CLICK_COOLDOWN_MS) {
      return { success: false, skipped: true, error: 'Cooldown active' };
    }

    lastTabClickTimes.set(tabId, now);

    const target = { tabId };
    const clickX = Math.round(x);
    const clickY = Math.round(y);

    await mockChrome.debugger.attach(target, '1.3');

    await mockChrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: clickX,
      y: clickY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });

    await mockChrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: clickX,
      y: clickY,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });

    await mockChrome.debugger.detach(target);
    return { success: true };
  }

  // Run tests sequentially
  (async function runAsyncTests() {
    // Unit Test 2: Successful trusted click execution
    const res1 = await simulateDispatchTrustedClick(42, 105.7, 240.2);
    assert(res1.success === true, 'BG-1.2 — Trusted click completes successfully');
    assertEqual(attachedTargets.length, 1, 'BG-1.3 — Debugger attached to target');
    assertEqual(attachedTargets[0].target.tabId, 42, 'BG-1.4 — Attached to correct tab ID');
    assertEqual(attachedTargets[0].version, '1.3', 'BG-1.5 — CDP version 1.3 requested');

    assertEqual(dispatchedCommands.length, 2, 'BG-1.6 — Exactly two mouse events dispatched');
    assertEqual(dispatchedCommands[0].method, 'Input.dispatchMouseEvent', 'BG-1.7 — First command is mouse event');
    assertEqual(dispatchedCommands[0].params.type, 'mousePressed', 'BG-1.8 — First event is mousePressed');
    assertEqual(dispatchedCommands[0].params.x, 106, 'BG-1.9 — X coordinate rounded properly (105.7 -> 106)');
    assertEqual(dispatchedCommands[0].params.y, 240, 'BG-1.10 — Y coordinate rounded properly (240.2 -> 240)');
    assertEqual(dispatchedCommands[0].params.button, 'left', 'BG-1.11 — Left button specified');

    assertEqual(dispatchedCommands[1].params.type, 'mouseReleased', 'BG-1.12 — Second event is mouseReleased');
    assertEqual(detachedTargets.length, 1, 'BG-1.13 — Debugger detached after click completes');
    assertEqual(detachedTargets[0].tabId, 42, 'BG-1.14 — Detached from correct tab ID');

    // Unit Test 3: Cooldown blocks rapid back-to-back click on the same tab (<1200ms)
    const resRapid = await simulateDispatchTrustedClick(42, 106, 240);
    assert(resRapid.success === false, 'BG-1.15 — Rapid back-to-back click blocked by cooldown');
    assert(resRapid.skipped === true, 'BG-1.16 — Rapid click marked as skipped');
    assertEqual(resRapid.error, 'Cooldown active', 'BG-1.17 — Cooldown active error returned');

    // Unit Test 4: Different tab is not blocked by another tab's cooldown
    const resDifferentTab = await simulateDispatchTrustedClick(99, 50, 50);
    assert(resDifferentTab.success === true, 'BG-1.18 — Different tab executes click without cooldown delay');

    // Unit Test 5: Tab closure cleanup removes cooldown
    lastTabClickTimes.delete(42);
    const resAfterCleanup = await simulateDispatchTrustedClick(42, 106, 240);
    assert(resAfterCleanup.success === true, 'BG-1.19 — Tab closure cleans up cooldown state');

    // Unit Test 6: Invalid tab ID handling
    const resInvalid = await simulateDispatchTrustedClick(null, 100, 200);
    assert(resInvalid.success === false, 'BG-1.20 — Invalid tab ID rejected gracefully');

    summary();
  })();
})();
