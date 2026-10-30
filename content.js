/**
 * AdFast - High-speed YouTube Ad Controller & DOM Observer
 * Bypasses video ads instantaneously using player manipulation
 * without triggering anti-adblock detection or freezing the page.
 */

(() => {
  'use strict';

  // State variables
  let isEnabled = true;
  let hideShorts = false;
  let isCurrentlyInAd = false;
  let clickedCurrentAd = false;
  let savedPlaybackRate = 1;
  let scriptMutedVideo = false;
  let lastAdCountedTime = 0;
  const AD_COUNT_DEBOUNCE_MS = 1500;

  // Strict 1200ms cooldown for trusted CDP clicks to prevent hitting scrub bar
  let lastTrustedClickTime = 0;
  const TRUSTED_CLICK_COOLDOWN_MS = 1200;

  // Debounce for skip button triggers to prevent event storming
  let lastSkipTime = 0;
  const SKIP_DEBOUNCE_MS = 150;

  // Selectors for skip and close buttons across various YouTube player versions
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
    '.ytp-ad-overlay-close-container button'
  ];

  /**
   * Synchronize configuration with chrome.storage.local
   */
  async function initConfig() {
    try {
      const data = await chrome.storage.local.get({
        enabled: true,
        hideShorts: false
      });
      isEnabled = data.enabled !== false;
      hideShorts = !!data.hideShorts;
      applyDocumentClasses();
    } catch (err) {
      // Storage access error or context invalidated
    }
  }

  /**
   * Reflect current settings on document root for pure CSS rules
   */
  function applyDocumentClasses() {
    const root = document.documentElement;
    if (!root) return;

    if (isEnabled) {
      root.classList.remove('adfast-disabled');
    } else {
      root.classList.add('adfast-disabled');
      // If disabled mid-playback, restore video
      if (isCurrentlyInAd) {
        restoreNormalPlayback();
      }
    }

    if (hideShorts) {
      root.classList.add('adfast-hide-shorts');
    } else {
      root.classList.remove('adfast-hide-shorts');
    }
  }

  /**
   * Listen for live changes from popup toggles
   */
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.enabled) {
      isEnabled = changes.enabled.newValue !== false;
      applyDocumentClasses();
      if (isEnabled) {
        processAdCycle();
      }
    }

    if (changes.hideShorts) {
      hideShorts = !!changes.hideShorts.newValue;
      applyDocumentClasses();
    }
  });

  /**
   * Safely increment the ads bypassed counter in storage
   */
  async function incrementAdsSkipped() {
    try {
      const res = await chrome.storage.local.get({ adsSkippedCount: 0 });
      const current = res.adsSkippedCount || 0;
      await chrome.storage.local.set({ adsSkippedCount: current + 1 });
    } catch (e) {
      // Ignore storage error
    }
  }

  // Listen for ad skip events dispatched by MAIN-world page-bridge
  window.addEventListener('adfast:ad-skipped', () => {
    incrementAdsSkipped();
  });

  /**
   * Request a genuine hardware-level mouse click via chrome.debugger (CDP) in background.js.
   * This generates an event with event.isTrusted === true that YouTube's player accepts.
   * Debounced with 1200ms cooldown and gated strictly on active ad classes to prevent hitting the scrub bar.
   */
  function requestTrustedClick(x, y) {
    const now = Date.now();
    if (now - lastTrustedClickTime < TRUSTED_CLICK_COOLDOWN_MS) {
      return;
    }
    if (!isPlayerShowingAd()) {
      return;
    }
    lastTrustedClickTime = now;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({
          action: 'adfast:trusted-click',
          x,
          y
        }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            // Background is dormant or disconnected
          }
        });
      }
    } catch (e) {
      // Runtime context invalidated
    }
  }

  /**
   * Verify that a skip button has real rendered dimensions (>10x10) and is visible.
   */
  function isButtonVisibleAndClickable(btn, rect) {
    if (!btn || !rect) return false;
    if (rect.width <= 10 || rect.height <= 10) return false;
    if (typeof window.getComputedStyle === 'function') {
      try {
        const style = window.getComputedStyle(btn);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
      } catch (e) {}
    }
    return true;
  }

  /**
   * Click any available skip or close buttons using trusted CDP clicks (max once per ad)
   * and safe synthetic clicks directly on the button element.
   */
  function clickSkipButtons() {
    if (!isPlayerShowingAd()) {
      return;
    }

    const now = Date.now();
    if (now - lastSkipTime < SKIP_DEBOUNCE_MS) {
      return;
    }

    for (const selector of SKIP_BUTTON_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const btn = (typeof el.closest === 'function' ? el.closest('button, [role="button"]') : null) || el;
        if (btn) {
          try {
            const rect = btn.getBoundingClientRect();
            // Verify button has real rendered dimensions in viewport (>10x10) and is visible
            if (isButtonVisibleAndClickable(btn, rect)) {
              lastSkipTime = now;
              const clientX = Math.round(rect.left + rect.width / 2);
              const clientY = Math.round(rect.top + rect.height / 2);

              // 1. Dispatch genuine trusted click via background CDP (only ONCE per ad cycle)
              if (!clickedCurrentAd && isPlayerShowingAd()) {
                clickedCurrentAd = true;
                requestTrustedClick(clientX, clientY);
              }

              // 2. Direct synthetic DOM click is safe and cannot hit the scrub bar beneath it
              if (typeof btn.click === 'function') {
                btn.click();
              }

              // Synthetic Pointer/Touch/Mouse events directly on the button element
              const eventOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
              try {
                btn.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
                btn.dispatchEvent(new PointerEvent('pointerup', eventOpts));
                btn.dispatchEvent(new MouseEvent('click', eventOpts));
              } catch (e) {}

              try {
                btn.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
                btn.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
              } catch (e) {}

              break;
            }
          } catch (e) {}
        }
      }
    }

    // Signal page-bridge.js (MAIN world) to run its check
    try {
      window.dispatchEvent(new CustomEvent('adfast:skip-ad'));
    } catch (e) {
      // Ignore dispatch error
    }
  }

  /**
   * Restore video playback rate and mute state when ad finishes
   */
  function restoreNormalPlayback(videoElement) {
    isCurrentlyInAd = false;
    clickedCurrentAd = false;
    const video = videoElement || document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');
    if (!video) return;

    // Restore playback rate (fallback to 1 if anomalous)
    if (savedPlaybackRate && isFinite(savedPlaybackRate) && savedPlaybackRate >= 0.25 && savedPlaybackRate <= 4) {
      video.playbackRate = savedPlaybackRate;
    } else {
      video.playbackRate = 1;
    }

    // Restore audio if muted by script
    if (scriptMutedVideo) {
      video.muted = false;
      scriptMutedVideo = false;
    }

    // Resume video if paused
    if (video.paused && video.currentTime > 0) {
      video.play().catch(() => {});
    }
  }

  /**
   * Check if YouTube's player is actively playing an in-stream ad.
   * STRICT: Only the player element classes 'ad-showing' or 'ad-interrupting'
   * are valid indicators. Residual overlay elements in the DOM are ignored
   * to protect the main content video.
   */
  function isPlayerShowingAd() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return false;
    return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  }

  /**
   * Handle active video ad bypass safely without corrupting video playback
   */
  function handleAdActive(video) {
    if (!video) return;

    // Strict safety check: Never manipulate the video unless confirmed in-stream ad
    if (!isPlayerShowingAd()) return;

    // If starting a new ad
    if (!isCurrentlyInAd) {
      isCurrentlyInAd = true;

      // Capture normal rate if not in 16x speed
      if (video.playbackRate > 0 && video.playbackRate <= 4) {
        savedPlaybackRate = video.playbackRate || 1;
      }

      // Mute audio during ad
      if (!video.muted) {
        video.muted = true;
        scriptMutedVideo = true;
      }

      // Record skipped ad count with debounce
      const now = Date.now();
      if (now - lastAdCountedTime > AD_COUNT_DEBOUNCE_MS) {
        lastAdCountedTime = now;
        incrementAdsSkipped();
      }
    }

    // Ensure muted
    if (!video.muted) {
      video.muted = true;
      scriptMutedVideo = true;
    }

    // Force 16x playback speed to pass countdowns rapidly (~300ms for 5s)
    if (video.playbackRate !== 16) {
      video.playbackRate = 16;
    }

    // Ensure playback isn't stalled (NOTE: Never dispatchEvent('ended') - corrupts MSE pipeline)
    if (video.paused && video.currentTime > 0) {
      video.play().catch(() => {});
    }

    // Click skip buttons (debounced to avoid event storming)
    clickSkipButtons();
  }

  /**
   * Detect and automatically dismiss anti-adblock enforcement dialogs and unlock scrolling
   */
  function dismissEnforcementModals() {
    const enforcementMsg = document.querySelector('ytd-enforcement-message-view-model');
    if (enforcementMsg) {
      const dialog = enforcementMsg.closest('tp-yt-paper-dialog') || enforcementMsg.closest('ytd-popup-container');
      if (dialog) {
        try { dialog.remove(); } catch (e) {}
      }
      try { enforcementMsg.remove(); } catch (e) {}

      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((el) => {
        try { el.remove(); } catch (e) {}
      });
      document.documentElement.classList.add('adfast-backdrop-blocked');

      // Restore scroll locks if YouTube disabled scrolling
      [document.body, document.documentElement, document.querySelector('ytd-app')].forEach((el) => {
        if (!el) return;
        el.style.removeProperty('overflow');
        el.style.removeProperty('position');
        el.style.removeProperty('top');
        el.style.removeProperty('width');
        el.style.removeProperty('touch-action');
      });

      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }
  }

  /**
   * Attach loadeddata and durationchange listeners on video element to instantly
   * guard the main video and restore normal playback when ad classes drop.
   */
  function attachVideoGuards(video) {
    if (!video || video._adfastGuarded) return;
    video._adfastGuarded = true;

    const onStateCheck = () => {
      if (!isPlayerShowingAd() && (isCurrentlyInAd || video.playbackRate === 16 || scriptMutedVideo)) {
        restoreNormalPlayback(video);
      }
    };

    video.addEventListener('loadeddata', onStateCheck);
    video.addEventListener('durationchange', onStateCheck);
  }

  /**
   * Primary inspection cycle: detects ads and controls video player
   */
  function processAdCycle() {
    if (!isEnabled) return;

    dismissEnforcementModals();

    const isAd = isPlayerShowingAd();
    const video = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');

    if (video) {
      attachVideoGuards(video);
    }

    if (isAd && video) {
      handleAdActive(video);
    } else if (!isAd && (isCurrentlyInAd || (video && (video.playbackRate === 16 || scriptMutedVideo)))) {
      restoreNormalPlayback(video);
    }
  }

  /**
   * Throttled cycle runner using requestAnimationFrame to ensure
   * the main thread is never blocked and the page stays 100% responsive
   */
  let isThrottled = false;
  function throttledProcessAdCycle() {
    if (isThrottled) return;
    isThrottled = true;
    window.requestAnimationFrame(() => {
      isThrottled = false;
      processAdCycle();
    });
  }

  /**
   * Initialize DOM observer and periodic heartbeat timer
   */
  function startEngine() {
    initConfig();

    // Ensure classes are applied once DOM element is ready
    if (document.documentElement) {
      applyDocumentClasses();
    } else {
      document.addEventListener('DOMContentLoaded', applyDocumentClasses, { once: true });
    }

    // Scoped MutationObserver: Watches ONLY class attribute changes on #movie_player
    // (ad-showing / ad-interrupting), NOT childList/subtree, which prevents infinite loops
    let playerObserver = null;

    function attachPlayerObserver() {
      const player = document.getElementById('movie_player');
      if (player && !playerObserver) {
        playerObserver = new MutationObserver(throttledProcessAdCycle);
        playerObserver.observe(player, {
          attributes: true,
          attributeFilter: ['class']
        });
        return true;
      }
      return false;
    }

    // Attach observer as soon as #movie_player exists (no heavy document subtree observation)
    if (!attachPlayerObserver()) {
      const waitTimer = setInterval(() => {
        if (attachPlayerObserver()) {
          clearInterval(waitTimer);
        }
      }, 200);
    }

    // Lightweight 200ms periodic heartbeat (low CPU, skips when tab hidden unless in ad)
    setInterval(() => {
      if (document.hidden && !isCurrentlyInAd) return;
      processAdCycle();
    }, 200);

    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', () => {
      isCurrentlyInAd = false;
      processAdCycle();
      if (playerObserver) {
        playerObserver.disconnect();
        playerObserver = null;
      }
      attachPlayerObserver();

      // Auto-resume playback if paused immediately following ad interception
      setTimeout(() => {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');
        if (video && video.currentTime < 2 && video.paused && !isPlayerShowingAd()) {
          video.play().catch(() => {});
        }
      }, 500);
    });

    window.addEventListener('yt-page-data-updated', processAdCycle);
  }

  // Start engine immediately
  startEngine();
})();
