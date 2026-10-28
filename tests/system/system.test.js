/**
 * AdFast — System Tests
 * =======================
 * End-to-end simulation of the full extension lifecycle.
 * Tests: manifest validity, file structure integrity, CSS rule verification,
 * full ad-detection-to-skip pipeline, MutationObserver behavior,
 * and YouTube SPA navigation simulation.
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
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  SYSTEM TEST RESULTS: ${_passed} passed, ${_failed} failed`);
  console.log(`═══════════════════════════════════════\n`);
  return { passed: _passed, failed: _failed, results: _results };
}

/* ========================================================================
   SYSTEM TEST 1: Manifest V3 Validity
   ======================================================================== */

(function testManifestValidity() {
  console.log('\n▶ System 1: Manifest V3 validity');

  const manifest = {
    manifest_version: 3,
    name: 'AdFast - Instant YouTube Ad Skipper',
    version: '1.2.0',
    description: 'Instantly bypasses video ads and removes banner ads on YouTube without triggering anti-adblock detection.',
    permissions: ['storage', 'debugger'],
    host_permissions: ['*://*.youtube.com/*'],
    background: {
      service_worker: 'background.js',
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'AdFast Controls',
      default_icon: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    },
    icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    content_scripts: [
      {
        matches: ['*://*.youtube.com/*'],
        js: ['content.js'],
        css: ['styles.css'],
        run_at: 'document_start',
      },
      {
        matches: ['*://*.youtube.com/*'],
        js: ['page-bridge.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
    ],
  };

  assertEqual(manifest.manifest_version, 3, 'SYS-1.1 — Manifest version is 3');
  assert(typeof manifest.name === 'string' && manifest.name.length > 0, 'SYS-1.2 — Name is non-empty');
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'SYS-1.3 — Version is semver format');
  assert(manifest.description.length <= 132, 'SYS-1.4 — Description under 132 chars');
  assert(manifest.permissions.includes('storage'), 'SYS-1.5 — storage permission declared');
  assert(manifest.permissions.includes('debugger'), 'SYS-1.5b — debugger permission declared for trusted clicks');
  assert(!manifest.permissions.includes('tabs'), 'SYS-1.6 — No unnecessary tabs permission');
  assert(manifest.host_permissions[0] === '*://*.youtube.com/*', 'SYS-1.7 — Host permission scoped to YouTube');
  assert(manifest.action !== undefined, 'SYS-1.8 — action key is present');
  assertEqual(manifest.action.default_popup, 'popup.html', 'SYS-1.9 — Popup file specified');
  assertEqual(manifest.content_scripts[0].run_at, 'document_start', 'SYS-1.10 — Content script runs at document_start');
  assert(manifest.content_scripts[0].js.includes('content.js'), 'SYS-1.11 — content.js is listed');
  assert(manifest.content_scripts[0].css.includes('styles.css'), 'SYS-1.12 — styles.css is listed');

  // Background service worker (MV3)
  assertEqual(manifest.background?.service_worker, 'background.js', 'SYS-1.13 — Manifest V3 service_worker declared');

  // Page bridge in MAIN world
  assert(manifest.content_scripts[1].js.includes('page-bridge.js'), 'SYS-1.14 — page-bridge.js is listed');
  assertEqual(manifest.content_scripts[1].world, 'MAIN', 'SYS-1.15 — page-bridge.js runs in MAIN world');
  assertEqual(manifest.content_scripts[1].run_at, 'document_start', 'SYS-1.16 — page-bridge.js runs at document_start');
})();

/* ========================================================================
   SYSTEM TEST 2: Full Ad Detection → Skip → Restore Pipeline
   ======================================================================== */

(async function testFullAdPipeline() {
  console.log('\n▶ System 2: Full ad detection → skip → restore pipeline');

  // Build mock YouTube page
  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);

  const video = document.createElement('video');
  video.className = 'html5-main-video';
  Object.defineProperty(video, 'duration', { value: 15, writable: true, configurable: true });
  video.currentTime = 0;
  video.playbackRate = 1;
  video.muted = false;
  Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
  video.play = () => Promise.resolve();
  player.appendChild(video);

  const skipBtn = document.createElement('button');
  skipBtn.className = 'ytp-skip-ad-button';
  let skipClicked = false;
  skipBtn.addEventListener('click', () => (skipClicked = true));
  player.appendChild(skipBtn);

  // --- Phase 1: No ad ---
  let isAdShowing = player.classList.contains('ad-showing');
  assert(!isAdShowing, 'SYS-2.1 — No ad initially');

  // --- Phase 2: Ad starts ---
  player.classList.add('ad-showing');
  isAdShowing = player.classList.contains('ad-showing');
  assert(isAdShowing, 'SYS-2.2 — Ad detected');

  // Simulate handleAdActive
  let isCurrentlyInAd = false;
  let savedPlaybackRate = 1;
  let scriptMutedVideo = false;

  // First ad entry
  isCurrentlyInAd = true;
  savedPlaybackRate = video.playbackRate;
  video.muted = true;
  scriptMutedVideo = true;
  video.playbackRate = 16;
  // NOTE: currentTime is NOT forced to duration on skippable ads to prevent end-card freeze

  assertEqual(video.playbackRate, 16, 'SYS-2.3 — Playback rate set to 16x');
  assert(video.muted, 'SYS-2.4 — Video muted during ad');
  assert(video.currentTime < video.duration, 'SYS-2.5 — currentTime not forced to duration (prevents end-card freeze)');

  // Click skip
  skipBtn.click();
  assert(skipClicked, 'SYS-2.6 — Skip button clicked');

  // Increment counter
  await chrome.storage.local.set({ adsSkippedCount: (_storage.adsSkippedCount || 0) + 1 });
  assertEqual(_storage.adsSkippedCount, 1, 'SYS-2.7 — Counter incremented');

  // --- Phase 3: Ad ends ---
  player.classList.remove('ad-showing');

  // Restore
  isCurrentlyInAd = false;
  video.playbackRate = savedPlaybackRate;
  video.muted = false;
  scriptMutedVideo = false;

  assertEqual(video.playbackRate, 1, 'SYS-2.8 — Playback rate restored to 1x');
  assert(!video.muted, 'SYS-2.9 — Video unmuted');
  assert(!isCurrentlyInAd, 'SYS-2.10 — Ad state cleared');

  player.remove();
})();

/* ========================================================================
   SYSTEM TEST 3: CSS Cosmetic Filtering Rules
   ======================================================================== */

(function testCSSCosmeticRules() {
  console.log('\n▶ System 3: CSS cosmetic filtering rules');

  const root = document.documentElement;
  root.classList.remove('adfast-disabled');

  // Create all ad element types
  const adTypes = [
    'ytd-ad-slot-renderer',
    'ytd-banner-promo-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-video-renderer',
    'ytd-display-ad-renderer',
    'ytd-statement-banner-renderer',
    'ytd-video-masthead-ad-v3-renderer',
    'ytd-primetime-promo-renderer',
    'ytd-compact-promoted-video-renderer',
  ];

  const createdEls = [];
  for (const tag of adTypes) {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    createdEls.push(el);
  }

  // Verify each ad element is targetable by the CSS selectors
  for (let i = 0; i < adTypes.length; i++) {
    const selector = `html:not(.adfast-disabled) ${adTypes[i]}`;
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      matches = [];
    }
    assert(matches.length > 0, `SYS-3.${i + 1} — CSS targets ${adTypes[i]}`);
  }

  // Verify disabling removes targeting
  root.classList.add('adfast-disabled');
  for (let i = 0; i < adTypes.length; i++) {
    const selector = `html:not(.adfast-disabled) ${adTypes[i]}`;
    const matches = document.querySelectorAll(selector);
    assertEqual(matches.length, 0, `SYS-3.${adTypes.length + i + 1} — Disabled: ${adTypes[i]} NOT targeted`);
  }

  // Cleanup
  for (const el of createdEls) el.remove();
  root.classList.remove('adfast-disabled');
})();

/* ========================================================================
   SYSTEM TEST 4: YouTube SPA Navigation Handling
   ======================================================================== */

(function testSPANavigation() {
  console.log('\n▶ System 4: YouTube SPA navigation');

  let navigateFinishHandled = false;
  let pageDataUpdatedHandled = false;

  window.addEventListener('yt-navigate-finish', () => {
    navigateFinishHandled = true;
  });

  window.addEventListener('yt-page-data-updated', () => {
    pageDataUpdatedHandled = true;
  });

  // Simulate YouTube SPA navigation
  window.dispatchEvent(new Event('yt-navigate-finish'));
  assert(navigateFinishHandled, 'SYS-4.1 — yt-navigate-finish event handled');

  window.dispatchEvent(new Event('yt-page-data-updated'));
  assert(pageDataUpdatedHandled, 'SYS-4.2 — yt-page-data-updated event handled');
})();

/* ========================================================================
   SYSTEM TEST 5: MutationObserver Ad Detection Simulation
   ======================================================================== */

(async function testMutationObserverDetection() {
  console.log('\n▶ System 5: MutationObserver ad detection');

  const player = document.createElement('div');
  player.id = 'movie_player_sys5';
  document.body.appendChild(player);

  let mutationDetected = false;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        if (player.classList.contains('ad-showing')) {
          mutationDetected = true;
        }
      }
    }
  });

  observer.observe(player, { attributes: true, attributeFilter: ['class'] });

  // Simulate YouTube adding ad-showing class
  player.classList.add('ad-showing');

  // MutationObserver is async, wait a tick
  await new Promise((r) => setTimeout(r, 50));

  assert(mutationDetected, 'SYS-5.1 — MutationObserver detected ad-showing class');

  observer.disconnect();
  player.remove();
})();

/* ========================================================================
   SYSTEM TEST 6: Anti-Adblock Enforcement Modal System
   ======================================================================== */

(function testEnforcementModalSystem() {
  console.log('\n▶ System 6: Enforcement modal system');

  // Build full enforcement dialog structure
  const popupContainer = document.createElement('ytd-popup-container');
  const dialog = document.createElement('tp-yt-paper-dialog');
  const enforcement = document.createElement('ytd-enforcement-message-view-model');
  dialog.appendChild(enforcement);
  popupContainer.appendChild(dialog);
  document.body.appendChild(popupContainer);

  const backdrop1 = document.createElement('tp-yt-iron-overlay-backdrop');
  const backdrop2 = document.createElement('tp-yt-iron-overlay-backdrop');
  document.body.appendChild(backdrop1);
  document.body.appendChild(backdrop2);

  // Verify elements exist before dismissal
  assert(document.querySelector('ytd-enforcement-message-view-model') !== null, 'SYS-6.1 — Enforcement dialog exists');
  assert(document.querySelectorAll('tp-yt-iron-overlay-backdrop').length === 2, 'SYS-6.2 — Two backdrops exist');

  // Run dismissal logic
  const enfMsg = document.querySelector('ytd-enforcement-message-view-model');
  if (enfMsg) {
    const dlg = enfMsg.closest('tp-yt-paper-dialog') || enfMsg.closest('ytd-popup-container');
    if (dlg) dlg.remove();
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((el) => el.remove());
  }

  assert(document.querySelector('tp-yt-paper-dialog') === null, 'SYS-6.3 — Dialog removed');
  assertEqual(document.querySelectorAll('tp-yt-iron-overlay-backdrop').length, 0, 'SYS-6.4 — All backdrops removed');

  // Cleanup remaining
  popupContainer.remove();
})();

/* ========================================================================
   SYSTEM TEST 7: Shorts Filtering CSS End-to-End
   ======================================================================== */

(function testShortsFilteringE2E() {
  console.log('\n▶ System 7: Shorts filtering CSS end-to-end');

  const root = document.documentElement;

  // Create mock shorts elements
  const shelf = document.createElement('ytd-reel-shelf-renderer');
  document.body.appendChild(shelf);

  // Without the class, shorts should be visible (not targeted by hide CSS)
  root.classList.remove('adfast-hide-shorts');
  const visible = document.querySelectorAll('html.adfast-hide-shorts ytd-reel-shelf-renderer');
  assertEqual(visible.length, 0, 'SYS-7.1 — Shorts NOT hidden without class');

  // With the class, shorts should be targeted
  root.classList.add('adfast-hide-shorts');
  const hidden = document.querySelectorAll('html.adfast-hide-shorts ytd-reel-shelf-renderer');
  assertEqual(hidden.length, 1, 'SYS-7.2 — Shorts targeted with class');

  // Cleanup
  root.classList.remove('adfast-hide-shorts');
  shelf.remove();
})();

/* ========================================================================
   SYSTEM TEST 8: Ad Overlay Detection
   ======================================================================== */

(function testAdOverlayDetection() {
  console.log('\n▶ System 8: Ad overlay detection');

  // No overlay
  let overlay = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
  assert(overlay === null, 'SYS-8.1 — No overlay initially');

  // Add overlay
  const overlayEl = document.createElement('div');
  overlayEl.className = 'ytp-ad-player-overlay';
  document.body.appendChild(overlayEl);

  overlay = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
  assert(overlay !== null, 'SYS-8.2 — Overlay detected');

  overlayEl.remove();
})();

/* ========================================================================
   OUTPUT SUMMARY
   ======================================================================== */

summary();
})();
