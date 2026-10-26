/**
 * AdFast — Integration Tests
 * ============================
 * Tests how content.js ↔ popup.js ↔ chrome.storage ↔ CSS work together.
 * Validates cross-component data flow and state synchronization.
 */

/* ========================================================================
   MOCK INFRASTRUCTURE
   ======================================================================== */

const _storage = { enabled: true, hideShorts: false, adsSkippedCount: 0 };
const _listeners = [];

const chrome = {
  storage: {
    local: {
      get: (defaults) =>
        Promise.resolve(
          Object.fromEntries(
            Object.entries(defaults).map(([k, v]) => [k, _storage[k] !== undefined ? _storage[k] : v])
          )
        ),
      set: (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: _storage[k], newValue: v };
          _storage[k] = v;
        }
        for (const fn of _listeners) {
          try { fn(changes, 'local'); } catch (e) { console.error(e); }
        }
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener: (fn) => _listeners.push(fn),
    },
  },
};
globalThis.chrome = chrome;

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
  console.log(`  INTEGRATION TEST RESULTS: ${_passed} passed, ${_failed} failed`);
  console.log(`═══════════════════════════════════════\n`);
  return { passed: _passed, failed: _failed, results: _results };
}

/* ========================================================================
   INTEGRATION TEST 1: Popup Toggle → Storage → Content Script Sync
   ======================================================================== */

(async function testPopupToContentSync() {
  console.log('\n▶ Integration 1: Popup toggle → Storage → Content script class sync');

  let contentScriptEnabled = true;

  // Simulate content.js listener
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      contentScriptEnabled = changes.enabled.newValue !== false;
    }
  });

  // Simulate popup disabling the extension
  await chrome.storage.local.set({ enabled: false });

  assertEqual(contentScriptEnabled, false, 'INT-1.1 — Content script received disabled state');
  assertEqual(_storage.enabled, false, 'INT-1.2 — Storage reflects disabled');

  // Re-enable
  await chrome.storage.local.set({ enabled: true });
  assertEqual(contentScriptEnabled, true, 'INT-1.3 — Content script received re-enabled state');
})();

/* ========================================================================
   INTEGRATION TEST 2: Content Script Ad Skip → Storage Counter → Popup Display
   ======================================================================== */

(async function testAdSkipToPopupCounter() {
  console.log('\n▶ Integration 2: Content ad skip → Storage counter → Popup display');

  let popupCountDisplay = '0';

  // Simulate popup listener for counter updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.adsSkippedCount) {
      popupCountDisplay = Number(changes.adsSkippedCount.newValue || 0).toLocaleString();
    }
  });

  // Simulate content.js incrementing the counter (ad was skipped)
  const res = await chrome.storage.local.get({ adsSkippedCount: 0 });
  await chrome.storage.local.set({ adsSkippedCount: (res.adsSkippedCount || 0) + 1 });

  assertEqual(_storage.adsSkippedCount, 1, 'INT-2.1 — Storage counter incremented to 1');
  assertEqual(popupCountDisplay, '1', 'INT-2.2 — Popup display updated to "1"');

  // Simulate 5 more ad skips
  for (let i = 0; i < 5; i++) {
    const r = await chrome.storage.local.get({ adsSkippedCount: 0 });
    await chrome.storage.local.set({ adsSkippedCount: (r.adsSkippedCount || 0) + 1 });
  }

  assertEqual(_storage.adsSkippedCount, 6, 'INT-2.3 — Storage counter is 6 after 6 skips');
  assertEqual(popupCountDisplay, '6', 'INT-2.4 — Popup displays 6');
})();

/* ========================================================================
   INTEGRATION TEST 3: Shorts Toggle → Storage → CSS Class → DOM Hiding
   ======================================================================== */

(async function testShortsToggleIntegration() {
  console.log('\n▶ Integration 3: Shorts toggle → Storage → CSS class sync');

  const root = document.documentElement;
  let shortsState = false;

  // Simulate content.js listener
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.hideShorts) {
      shortsState = !!changes.hideShorts.newValue;
      if (shortsState) {
        root.classList.add('adfast-hide-shorts');
      } else {
        root.classList.remove('adfast-hide-shorts');
      }
    }
  });

  // Popup enables shorts hiding
  await chrome.storage.local.set({ hideShorts: true });

  assert(shortsState === true, 'INT-3.1 — Shorts state is true');
  assert(root.classList.contains('adfast-hide-shorts'), 'INT-3.2 — CSS class applied to root');

  // Popup disables shorts hiding
  await chrome.storage.local.set({ hideShorts: false });

  assert(shortsState === false, 'INT-3.3 — Shorts state is false');
  assert(!root.classList.contains('adfast-hide-shorts'), 'INT-3.4 — CSS class removed from root');
})();

/* ========================================================================
   INTEGRATION TEST 4: Reset Counter → Storage → Popup Display
   ======================================================================== */

(async function testResetCounterIntegration() {
  console.log('\n▶ Integration 4: Reset counter → Storage → Popup display sync');

  let popupCount = '';

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.adsSkippedCount) {
      popupCount = String(changes.adsSkippedCount.newValue || 0);
    }
  });

  // Set high count
  await chrome.storage.local.set({ adsSkippedCount: 5000 });
  assertEqual(popupCount, '5000', 'INT-4.1 — Counter set to 5000');

  // Reset
  await chrome.storage.local.set({ adsSkippedCount: 0 });
  assertEqual(popupCount, '0', 'INT-4.2 — Counter reset to 0');
  assertEqual(_storage.adsSkippedCount, 0, 'INT-4.3 — Storage value is 0');
})();

/* ========================================================================
   INTEGRATION TEST 5: Disable Extension → Ad handler stops → Restore playback
   ======================================================================== */

(async function testDisableStopsAdHandler() {
  console.log('\n▶ Integration 5: Disable extension → stops ad processing');

  let isEnabled = true;
  let processAdCycleCalled = false;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      isEnabled = changes.enabled.newValue !== false;
    }
  });

  function processAdCycle() {
    if (!isEnabled) return;
    processAdCycleCalled = true;
  }

  // Disable
  await chrome.storage.local.set({ enabled: false });
  processAdCycleCalled = false;
  processAdCycle();

  assert(!processAdCycleCalled, 'INT-5.1 — processAdCycle does not execute when disabled');

  // Re-enable
  await chrome.storage.local.set({ enabled: true });
  processAdCycleCalled = false;
  processAdCycle();

  assert(processAdCycleCalled, 'INT-5.2 — processAdCycle executes when re-enabled');
})();

/* ========================================================================
   INTEGRATION TEST 6: CSS + JS ad hiding cooperation
   ======================================================================== */

(function testCSSJSCooperation() {
  console.log('\n▶ Integration 6: CSS + JS ad hiding cooperation');

  const root = document.documentElement;

  // When disabled, CSS should NOT hide ads (adfast-disabled class blocks the selectors)
  root.classList.add('adfast-disabled');

  // Create a mock ad element
  const adSlot = document.createElement('ytd-ad-slot-renderer');
  document.body.appendChild(adSlot);

  // With adfast-disabled, the CSS rule `html:not(.adfast-disabled) ytd-ad-slot-renderer`
  // should NOT apply. We verify the class mechanism works.
  assert(root.classList.contains('adfast-disabled'), 'INT-6.1 — adfast-disabled is present');

  // CSS selector `html:not(.adfast-disabled) ytd-ad-slot-renderer` won't match
  const matches = document.querySelectorAll('html:not(.adfast-disabled) ytd-ad-slot-renderer');
  assertEqual(matches.length, 0, 'INT-6.2 — Ad slot NOT targeted when disabled');

  // Re-enable
  root.classList.remove('adfast-disabled');
  const matches2 = document.querySelectorAll('html:not(.adfast-disabled) ytd-ad-slot-renderer');
  assertEqual(matches2.length, 1, 'INT-6.3 — Ad slot IS targeted when enabled');

  adSlot.remove();
})();

/* ========================================================================
   INTEGRATION TEST 7: Multiple rapid toggles (race condition test)
   ======================================================================== */

(async function testRapidToggles() {
  console.log('\n▶ Integration 7: Rapid toggle race condition');

  // Rapidly toggle enabled state
  for (let i = 0; i < 20; i++) {
    await chrome.storage.local.set({ enabled: i % 2 === 0 });
  }

  // After 20 toggles (0-19), last one is i=19 → 19 % 2 = 1 → false
  const data = await chrome.storage.local.get({ enabled: true });
  assertEqual(data.enabled, false, 'INT-7.1 — Final state is correct after 20 rapid toggles');
})();

/* ========================================================================
   OUTPUT SUMMARY
   ======================================================================== */

summary();
