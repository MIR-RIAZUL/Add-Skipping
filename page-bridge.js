/**
 * AdFast — Page Bridge (MAIN World Execution Engine)
 * ==================================================
 * Executes directly inside the page's MAIN JavaScript context at document_start.
 *
 * Implements a 3-Layer Architecture (proven by top Chrome Web Store ad blockers):
 *  - LAYER 1 (Preventive): Intercepts ytInitialPlayerResponse, ytInitialData, ytcfg,
 *                          JSON.parse, window.fetch, and XMLHttpRequest to strip ad
 *                          placements and configs BEFORE YouTube's player schedules them.
 *                          The video starts directly from second 0 with 0 ads and 0 buffering.
 *  - LAYER 2 (Cosmetic & Native API): Direct MAIN-world access to movie_player.skipAd(),
 *                          movie_player.finishAd(), and skip button triggers.
 *  - LAYER 3 (Fallback Finisher): If an ad slips through, immediately fast-forwards at 16x speed,
 *                          mutes, auto-clicks skip, and restores video.
 *
 * Designed for 0% CPU overhead, zero microtask thrashing, and zero page freezes.
 */

(() => {
  'use strict';

  // =========================================================================
  // LAYER 1: Preventive Ad Stripping & Network Interception
  // =========================================================================

  const _jsonParse = JSON.parse;

  // Ad Keys to strip from YouTube player responses
  const AD_KEYS = new Set([
    'adPlacements',
    'playerAds',
    'adSlots',
    'adBreakParams',
    'adBreakHeartbeatParams',
    'adPlaybackContext',
    'adServingData',
    'adContentLength',
    'adPlacementOverlayData',
    'serverStitchedAdsConfig'
  ]);

  const AD_CONFIG_KEYS = new Set([
    'adRequestConfig',
    'frescoPingConfig',
    'daiConfig'
  ]);

  function isExtensionDisabled() {
    return document.documentElement && document.documentElement.classList.contains('adfast-disabled');
  }

  /**
   * Deep recursive strip of ad keys from player response objects
   */
  function stripAdsDeep(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 12) return false;

    let stripped = false;

    // Strip ad keys at this level
    for (const key of AD_KEYS) {
      if (key in obj) {
        if (Array.isArray(obj[key])) {
          obj[key] = [];
        } else {
          delete obj[key];
        }
        stripped = true;
      }
    }

    // Strip ad config from playerConfig at this level
    if (obj.playerConfig && typeof obj.playerConfig === 'object') {
      for (const key of AD_CONFIG_KEYS) {
        if (obj.playerConfig[key]) {
          delete obj.playerConfig[key];
          stripped = true;
        }
      }
    }

    // Recurse into child objects/arrays
    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const val of values) {
      if (val && typeof val === 'object') {
        if (stripAdsDeep(val, depth + 1)) {
          stripped = true;
        }
      }
    }

    return stripped;
  }

  function stripAds(obj) {
    if (isExtensionDisabled()) return false;
    const stripped = stripAdsDeep(obj, 0);
    if (stripped) {
      try {
        window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
      } catch (e) {}
    }
    return stripped;
  }

  function isPlayerResponse(obj) {
    return (
      obj &&
      typeof obj === 'object' &&
      (obj.videoDetails || obj.streamingData || obj.playabilityStatus)
    );
  }

  const PLAYER_RESPONSE_KEYS = [
    'bootstrapPlayerResponse',
    'playerResponse',
    'player_response',
    'raw_player_response'
  ];

  function parseJsonObjectMaybe(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;

    try {
      const parsed = _jsonParse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function sanitizePlayerResponseValue(value) {
    if (!value) return { value, stripped: false };

    if (typeof value === 'string') {
      const parsed = parseJsonObjectMaybe(value);
      if (!parsed) return { value, stripped: false };

      const stripped = stripAds(parsed);
      return {
        value: stripped ? JSON.stringify(parsed) : value,
        stripped
      };
    }

    if (typeof value === 'object') {
      return { value, stripped: stripAds(value) };
    }

    return { value, stripped: false };
  }

  function sanitizePlayerBootstrap(target) {
    if (!target || typeof target !== 'object' || isExtensionDisabled()) return false;

    let stripped = false;
    const containers = [target, target.config, target.config?.args];

    for (const container of containers) {
      if (!container || typeof container !== 'object') continue;

      for (const key of PLAYER_RESPONSE_KEYS) {
        if (!(key in container)) continue;
        const result = sanitizePlayerResponseValue(container[key]);
        if (!result.stripped) continue;

        if (result.value !== container[key]) {
          container[key] = result.value;
        }
        stripped = true;
      }
    }

    return stripped;
  }

  function stripAutoplayOverlayAds(obj) {
    const autoplayRenderer =
      obj?.playerOverlays?.playerOverlayRenderer?.autoplay?.playerOverlayAutoplayRenderer;
    if (!autoplayRenderer?.adPlacements) return false;

    autoplayRenderer.adPlacements = [];
    try {
      window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
    } catch (e) {}
    return true;
  }

  function sanitizeKnownPlayerData(obj) {
    if (!obj || typeof obj !== 'object' || isExtensionDisabled()) return false;

    let stripped = false;
    stripped = sanitizePlayerBootstrap(obj) || stripped;
    stripped = stripAutoplayOverlayAds(obj) || stripped;

    if (isPlayerResponse(obj)) {
      stripped = stripAds(obj) || stripped;
    }
    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      stripped = stripAds(obj.playerResponse) || stripped;
    }
    if (obj.response?.playerResponse && typeof obj.response.playerResponse === 'object') {
      stripped = stripAds(obj.response.playerResponse) || stripped;
    }
    if (obj.data?.playerResponse && typeof obj.data.playerResponse === 'object') {
      stripped = stripAds(obj.data.playerResponse) || stripped;
    }
    if (obj.contents?.twoColumnWatchNextResults?.playerResponse) {
      stripped = stripAds(obj.contents.twoColumnWatchNextResults.playerResponse) || stripped;
    }

    return stripped;
  }

  // Hook JSON.parse to sanitize player responses as they are parsed
  function hookJsonParse() {
    if (JSON.parse.__adfastHooked) return;

    const wrappedParse = function (...args) {
      const result = _jsonParse.apply(this, args);
      try {
        if (!isExtensionDisabled()) {
          sanitizeKnownPlayerData(result);
        }
      } catch (e) {}
      return result;
    };

    try {
      Object.defineProperty(wrappedParse, '__adfastHooked', { value: true });
    } catch (e) {}

    JSON.parse = wrappedParse;
  }

  function parseUrlMaybe(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
      return new URL(url, location.href);
    } catch {
      return null;
    }
  }

  // Detect ad tracking network requests
  function isAdTrackingUrl(url) {
    if (typeof url !== 'string') return false;
    if (url.includes('/api/stats/watchtime') && (url.includes('el=adunit') || /adformat=\d/.test(url))) return true;
    if (url.includes('/api/stats/qoe') && /adformat=\d/.test(url)) return true;
    if (url.includes('/api/stats/ads')) return true;
    if (url.includes('/youtubei/v1/player/ad_break')) return true;
    return false;
  }

  // Detect googlevideo.com /videoplayback ad video segments (ctier=L, oad, adformat)
  function isAdVideoUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (!url.includes('googlevideo.com') || !url.includes('/videoplayback')) return false;
    const parsed = parseUrlMaybe(url);
    if (!parsed) return false;
    return (
      parsed.searchParams.get('ctier') === 'L' ||
      parsed.searchParams.has('oad') ||
      parsed.searchParams.has('adformat')
    );
  }

  function hookObjectProperty(target, name, transform) {
    if (!target || typeof target !== 'object') return;

    const apply = (value) => {
      const next = transform(value);
      return next === undefined ? value : next;
    };

    let stored = target[name];
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        get() { return stored; },
        set(value) { stored = apply(value); }
      });
    } catch {
      stored = apply(stored);
      return;
    }

    stored = apply(stored);
  }

  function hookYtplayerArgs(args) {
    if (!args || typeof args !== 'object' || args.__adfastHookedArgs) return;
    args.__adfastHookedArgs = true;

    for (const key of ['raw_player_response', 'player_response', 'playerResponse']) {
      hookObjectProperty(args, key, (value) => sanitizePlayerResponseValue(value).value);
    }
    sanitizePlayerBootstrap(args);
  }

  function hookYtplayerObject(target) {
    if (!target || typeof target !== 'object' || target.__adfastHookedYtplayer) return;
    target.__adfastHookedYtplayer = true;

    hookObjectProperty(target, 'bootstrapPlayerResponse', (value) => sanitizePlayerResponseValue(value).value);
    hookObjectProperty(target, 'playerResponse', (value) => sanitizePlayerResponseValue(value).value);
    hookObjectProperty(target, 'player_response', (value) => sanitizePlayerResponseValue(value).value);
    hookObjectProperty(target, 'config', (value) => {
      sanitizePlayerBootstrap(value);
      if (value?.args) hookYtplayerArgs(value.args);
      return value;
    });

    if (target.config?.args) hookYtplayerArgs(target.config.args);
    sanitizePlayerBootstrap(target);
  }

  function hookYtplayer() {
    const process = (value) => {
      hookYtplayerObject(value);
      sanitizePlayerBootstrap(value);
      return value;
    };

    let stored = window.ytplayer;
    try {
      Object.defineProperty(window, 'ytplayer', {
        configurable: true,
        get() { return stored; },
        set(value) { stored = process(value); }
      });
    } catch {}

    stored = process(stored);
  }

  function hookGlobalProperty(name) {
    let stored = window[name];
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { return stored; },
        set(value) {
          if (value && typeof value === 'object' && !isExtensionDisabled()) {
            stripAds(value);
            if (value.playerResponse) stripAds(value.playerResponse);
          }
          stored = value;
        }
      });
    } catch {}

    if (stored && typeof stored === 'object' && !isExtensionDisabled()) {
      stripAds(stored);
      if (stored.playerResponse) stripAds(stored.playerResponse);
    }
  }

  function hookPageData(name) {
    let stored = window[name];
    const process = (obj) => {
      if (!obj || typeof obj !== 'object' || isExtensionDisabled()) return;
      if (obj.playerResponse) stripAds(obj.playerResponse);
      if (obj.contents?.twoColumnWatchNextResults?.playerResponse) {
        stripAds(obj.contents.twoColumnWatchNextResults.playerResponse);
      }
    };
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() { return stored; },
        set(value) { process(value); stored = value; }
      });
    } catch {}
    process(stored);
  }

  function hookYtcfg() {
    const ytcfg = window.ytcfg;
    if (!ytcfg || ytcfg.__adfastHooked) return;
    ytcfg.__adfastHooked = true;

    if (typeof ytcfg.set === 'function') {
      const origSet = ytcfg.set;
      ytcfg.set = function (...args) {
        if (!isExtensionDisabled()) {
          if (args.length >= 1 && args[0] && typeof args[0] === 'object') {
            for (const val of Object.values(args[0])) {
              if (isPlayerResponse(val)) stripAds(val);
            }
          }
          if (args.length >= 2 && isPlayerResponse(args[1])) {
            stripAds(args[1]);
          }
        }
        return origSet.apply(this, args);
      };
    }

    if (typeof ytcfg.get === 'function') {
      const origGet = ytcfg.get;
      ytcfg.get = function (...args) {
        const result = origGet.apply(this, args);
        if (!isExtensionDisabled() && isPlayerResponse(result)) {
          stripAds(result);
        }
        return result;
      };
    }
  }

  // Intercept window.fetch to block ad tracking and sanitize player responses
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    if (isExtensionDisabled()) {
      return _fetch.apply(this, args);
    }

    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';

    // Block ad tracking requests outright with 204 No Content
    if (isAdTrackingUrl(url)) {
      return new Response('', { status: 204, statusText: 'No Content' });
    }

    // Block ad video segments (ctier=L pre-rolls)
    if (isAdVideoUrl(url)) {
      try {
        window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
      } catch (e) {}
      return new Response('', { status: 204, statusText: 'No Content' });
    }

    const response = await _fetch.apply(this, args);

    const isPlayerEndpoint =
      url.includes('/youtubei/v1/player') ||
      url.includes('/get_video_info');
    const isWatchDataEndpoint =
      url.includes('/youtubei/v1/next') ||
      url.includes('/youtubei/v1/browse') ||
      url.includes('/youtubei/v1/reel/');

    if (isPlayerEndpoint || isWatchDataEndpoint) {
      const clone = response.clone();
      try {
        const text = await clone.text();
        const data = _jsonParse(text);

        if (isPlayerEndpoint) stripAds(data);
        if (data.playerResponse) stripAds(data.playerResponse);
        if (data.contents?.twoColumnWatchNextResults?.playerResponse) {
          stripAds(data.contents.twoColumnWatchNextResults.playerResponse);
        }

        const headers = new Headers();
        for (const [k, v] of response.headers) {
          const lower = k.toLowerCase();
          if (lower === 'content-encoding' || lower === 'content-length') continue;
          headers.set(k, v);
        }

        const newResponse = new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
        Object.defineProperty(newResponse, 'url', { value: response.url });
        Object.defineProperty(newResponse, 'redirected', { value: response.redirected });
        return newResponse;
      } catch {
        return response;
      }
    }

    return response;
  };

  // Intercept XMLHttpRequest
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._adfastUrl = (typeof url === 'string' ? url : url?.toString()) || '';
    this._adfastBlocked = !isExtensionDisabled() && (isAdTrackingUrl(this._adfastUrl) || isAdVideoUrl(this._adfastUrl));
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this._adfastBlocked) {
      try {
        window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
      } catch (e) {}
      Object.defineProperty(this, 'status', { value: 204, configurable: true });
      Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(this, 'responseText', { value: '', configurable: true });
      Object.defineProperty(this, 'response', { value: '', configurable: true });
      try { this.dispatchEvent(new Event('readystatechange')); } catch {}
      try { this.dispatchEvent(new Event('load')); } catch {}
      return;
    }

    if (
      this._adfastUrl &&
      !isExtensionDisabled() &&
      (this._adfastUrl.includes('/youtubei/v1/player') || this._adfastUrl.includes('/get_video_info'))
    ) {
      this.addEventListener('readystatechange', function () {
        if (this.readyState === 4 && this.status === 200) {
          try {
            const data = _jsonParse(this.responseText);
            stripAds(data);
            const stripped = JSON.stringify(data);
            Object.defineProperty(this, 'responseText', {
              value: stripped,
              configurable: true
            });
            Object.defineProperty(this, 'response', {
              value: this.responseType === 'json' ? data : stripped,
              configurable: true
            });
          } catch {}
        }
      });
    }

    return _xhrSend.apply(this, args);
  };

  // Initialize Layer 1 hooks immediately
  hookGlobalProperty('ytInitialPlayerResponse');
  hookPageData('ytInitialData');
  hookYtplayer();
  hookJsonParse();

  if (window.ytcfg) {
    hookYtcfg();
  } else {
    let _ytcfg;
    try {
      Object.defineProperty(window, 'ytcfg', {
        configurable: true,
        get() { return _ytcfg; },
        set(value) {
          _ytcfg = value;
          if (value) hookYtcfg();
        }
      });
    } catch {
      const poll = setInterval(() => {
        if (window.ytcfg) {
          clearInterval(poll);
          hookYtcfg();
        }
      }, 50);
      setTimeout(() => clearInterval(poll), 30000);
    }
  }

  // Periodic safety check for the first 30 seconds
  let safetyChecks = 0;
  const safetyTimer = setInterval(() => {
    if (++safetyChecks > 60) {
      clearInterval(safetyTimer);
      return;
    }
    if (isExtensionDisabled()) return;

    try {
      const pr = window.ytInitialPlayerResponse;
      if (pr && typeof pr === 'object') stripAds(pr);
    } catch {}

    try {
      const id = window.ytInitialData;
      if (id?.playerResponse) stripAds(id.playerResponse);
      if (id?.contents?.twoColumnWatchNextResults?.playerResponse) {
        stripAds(id.contents.twoColumnWatchNextResults.playerResponse);
      }
    } catch {}

    try {
      sanitizePlayerBootstrap(window.ytplayer);
      hookYtplayer();
    } catch {}

    hookJsonParse();
    hookYtcfg();
  }, 500);

  // =========================================================================
  // LAYER 2 & 3: Active Video Fallback Skip & Auto-Clicker
  // =========================================================================

  let savedPlaybackRate = 1;
  let isAdActive = false;
  let adSkipTimer = null;
  let lastBridgeClickTime = 0;
  const BRIDGE_CLICK_DEBOUNCE_MS = 250;
  let lastPlayerMethodTime = 0;
  const PLAYER_METHOD_DEBOUNCE_MS = 500;

  // Modern YouTube skip button selectors (most specific button selectors first)
  const SKIP_SELECTORS = [
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
   * Find the actual clickable button element (resolves container/text to button)
   */
  function findSkipButton() {
    for (const selector of SKIP_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) {
        const clickable =
          (typeof el.closest === 'function'
            ? el.closest('button, [role="button"]')
            : null) || el;
        return clickable;
      }
    }
    return null;
  }

  /**
   * Dispatch clean DOM synthetic click on the button element directly
   * ONLY when #movie_player is actively displaying an ad.
   * Debounced to prevent event storming and main-thread saturation.
   */
  function triggerSkipClick(button) {
    if (!button) return;

    const now = Date.now();
    if (now - lastBridgeClickTime < BRIDGE_CLICK_DEBOUNCE_MS) {
      return;
    }

    const player = document.getElementById('movie_player');
    const inAd =
      player &&
      (player.classList.contains('ad-showing') ||
       player.classList.contains('ad-interrupting'));

    if (!inAd) return;
    lastBridgeClickTime = now;

    try {
      // 1. Direct synthetic DOM click
      if (typeof button.click === 'function') {
        button.click();
      }

      const rect = button.getBoundingClientRect();
      const clientX = Math.round(
        rect.left + (rect.width > 0 ? rect.width / 2 : 12)
      );
      const clientY = Math.round(
        rect.top + (rect.height > 0 ? rect.height / 2 : 12)
      );

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      };

      // 2. PointerEvents
      if (typeof PointerEvent === 'function') {
        try {
          button.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
          button.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        } catch (pe) {}
      }

      // 3. MouseEvents
      if (typeof MouseEvent === 'function') {
        try {
          button.dispatchEvent(new MouseEvent('mousedown', eventOptions));
          button.dispatchEvent(new MouseEvent('mouseup', eventOptions));
          button.dispatchEvent(new MouseEvent('click', eventOptions));
        } catch (me) {}
      }

      // 4. TouchEvents
      if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
        try {
          button.dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, cancelable: true })
          );
          button.dispatchEvent(
            new TouchEvent('touchend', { bubbles: true, cancelable: true })
          );
        } catch (te) {}
      }
    } catch (e) {}
  }

  /**
   * Dismiss the currently active in-stream ad
   */
  function dismissAd(player, video) {
    if (!player) player = document.getElementById('movie_player');
    if (!player) return;

    const inAd =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');

    if (!inAd) {
      stopAdPolling();
      if (isAdActive) {
        // Ad has completed — restore normal content playback immediately
        isAdActive = false;

        if (!video) {
          video =
            document.querySelector('video.html5-main-video') ||
            player.querySelector('video');
        }
        if (video) {
          video.playbackRate =
            savedPlaybackRate >= 0.25 && savedPlaybackRate <= 4
              ? savedPlaybackRate
              : 1;
          video.muted = false;
          if (video.paused && video.currentTime > 0) {
            video.play().catch(() => {});
          }
        }
      }
      return;
    }

    // Active in-stream ad detected
    if (!video) {
      video =
        document.querySelector('video.html5-main-video') ||
        player.querySelector('video');
    }

    if (!isAdActive) {
      isAdActive = true;
      if (video && video.playbackRate > 0 && video.playbackRate <= 4) {
        savedPlaybackRate = video.playbackRate;
      }
      window.dispatchEvent(new CustomEvent('adfast:ad-skipped'));
      startAdPolling();
    }

    // 1. Mute and fast-forward ad at 16x speed
    if (video) {
      if (!video.muted) video.muted = true;
      if (video.playbackRate !== 16) video.playbackRate = 16;
      if (video.paused && video.currentTime > 0) {
        video.play().catch(() => {});
      }
    }

    // 2. Try legacy player API methods (debounced)
    const now = Date.now();
    if (now - lastPlayerMethodTime >= PLAYER_METHOD_DEBOUNCE_MS) {
      lastPlayerMethodTime = now;
      try {
        if (typeof player.skipAd === 'function') {
          player.skipAd();
        }
      } catch (e) {}

      try {
        if (typeof player.finishAd === 'function') {
          player.finishAd();
        }
      } catch (e) {}
    }

    // 3. Find and auto-click any visible skip button in the DOM
    const skipBtn = findSkipButton();
    if (skipBtn) {
      triggerSkipClick(skipBtn);
    }
  }

  function startAdPolling() {
    if (adSkipTimer) return;
    adSkipTimer = setInterval(() => {
      const player = document.getElementById('movie_player');
      if (!player) {
        stopAdPolling();
        return;
      }

      const inAd =
        player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting');

      if (!inAd) {
        stopAdPolling();
        dismissAd(player, null);
      } else {
        dismissAd(player, null);
      }
    }, 250);
  }

  function stopAdPolling() {
    if (adSkipTimer) {
      clearInterval(adSkipTimer);
      adSkipTimer = null;
    }
  }

  /**
   * Responds to changes in player state
   */
  function onPlayerStateChange() {
    if (isExtensionDisabled()) {
      return;
    }

    const player = document.getElementById('movie_player');
    if (!player) return;

    const inAd =
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');

    if (inAd) {
      const video =
        document.querySelector('video.html5-main-video') ||
        player.querySelector('video');
      dismissAd(player, video);
      startAdPolling();
    } else if (isAdActive) {
      dismissAd(player, null);
    }
  }

  // Targeted class-only observer on #movie_player throttled with requestAnimationFrame
  // to eliminate synchronous microtask recursion and prevent UI freezing
  let observer = null;
  let isObserverThrottled = false;

  function throttledPlayerStateChange() {
    if (isObserverThrottled) return;
    isObserverThrottled = true;
    window.requestAnimationFrame(() => {
      isObserverThrottled = false;
      onPlayerStateChange();
    });
  }

  function initObserver() {
    const player = document.getElementById('movie_player');
    if (player && !observer) {
      observer = new MutationObserver(throttledPlayerStateChange);
      observer.observe(player, {
        attributes: true,
        attributeFilter: ['class']
      });
      throttledPlayerStateChange();
      return true;
    }
    return false;
  }

  if (!initObserver()) {
    const poll = setInterval(() => {
      if (initObserver()) {
        clearInterval(poll);
      }
    }, 200);
  }

  // YouTube SPA dynamic navigation
  window.addEventListener('yt-navigate-finish', () => {
    isAdActive = false;
    stopAdPolling();
    initObserver();
  });

  // Listen for signal from content.js
  window.addEventListener('adfast:skip-ad', () => {
    throttledPlayerStateChange();
  });
})();
