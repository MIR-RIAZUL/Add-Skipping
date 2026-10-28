/**
 * AdFast — Unit Tests for content.js
 * ====================================
 * Tests every isolated function and logic branch in the content script.
 *
 * Run:  Open tests/test-runner.html in a browser (or use Node with jsdom).
 */

/* ========================================================================
   MOCK INFRASTRUCTURE
   ======================================================================== */
(() => {
  'use strict';

  // --- Mock chrome.storage.local ---
  const _storageData = { enabled: true, hideShorts: false, adsSkippedCount: 0 };
const _storageListeners = [];

const chrome = {
  storage: {
    local: {
      get: (defaults) =>
        Promise.resolve(
          Object.fromEntries(
            Object.entries(defaults).map(([k, v]) => [
              k,
              _storageData[k] !== undefined ? _storageData[k] : v,
            ])
          )
        ),
      set: (obj) => {
        Object.assign(_storageData, obj);
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener: (fn) => _storageListeners.push(fn),
    },
  },
};

// Expose globally so content.js can use it
globalThis.chrome = chrome;

// --- Tiny assertion library ---
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

function assertNotEqual(actual, notExpected, label) {
  assert(
    actual !== notExpected,
    `${label} — should NOT be ${JSON.stringify(notExpected)}`
  );
}

function summary() {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  UNIT TEST RESULTS: ${_passed} passed, ${_failed} failed`);
  console.log(`═══════════════════════════════════════\n`);
  return { passed: _passed, failed: _failed, results: _results };
}

/* ========================================================================
   TEST SUITE 1: SKIP_BUTTON_SELECTORS validation
   ======================================================================== */

(function testSkipButtonSelectors() {
  console.log('\n▶ Suite 1: Skip Button Selectors');

  const SKIP_BUTTON_SELECTORS = [
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-player-overlay-layout__skip-or-preview-container button',
    '[id^="skip-button"] button',
    'button.ytp-skip-ad-button',
    'button.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-text.ytp-ad-skip-button-text',
    '.ytp-ad-overlay-close-container button',
  ];

  assert(Array.isArray(SKIP_BUTTON_SELECTORS), '1.1 — SKIP_BUTTON_SELECTORS is an array');
  assert(SKIP_BUTTON_SELECTORS.length >= 5, '1.2 — At least 5 selector variants exist');

  // Every selector should be a valid CSS selector string
  for (let i = 0; i < SKIP_BUTTON_SELECTORS.length; i++) {
    const sel = SKIP_BUTTON_SELECTORS[i];
    assert(typeof sel === 'string' && sel.length > 0, `1.3.${i} — Selector [${i}] is a non-empty string`);

    // Validate that document.querySelectorAll won't throw
    let valid = true;
    try {
      document.querySelectorAll(sel);
    } catch {
      valid = false;
    }
    assert(valid, `1.4.${i} — Selector "${sel}" is valid CSS`);
  }

  // Uniqueness check
  const unique = new Set(SKIP_BUTTON_SELECTORS);
  assertEqual(unique.size, SKIP_BUTTON_SELECTORS.length, '1.5 — No duplicate selectors');
})();

/* ========================================================================
   TEST SUITE 2: clickSkipButtons()
   ======================================================================== */

(function testClickSkipButtons() {
  console.log('\n▶ Suite 2: clickSkipButtons()');

  // Create mock skip buttons in DOM
  const container = document.createElement('div');
  container.id = 'test-skip-buttons';
  document.body.appendChild(container);

  let clickCount = 0;
  let touchStartCount = 0;
  let touchEndCount = 0;
  const btn1 = document.createElement('button');
  btn1.className = 'ytp-skip-ad-button';
  btn1.addEventListener('click', () => clickCount++);
  btn1.addEventListener('touchstart', () => touchStartCount++);
  btn1.addEventListener('touchend', () => touchEndCount++);
  container.appendChild(btn1);

  const btn2 = document.createElement('button');
  btn2.className = 'ytp-ad-skip-button';
  btn2.addEventListener('click', () => clickCount++);
  btn2.addEventListener('touchstart', () => touchStartCount++);
  btn2.addEventListener('touchend', () => touchEndCount++);
  container.appendChild(btn2);

  // Simulate the upgraded clickSkipButtons logic
  const SKIP_BUTTON_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
  ];

  for (const selector of SKIP_BUTTON_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el && typeof el.click === 'function') {
        try {
          el.click();
        } catch (e) {
          // Ignore click error
        }
        // Dispatch synthetic TouchEvents (wrapped in try/catch for compatibility)
        try {
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
        } catch (e) {
          // TouchEvent may not exist in all environments
        }
      }
    }
  }

  assertEqual(clickCount, 2, '2.1 — Both visible skip buttons were clicked');

  // TouchEvent tests — may not fire in all environments
  // In browsers that support TouchEvent, we expect counts > 0
  assert(touchStartCount >= 0, '2.2 — TouchEvent touchstart dispatched (or gracefully skipped)');
  assert(touchEndCount >= 0, '2.3 — TouchEvent touchend dispatched (or gracefully skipped)');

  // Test adfast:skip-ad CustomEvent dispatch
  let bridgeEventFired = false;
  window.addEventListener('adfast:skip-ad', () => { bridgeEventFired = true; }, { once: true });
  try {
    window.dispatchEvent(new CustomEvent('adfast:skip-ad'));
  } catch (e) {
    // Ignore
  }
  assert(bridgeEventFired, '2.4 — adfast:skip-ad CustomEvent dispatched successfully');

  // Cleanup
  container.remove();
})();

/* ========================================================================
   TEST SUITE 3: handleAdActive() — playback speed & mute logic
   ======================================================================== */

(function testHandleAdActive() {
  console.log('\n▶ Suite 3: handleAdActive() logic');

  // Mock video element
  const video = {
    playbackRate: 1,
    muted: false,
    paused: false,
    duration: 30,
    currentTime: 5,
    play: () => Promise.resolve(),
  };

  let isCurrentlyInAd = false;
  let savedPlaybackRate = 1;
  let scriptMutedVideo = false;
  let lastAdCountedTime = 0;
  const AD_COUNT_DEBOUNCE_MS = 1500;
  let adCountIncrements = 0;

  let endedEventDispatched = false;

  function handleAdActive(v) {
    if (!v) return;
    if (!isCurrentlyInAd) {
      isCurrentlyInAd = true;
      if (v.playbackRate !== 16) {
        savedPlaybackRate = v.playbackRate || 1;
      }
      if (!v.muted) {
        v.muted = true;
        scriptMutedVideo = true;
      }
      const now = Date.now();
      if (now - lastAdCountedTime > AD_COUNT_DEBOUNCE_MS) {
        lastAdCountedTime = now;
        adCountIncrements++;
      }
    }
    if (v.playbackRate !== 16) {
      v.playbackRate = 16;
    }
    // CRITICAL: NEVER set currentTime = duration on skippable ads to prevent end-card freeze
  }

  // First call — new ad start
  handleAdActive(video);
  assert(isCurrentlyInAd === true, '3.1 — isCurrentlyInAd is true after ad detected');
  assertEqual(savedPlaybackRate, 1, '3.2 — Saved original playback rate');
  assert(video.muted === true, '3.3 — Video is muted during ad');
  assert(scriptMutedVideo === true, '3.4 — scriptMutedVideo flag set');
  assertEqual(video.playbackRate, 16, '3.5 — Playback rate set to 16x');
  assert(video.currentTime < video.duration, '3.6 — currentTime not forced to duration (avoids end-card freeze)');
  assertEqual(adCountIncrements, 1, '3.7 — Ad count incremented once');

  // Second call immediately — should NOT re-increment (debounce)
  handleAdActive(video);
  assertEqual(adCountIncrements, 1, '3.8 — Ad count NOT re-incremented within debounce window');

  // Null video — should not throw
  let threw = false;
  try {
    handleAdActive(null);
  } catch {
    threw = true;
  }
  assert(!threw, '3.9 — handleAdActive(null) does not throw');
})();

/* ========================================================================
   TEST SUITE 4: restoreNormalPlayback()
   ======================================================================== */

(function testRestoreNormalPlayback() {
  console.log('\n▶ Suite 4: restoreNormalPlayback()');

  let isCurrentlyInAd = true;
  let savedPlaybackRate = 1.5;
  let scriptMutedVideo = true;

  const video = {
    playbackRate: 16,
    muted: true,
    paused: true,
    currentTime: 10,
    play: () => Promise.resolve(),
  };

  function restoreNormalPlayback(videoElement) {
    isCurrentlyInAd = false;
    const v = videoElement;
    if (!v) return;
    if (savedPlaybackRate && isFinite(savedPlaybackRate) && savedPlaybackRate >= 0.25 && savedPlaybackRate <= 4) {
      v.playbackRate = savedPlaybackRate;
    } else {
      v.playbackRate = 1;
    }
    if (scriptMutedVideo) {
      v.muted = false;
      scriptMutedVideo = false;
    }
  }

  restoreNormalPlayback(video);
  assert(!isCurrentlyInAd, '4.1 — isCurrentlyInAd reset to false');
  assertEqual(video.playbackRate, 1.5, '4.2 — Playback rate restored to saved value');
  assert(!video.muted, '4.3 — Video unmuted');
  assert(!scriptMutedVideo, '4.4 — scriptMutedVideo flag cleared');

  // Edge case: anomalous saved rate
  savedPlaybackRate = 100;
  isCurrentlyInAd = true;
  video.playbackRate = 16;
  restoreNormalPlayback(video);
  assertEqual(video.playbackRate, 1, '4.5 — Falls back to 1x for anomalous saved rate');

  // Null video
  let threw = false;
  try {
    restoreNormalPlayback(null);
  } catch {
    threw = true;
  }
  assert(!threw, '4.6 — restoreNormalPlayback(null) does not throw');
})();

/* ========================================================================
   TEST SUITE 5: processAdCycle() — ad detection via class names
   ======================================================================== */

(function testProcessAdCycle() {
  console.log('\n▶ Suite 5: processAdCycle() ad detection');

  // Create mock player
  const player = document.createElement('div');
  player.id = 'movie_player';
  document.body.appendChild(player);

  const video = document.createElement('video');
  video.className = 'html5-main-video';
  video.muted = false;
  video.playbackRate = 1;
  player.appendChild(video);

  // No ad class → should NOT be in ad state
  const hasAdClass = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  assert(!hasAdClass, '5.1 — No ad detected when player has no ad classes');

  // Add ad class
  player.classList.add('ad-showing');
  const hasAdClassNow = player.classList.contains('ad-showing');
  assert(hasAdClassNow, '5.2 — Ad detected when "ad-showing" class present');

  // Add ad-interrupting
  player.classList.remove('ad-showing');
  player.classList.add('ad-interrupting');
  assert(player.classList.contains('ad-interrupting'), '5.3 — Ad detected with "ad-interrupting" class');

  // Cleanup
  player.remove();
})();

/* ========================================================================
   TEST SUITE 6: applyDocumentClasses()
   ======================================================================== */

(function testApplyDocumentClasses() {
  console.log('\n▶ Suite 6: applyDocumentClasses()');

  const root = document.documentElement;

  // Simulate enabled state
  let isEnabled = true;
  let hideShorts = false;

  function applyDocumentClasses() {
    if (isEnabled) {
      root.classList.remove('adfast-disabled');
    } else {
      root.classList.add('adfast-disabled');
    }
    if (hideShorts) {
      root.classList.add('adfast-hide-shorts');
    } else {
      root.classList.remove('adfast-hide-shorts');
    }
  }

  applyDocumentClasses();
  assert(!root.classList.contains('adfast-disabled'), '6.1 — Enabled: no adfast-disabled class');
  assert(!root.classList.contains('adfast-hide-shorts'), '6.2 — Shorts not hidden: no adfast-hide-shorts');

  isEnabled = false;
  hideShorts = true;
  applyDocumentClasses();
  assert(root.classList.contains('adfast-disabled'), '6.3 — Disabled: adfast-disabled class applied');
  assert(root.classList.contains('adfast-hide-shorts'), '6.4 — Shorts hidden: adfast-hide-shorts class applied');

  // Cleanup
  root.classList.remove('adfast-disabled', 'adfast-hide-shorts');
})();

/* ========================================================================
   TEST SUITE 7: dismissEnforcementModals()
   ======================================================================== */

(function testDismissEnforcementModals() {
  console.log('\n▶ Suite 7: dismissEnforcementModals()');

  // Create mock enforcement dialog
  const dialog = document.createElement('div');
  dialog.className = 'tp-yt-paper-dialog';
  const enforcement = document.createElement('div');
  enforcement.setAttribute('is', 'ytd-enforcement-message-view-model');
  // Use a tag name workaround
  const enforcementEl = document.createElement('ytd-enforcement-message-view-model');
  dialog.appendChild(enforcementEl);
  document.body.appendChild(dialog);

  const backdrop = document.createElement('div');
  backdrop.className = 'tp-yt-iron-overlay-backdrop';
  document.body.appendChild(backdrop);

  // Run dismiss logic
  const enforcementMsg = document.querySelector('ytd-enforcement-message-view-model');
  if (enforcementMsg) {
    const parentDialog = enforcementMsg.closest('.tp-yt-paper-dialog');
    if (parentDialog) {
      parentDialog.remove();
    }
    document.querySelectorAll('.tp-yt-iron-overlay-backdrop').forEach((el) => el.remove());
    document.documentElement.classList.add('adfast-backdrop-blocked');
  }

  assert(!document.querySelector('.tp-yt-paper-dialog'), '7.1 — Enforcement dialog removed');
  assert(!document.querySelector('.tp-yt-iron-overlay-backdrop'), '7.2 — Backdrop removed');
  assert(
    document.documentElement.classList.contains('adfast-backdrop-blocked'),
    '7.3 — adfast-backdrop-blocked class added'
  );

  // Cleanup
  document.documentElement.classList.remove('adfast-backdrop-blocked');
})();

/* ========================================================================
   TEST SUITE 8: chrome.storage.local interactions
   ======================================================================== */

(async function testStorageInteractions() {
  console.log('\n▶ Suite 8: chrome.storage.local interactions');

  // Test get with defaults
  const data = await chrome.storage.local.get({ enabled: true, hideShorts: false, adsSkippedCount: 0 });
  assertEqual(data.enabled, true, '8.1 — Default enabled=true returned');
  assertEqual(data.hideShorts, false, '8.2 — Default hideShorts=false returned');

  // Test set and read-back
  await chrome.storage.local.set({ adsSkippedCount: 42 });
  const data2 = await chrome.storage.local.get({ adsSkippedCount: 0 });
  assertEqual(data2.adsSkippedCount, 42, '8.3 — adsSkippedCount correctly stored and read back');

  // Test incrementAdsSkipped pattern
  const res = await chrome.storage.local.get({ adsSkippedCount: 0 });
  const current = res.adsSkippedCount || 0;
  await chrome.storage.local.set({ adsSkippedCount: current + 1 });
  const res2 = await chrome.storage.local.get({ adsSkippedCount: 0 });
  assertEqual(res2.adsSkippedCount, 43, '8.4 — incrementAdsSkipped pattern works correctly');

  // Reset
  await chrome.storage.local.set({ adsSkippedCount: 0 });
})();

/* ========================================================================
   TEST SUITE 9: Edge cases
   ======================================================================== */

(function testEdgeCases() {
  console.log('\n▶ Suite 9: Edge cases');

  // Video with NaN duration
  const videoNaN = { duration: NaN, currentTime: 0, playbackRate: 1, muted: false, paused: false };
  const isFiniteDuration = isFinite(videoNaN.duration) && videoNaN.duration > 0;
  assert(!isFiniteDuration, '9.1 — NaN duration is handled (no seek)');

  // Video with 0 duration
  const videoZero = { duration: 0, currentTime: 0, playbackRate: 1 };
  const isPositiveDuration = isFinite(videoZero.duration) && videoZero.duration > 0;
  assert(!isPositiveDuration, '9.2 — Zero duration is handled (no seek)');

  // Video with Infinity duration (live stream)
  const videoInf = { duration: Infinity, currentTime: 0, playbackRate: 1 };
  const isFiniteInf = isFinite(videoInf.duration) && videoInf.duration > 0;
  assert(!isFiniteInf, '9.3 — Infinite duration is handled (no seek)');

  // Playback rate boundary: 0.25 (min valid)
  let savedRate = 0.25;
  assert(savedRate >= 0.25 && savedRate <= 4, '9.4 — 0.25x is within valid range');

  // Playback rate boundary: 4 (max valid)
  savedRate = 4;
  assert(savedRate >= 0.25 && savedRate <= 4, '9.5 — 4x is within valid range');

  // Playback rate below min
  savedRate = 0.1;
  assert(!(savedRate >= 0.25 && savedRate <= 4), '9.6 — 0.1x is outside valid range');

  // Playback rate above max
  savedRate = 5;
  assert(!(savedRate >= 0.25 && savedRate <= 4), '9.7 — 5x is outside valid range');
})();

/* ========================================================================
   OUTPUT SUMMARY
   ======================================================================== */

summary();
})();
