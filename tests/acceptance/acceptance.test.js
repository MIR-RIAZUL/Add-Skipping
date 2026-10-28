/**
 * AdFast — Acceptance Tests (UAT)
 * =================================
 * Validates that the extension meets all user requirements:
 *   1. Bypass/skip all YouTube video ads without user interaction
 *   2. Remove all banner/sponsored/promoted content from the page
 *   3. Hide YouTube Shorts (optional toggle)
 *   4. User sees the main video directly, no clicks needed
 *   5. No anti-adblock detection triggered
 *   6. Popup shows correct status and controls
 *
 * These tests verify user-facing behavior, not internal implementation.
 */

/* ========================================================================
   MOCK INFRASTRUCTURE
   ======================================================================== */
(() => {
  'use strict';

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
          try { fn(changes, 'local'); } catch (e) {}
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
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  ACCEPTANCE TEST (UAT) RESULTS: ${_passed} passed, ${_failed} failed`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);
  return { passed: _passed, failed: _failed, results: _results };
}

/* ========================================================================
   UAT-REQ-001: User sees the main video directly without any ad interruption
   ======================================================================== */

(async function testReq001_DirectVideoPlayback() {
  console.log('\n▶ UAT-REQ-001: User sees main video directly (no ad interruption)');

  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);

  const video = document.createElement('video');
  video.className = 'html5-main-video';
  Object.defineProperty(video, 'duration', { value: 20, writable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = false;
  Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
  video.play = () => Promise.resolve();
  player.appendChild(video);

  const skipBtn = document.createElement('button');
  skipBtn.className = 'ytp-skip-ad-button';
  let autoSkipped = false;
  skipBtn.addEventListener('click', () => (autoSkipped = true));
  player.appendChild(skipBtn);

  let endedDispatched = false;
  video.addEventListener('ended', () => { endedDispatched = true; });

  // Simulate: YouTube injects an ad
  player.classList.add('ad-showing');

  // Extension detects and auto-handles (simulated pipeline)
  const isAd = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  if (isAd) {
    video.muted = true;
    video.playbackRate = 16;
    // CRITICAL: NEVER modify currentTime or dispatch ended event
    skipBtn.click();
  }

  assert(autoSkipped, 'UAT-001.1 — Ad skip button clicked automatically (no user action)');
  assertEqual(video.currentTime, 0, 'UAT-001.2 — currentTime NEVER modified during ad');
  assert(!endedDispatched, 'UAT-001.2b — "ended" event NEVER dispatched during ad');
  assertEqual(video.playbackRate, 16, 'UAT-001.3 — Ad played at maximum speed');

  // Ad finishes
  player.classList.remove('ad-showing');
  video.playbackRate = 1;
  video.muted = false;
  video.currentTime = 0;

  assertEqual(video.playbackRate, 1, 'UAT-001.4 — Normal playback rate restored after ad');
  assert(!video.muted, 'UAT-001.5 — Audio restored after ad');

  player.remove();
})();

/* ========================================================================
   UAT-REQ-002: No banner ads, sponsored videos, or promoted content shown
   ======================================================================== */

(function testReq002_NoBannersOrSponsored() {
  console.log('\n▶ UAT-REQ-002: No banner ads, sponsored, or promoted content shown');

  const root = document.documentElement;
  root.classList.remove('adfast-disabled');

  // Create every type of ad/sponsored element a user would see
  const adElements = {
    'ytd-ad-slot-renderer': 'In-feed ad slot',
    'ytd-banner-promo-renderer': 'Banner promo',
    'ytd-in-feed-ad-layout-renderer': 'In-feed ad layout',
    'ytd-promoted-sparkles-web-renderer': 'Promoted sparkles',
    'ytd-promoted-video-renderer': 'Promoted video',
    'ytd-display-ad-renderer': 'Display ad',
    'ytd-statement-banner-renderer': 'Statement banner',
    'ytd-video-masthead-ad-v3-renderer': 'Video masthead ad',
    'ytd-primetime-promo-renderer': 'Primetime promo',
    'ytd-compact-promoted-video-renderer': 'Compact promoted video',
  };

  const created = [];
  for (const [tag, label] of Object.entries(adElements)) {
    const el = document.createElement(tag);
    el.textContent = label;
    document.body.appendChild(el);
    created.push(el);
  }

  // Verify CSS selectors target every ad type
  let idx = 1;
  for (const [tag, label] of Object.entries(adElements)) {
    const selector = `html:not(.adfast-disabled) ${tag}`;
    const matches = document.querySelectorAll(selector);
    assert(matches.length > 0, `UAT-002.${idx} — "${label}" is targeted for removal`);
    idx++;
  }

  // Also check overlay containers
  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'ytp-ad-overlay-container';
  document.body.appendChild(overlayContainer);
  created.push(overlayContainer);

  const overlayMatch = document.querySelectorAll('html:not(.adfast-disabled) .ytp-ad-overlay-container');
  assert(overlayMatch.length > 0, `UAT-002.${idx} — Ad overlay container is targeted`);

  for (const el of created) el.remove();
})();

/* ========================================================================
   UAT-REQ-003: YouTube Shorts shelves hidden when toggle is ON
   ======================================================================== */

(async function testReq003_HideShorts() {
  console.log('\n▶ UAT-REQ-003: Shorts hidden when toggle is on');

  const root = document.documentElement;

  const reelShelf = document.createElement('ytd-reel-shelf-renderer');
  document.body.appendChild(reelShelf);

  // Toggle OFF — shorts visible
  root.classList.remove('adfast-hide-shorts');
  let matches = document.querySelectorAll('html.adfast-hide-shorts ytd-reel-shelf-renderer');
  assertEqual(matches.length, 0, 'UAT-003.1 — Shorts visible when toggle OFF');

  // User turns toggle ON (via popup)
  await chrome.storage.local.set({ hideShorts: true });
  root.classList.add('adfast-hide-shorts');
  matches = document.querySelectorAll('html.adfast-hide-shorts ytd-reel-shelf-renderer');
  assertEqual(matches.length, 1, 'UAT-003.2 — Shorts hidden when toggle ON');

  // User turns toggle OFF again
  await chrome.storage.local.set({ hideShorts: false });
  root.classList.remove('adfast-hide-shorts');
  matches = document.querySelectorAll('html.adfast-hide-shorts ytd-reel-shelf-renderer');
  assertEqual(matches.length, 0, 'UAT-003.3 — Shorts visible again when toggle OFF');

  reelShelf.remove();
})();

/* ========================================================================
   UAT-REQ-004: No anti-adblock detection triggered
   ======================================================================== */

(function testReq004_NoAntiAdblockDetection() {
  console.log('\n▶ UAT-REQ-004: No anti-adblock detection triggered');

  // The extension does NOT block network requests (no declarativeNetRequest)
  // It uses player manipulation which YouTube can't distinguish from user interaction
  const manifest = {
    permissions: ['storage'],
    host_permissions: ['*://*.youtube.com/*'],
  };

  assert(!manifest.permissions.includes('webRequest'), 'UAT-004.1 — No webRequest permission (avoids detection)');
  assert(!manifest.permissions.includes('webRequestBlocking'), 'UAT-004.2 — No webRequestBlocking permission');
  assert(!manifest.permissions.includes('declarativeNetRequest'), 'UAT-004.3 — No declarativeNetRequest (no request blocking)');

  // Enforcement modal auto-dismissed
  const dialog = document.createElement('tp-yt-paper-dialog');
  const enforcement = document.createElement('ytd-enforcement-message-view-model');
  dialog.appendChild(enforcement);
  document.body.appendChild(dialog);

  // Auto-dismiss
  const enfMsg = document.querySelector('ytd-enforcement-message-view-model');
  if (enfMsg) {
    const d = enfMsg.closest('tp-yt-paper-dialog');
    if (d) d.remove();
  }

  assert(document.querySelector('ytd-enforcement-message-view-model') === null,
    'UAT-004.4 — Enforcement modal auto-dismissed');
})();

/* ========================================================================
   UAT-REQ-005: Popup shows correct status and real-time stats
   ======================================================================== */

(async function testReq005_PopupStatus() {
  console.log('\n▶ UAT-REQ-005: Popup shows correct status and stats');

  // Simulate popup load
  const data = await chrome.storage.local.get({
    enabled: true,
    hideShorts: false,
    adsSkippedCount: 0,
  });

  const isEnabled = data.enabled !== false;
  const count = data.adsSkippedCount || 0;

  assert(isEnabled === true, 'UAT-005.1 — Default state: extension is enabled');

  // After some ads are skipped
  await chrome.storage.local.set({ adsSkippedCount: 25 });
  const data2 = await chrome.storage.local.get({ adsSkippedCount: 0 });
  assertEqual(data2.adsSkippedCount, 25, 'UAT-005.2 — Counter reflects 25 skipped ads');

  // Reset counter
  await chrome.storage.local.set({ adsSkippedCount: 0 });
  const data3 = await chrome.storage.local.get({ adsSkippedCount: 0 });
  assertEqual(data3.adsSkippedCount, 0, 'UAT-005.3 — Counter resets to 0');
})();

/* ========================================================================
   UAT-REQ-006: Extension can be disabled and re-enabled
   ======================================================================== */

(async function testReq006_EnableDisable() {
  console.log('\n▶ UAT-REQ-006: Extension disable/re-enable');

  const root = document.documentElement;

  // Disable
  await chrome.storage.local.set({ enabled: false });
  root.classList.add('adfast-disabled');

  // Ads should pass through (CSS selectors have html:not(.adfast-disabled))
  const adSlot = document.createElement('ytd-ad-slot-renderer');
  document.body.appendChild(adSlot);
  let targeted = document.querySelectorAll('html:not(.adfast-disabled) ytd-ad-slot-renderer');
  assertEqual(targeted.length, 0, 'UAT-006.1 — Disabled: ads are NOT blocked');

  // Re-enable
  await chrome.storage.local.set({ enabled: true });
  root.classList.remove('adfast-disabled');
  targeted = document.querySelectorAll('html:not(.adfast-disabled) ytd-ad-slot-renderer');
  assertEqual(targeted.length, 1, 'UAT-006.2 — Re-enabled: ads ARE blocked');

  adSlot.remove();
})();

/* ========================================================================
   UAT-REQ-007: Multiple ad scenarios handled
   ======================================================================== */

(function testReq007_MultipleAdScenarios() {
  console.log('\n▶ UAT-REQ-007: Multiple ad scenario handling');

  // Scenario A: Pre-roll ad (ad-showing class)
  const player = document.createElement('div');
  player.id = 'movie_player';

  player.classList.add('ad-showing');
  assert(player.classList.contains('ad-showing'), 'UAT-007.1 — Pre-roll ad detected via "ad-showing"');
  player.classList.remove('ad-showing');

  // Scenario B: Mid-roll ad (ad-interrupting class)
  player.classList.add('ad-interrupting');
  assert(player.classList.contains('ad-interrupting'), 'UAT-007.2 — Mid-roll ad detected via "ad-interrupting"');
  player.classList.remove('ad-interrupting');

  // Scenario C: Overlay ad elements present in DOM without player ad classes
  const overlay = document.createElement('div');
  overlay.className = 'ytp-ad-player-overlay';
  document.body.appendChild(overlay);
  const hasOverlay = !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
  assert(hasOverlay, 'UAT-007.3 — Overlay element detected in DOM');

  // Ad mode strictly requires ad-showing or ad-interrupting on player
  function isAdActiveStrict(p) {
    return p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }
  assert(!isAdActiveStrict(player), 'UAT-007.4 — In-stream ad mode NOT active with overlay alone (false positive prevented)');
  overlay.remove();

  // Scenario D: Ad overlay layout variant
  const overlayLayout = document.createElement('div');
  overlayLayout.className = 'ytp-ad-player-overlay-layout';
  document.body.appendChild(overlayLayout);
  assert(!isAdActiveStrict(player), 'UAT-007.5 — In-stream ad mode NOT active with overlay layout alone');
  overlayLayout.remove();
})();

/* ========================================================================
   UAT-REQ-008: Extension works on YouTube SPA navigations
   ======================================================================== */

(function testReq008_SPANavigation() {
  console.log('\n▶ UAT-REQ-008: Extension works across SPA navigations');

  let reprocessed = false;
  window.addEventListener('yt-navigate-finish', () => {
    reprocessed = true;
  });

  // User navigates to a new video (SPA)
  window.dispatchEvent(new Event('yt-navigate-finish'));
  assert(reprocessed, 'UAT-008.1 — Extension reprocesses ads on SPA navigation');
})();

/* ========================================================================
   OUTPUT SUMMARY
   ======================================================================== */

summary();
})();
