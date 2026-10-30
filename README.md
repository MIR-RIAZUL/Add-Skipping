# AdFast - Ad Skipper for YouTube (Edge, Firefox & Chrome)

A lightweight, production-grade Manifest V3 browser extension that instantaneously bypasses YouTube video ads and removes banner ads without triggering YouTube's anti-adblock detection. Fully compatible with **Microsoft Edge**, **Mozilla Firefox**, and **Google Chrome**.

---

## Features

- **Instant Video Ad Acceleration & Fast-Forwarding**: Safely bypasses in-stream video ads by setting player speed to 16x, fast-forwarding ad video `currentTime` to the end, muting audio during ads, and automatically triggering skip button events.
- **Zero Elevated Permissions**: Operates with only the standard `storage` permission — no `debugger` or invasive permissions required.
- **Zero Anti-Adblock Triggers**: Safely bypasses ads while auto-dismissing enforcement dialogs and restoring normal playback.
- **Cosmetic Banner & Feed Ad Removal**: Injects pure CSS to hide banners, promoted videos, search ads, and masthead ads cleanly with zero latency.
- **Customizable YouTube Shorts Filtering**: Dedicated toggle to hide YouTube Shorts shelves from the homepage and search feeds.
- **Modern Dark-Mode Dashboard**: Sleek 300px YouTube-themed toolbar popup with real-time stats, live sync via `chrome.storage.local`, and a reset counter.

---

## Project Structure

```text
Add-Skipping/
├── manifest.json         # Manifest V3 extension configuration (Universal: Edge, Firefox, Chrome)
├── background.js         # Background service worker / event page (Lifecycle & settings sync)
├── content.js            # High-speed DOM observer, ad fast-forwarder & skip clicker
├── page-bridge.js        # Main-world script execution bridge (Player API & network ad stripper)
├── styles.css            # Cosmetic filtering for homepage, feed, & sidebar ads
├── popup.html            # Toolbar popup UI
├── popup.css             # Modern YouTube dark-mode styling
├── popup.js              # Toggle controllers & live counter logic
├── build-package.py      # Generates a clean .zip for store uploads
├── extension-release.zip # Production-ready archive for Edge & Firefox Add-ons
└── icons/                # PNG icons supporting standard & High-DPI displays
    ├── icon16.png
    ├── icon32.png        # High-DPI Windows/Edge toolbar support
    ├── icon48.png
    └── icon128.png       # 128x128px required store icon
```

---

## How to Test Locally

### In Microsoft Edge
1. Open **Microsoft Edge** and navigate to `edge://extensions/`.
2. Turn on the **"Developer mode"** toggle in the left sidebar menu.
3. Click **"Load unpacked"** and select this directory (`e:\dbms\Add-Skipping`).
4. Pin **AdFast** to the Edge toolbar.

### In Mozilla Firefox
1. Open **Firefox** (v128+) and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select `manifest.json` inside this directory (`e:\dbms\Add-Skipping`).
4. The extension will load with its declared Gecko ID.

### In Google Chrome
1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Toggle on **"Developer mode"** in the top-right corner.
3. Click **"Load unpacked"** and select this directory (`e:\dbms\Add-Skipping`).

---

## Store Submissions Guide

Use [`extension-release.zip`](file:///e:/dbms/Add-Skipping/extension-release.zip) for submissions (or regenerate anytime by running `python build-package.py`).

### 1. Microsoft Edge Add-ons (Partner Center)
* **Dashboard**: [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)
* **Package**: Upload `extension-release.zip`.
* **Testing / Certification Notes**:
  > *"AdFast operates strictly on YouTube using standard DOM events and video player playback manipulation. The extension does not require elevated permissions or debugger protocols. Only standard local storage is used to persist user preferences and local ad-skip counts."*

### 2. Mozilla Firefox Add-ons (AMO)
* **Dashboard**: [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/)
* **Package**: Upload `extension-release.zip`.
* **Compatibility**: Declares `browser_specific_settings.gecko` with ID `adfast-skipper@adfast.app`, strict minimum version `128.0` (for MAIN-world content script support), and `data_collection_permissions: { required: ["none"] }`.

### 3. Store Listing Trademark Disclaimer
> *YouTube is a trademark of Google LLC. AdFast is an independent project and is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube.*
