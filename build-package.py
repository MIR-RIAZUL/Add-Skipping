#!/usr/bin/env python3
"""
AdFast Extension - Universal Release Package Builder
Creates a clean, production-ready .zip package for:
 - Microsoft Edge Add-ons Store
 - Mozilla Firefox Add-ons (AMO)
 - Google Chrome Web Store
Excludes test suites, source control, node_modules, and non-runtime files.
"""

import os
import zipfile

FILES_TO_PACKAGE = [
    'manifest.json',
    'background.js',
    'content.js',
    'page-bridge.js',
    'popup.html',
    'popup.css',
    'popup.js',
    'styles.css',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png'
]

OUTPUT_ZIP = 'extension-release.zip'

def build_package():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    zip_path = os.path.join(base_dir, OUTPUT_ZIP)
    
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
        for rel_path in FILES_TO_PACKAGE:
            abs_path = os.path.join(base_dir, rel_path)
            if os.path.exists(abs_path):
                zipf.write(abs_path, arcname=rel_path)
                print(f"  [+] Packaged: {rel_path}")
            else:
                print(f"  [!] Missing file: {rel_path}")
                
    size_kb = os.path.getsize(zip_path) / 1024
    print(f"\nSuccessfully built {OUTPUT_ZIP} ({size_kb:.1f} KB)")
    print("Ready for upload to Microsoft Partner Center and Mozilla AMO.")

if __name__ == '__main__':
    build_package()
