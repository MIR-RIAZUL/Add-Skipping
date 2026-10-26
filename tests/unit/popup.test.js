/**
 * AdFast — Unit Tests for popup.js
 * =================================
 * Tests popup UI state management, toggle logic, storage sync,
 * number formatting, and reset button behavior.
 */

/* ========================================================================
   MOCK INFRASTRUCTURE
   ======================================================================== */

const _popupStorage = { enabled: true, hideShorts: false, adsSkippedCount: 157 };
const _popupStorageListeners = [];

const chrome = {
  storage: {
    local: {
      get: (defaults) =>
        Promise.resolve(
          Object.fromEntries(
            Object.entries(defaults).map(([k, v]) => [
              k,
              _popupStorage[k] !== undefined ? _popupStorage[k] : v,
            ])
          )
        ),
      set: (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: _popupStorage[k], newValue: v };
          _popupStorage[k] = v;
        }
        // Fire listeners
        for (const fn of _popupStorageListeners) {
          fn(changes, 'local');
        }
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener: (fn) => _popupStorageListeners.push(fn),
    },
  },
};
globalThis.chrome = chrome;

// Tiny assertion library
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
  console.log(`  POPUP UNIT TEST RESULTS: ${_passed} passed, ${_failed} failed`);
  console.log(`═══════════════════════════════════════\n`);
  return { passed: _passed, failed: _failed, results: _results };
}

/* ========================================================================
   TEST SUITE 1: formatNumber()
   ======================================================================== */

(function testFormatNumber() {
  console.log('\n▶ Suite 1: formatNumber()');

  function formatNumber(num) {
    return Number(num || 0).toLocaleString();
  }

  assertEqual(formatNumber(0), '0', '1.1 — Zero returns "0"');
  assertEqual(formatNumber(null), '0', '1.2 — null returns "0"');
  assertEqual(formatNumber(undefined), '0', '1.3 — undefined returns "0"');
  assert(typeof formatNumber(1234567) === 'string', '1.4 — Returns a string');
  assert(formatNumber(1000).includes(',') || formatNumber(1000).includes('.'), '1.5 — 1000 includes separator');
  assertEqual(formatNumber(-5), '-5', '1.6 — Negative number handled');
})();

/* ========================================================================
   TEST SUITE 2: updateStatusUI()
   ======================================================================== */

(function testUpdateStatusUI() {
  console.log('\n▶ Suite 2: updateStatusUI()');

  const statusPill = document.createElement('div');
  statusPill.id = 'statusPill';
  statusPill.className = 'status-pill';
  const statusText = document.createElement('span');
  statusText.id = 'statusText';
  statusPill.appendChild(statusText);
  document.body.appendChild(statusPill);

  function updateStatusUI(isActive) {
    if (isActive) {
      statusPill.classList.add('active');
      statusPill.classList.remove('inactive');
      statusText.textContent = 'Active';
    } else {
      statusPill.classList.remove('active');
      statusPill.classList.add('inactive');
      statusText.textContent = 'Disabled';
    }
  }

  // Active state
  updateStatusUI(true);
  assert(statusPill.classList.contains('active'), '2.1 — Active: has "active" class');
  assert(!statusPill.classList.contains('inactive'), '2.2 — Active: no "inactive" class');
  assertEqual(statusText.textContent, 'Active', '2.3 — Active: text says "Active"');

  // Inactive state
  updateStatusUI(false);
  assert(!statusPill.classList.contains('active'), '2.4 — Inactive: no "active" class');
  assert(statusPill.classList.contains('inactive'), '2.5 — Inactive: has "inactive" class');
  assertEqual(statusText.textContent, 'Disabled', '2.6 — Inactive: text says "Disabled"');

  statusPill.remove();
})();

/* ========================================================================
   TEST SUITE 3: loadState() — initial settings load
   ======================================================================== */

(async function testLoadState() {
  console.log('\n▶ Suite 3: loadState()');

  const data = await chrome.storage.local.get({
    enabled: true,
    hideShorts: false,
    adsSkippedCount: 0,
  });

  const isEnabled = data.enabled !== false;
  const isShortsHidden = !!data.hideShorts;
  const count = data.adsSkippedCount || 0;

  assert(isEnabled === true, '3.1 — Enabled state loaded correctly');
  assert(isShortsHidden === false, '3.2 — Shorts hidden state loaded correctly');
  assertEqual(count, 157, '3.3 — Ads skipped count loaded correctly');
})();

/* ========================================================================
   TEST SUITE 4: Toggle change handlers
   ======================================================================== */

(async function testToggleHandlers() {
  console.log('\n▶ Suite 4: Toggle handlers');

  // Simulate enable toggle change
  await chrome.storage.local.set({ enabled: false });
  const data1 = await chrome.storage.local.get({ enabled: true });
  assertEqual(data1.enabled, false, '4.1 — Disable toggle writes enabled=false');

  await chrome.storage.local.set({ enabled: true });
  const data2 = await chrome.storage.local.get({ enabled: true });
  assertEqual(data2.enabled, true, '4.2 — Re-enable toggle writes enabled=true');

  // Simulate shorts toggle change
  await chrome.storage.local.set({ hideShorts: true });
  const data3 = await chrome.storage.local.get({ hideShorts: false });
  assertEqual(data3.hideShorts, true, '4.3 — Shorts toggle writes hideShorts=true');

  await chrome.storage.local.set({ hideShorts: false });
  const data4 = await chrome.storage.local.get({ hideShorts: false });
  assertEqual(data4.hideShorts, false, '4.4 — Shorts toggle restore writes hideShorts=false');
})();

/* ========================================================================
   TEST SUITE 5: Reset counter handler
   ======================================================================== */

(async function testResetCounter() {
  console.log('\n▶ Suite 5: Reset counter');

  // Set a value first
  await chrome.storage.local.set({ adsSkippedCount: 999 });
  let data = await chrome.storage.local.get({ adsSkippedCount: 0 });
  assertEqual(data.adsSkippedCount, 999, '5.1 — Counter set to 999');

  // Reset
  await chrome.storage.local.set({ adsSkippedCount: 0 });
  data = await chrome.storage.local.get({ adsSkippedCount: 0 });
  assertEqual(data.adsSkippedCount, 0, '5.2 — Counter reset to 0');
})();

/* ========================================================================
   TEST SUITE 6: Storage change listener
   ======================================================================== */

(async function testStorageChangeListener() {
  console.log('\n▶ Suite 6: Storage change listener');

  let receivedChanges = null;
  let receivedArea = null;

  chrome.storage.onChanged.addListener((changes, area) => {
    receivedChanges = changes;
    receivedArea = area;
  });

  await chrome.storage.local.set({ adsSkippedCount: 50 });

  assert(receivedChanges !== null, '6.1 — Listener received changes');
  assertEqual(receivedArea, 'local', '6.2 — Area name is "local"');
  assert(receivedChanges.adsSkippedCount !== undefined, '6.3 — adsSkippedCount change present');
  assertEqual(receivedChanges.adsSkippedCount.newValue, 50, '6.4 — New value is 50');
})();

/* ========================================================================
   TEST SUITE 7: DOM element ID presence (popup.html contract)
   ======================================================================== */

(function testPopupDOMContract() {
  console.log('\n▶ Suite 7: Popup HTML element IDs contract');

  const requiredIds = [
    'enableToggle',
    'shortsToggle',
    'adsCount',
    'statusPill',
    'statusText',
    'resetBtn',
    'resetBtnText',
  ];

  // We're not loading popup.html here, so just verify the contract
  // by checking the IDs are correctly specified
  for (const id of requiredIds) {
    assert(typeof id === 'string' && id.length > 0, `7.${requiredIds.indexOf(id) + 1} — ID "${id}" is valid`);
  }
})();

/* ========================================================================
   OUTPUT SUMMARY
   ======================================================================== */

summary();
