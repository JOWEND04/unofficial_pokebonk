import os
import json
import re
import sys
import yaml

def test_yaml():
    path = os.path.join('.github', 'workflows', 'release.yml')
    with open(path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    assert 'jobs' in data, "No jobs in release.yml"
    assert 'prepare-and-bump' in data['jobs'], "No prepare-and-bump job"
    assert 'build-android' in data['jobs'], "No build-android job"
    assert 'build-windows' in data['jobs'], "No build-windows job"
    assert 'build-ios' in data['jobs'], "No build-ios job"
    print("[PASS] YAML verification passed (release.yml)")

def test_version_bump():
    import subprocess
    cmd = [sys.executable, 'scripts/bump_version.py', '--dry-run', '--target', 'all', '--type', 'patch']
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"bump_version failed: {res.stderr}"
    assert "[Android]" in res.stdout
    assert "[Windows]" in res.stdout
    assert "[iOS]" in res.stdout
    print("[PASS] Version bump script verification passed")

def test_js_css_sync():
    core_js = open('core/pokebonk-core.js', 'rb').read()
    android_js = open('android/app/src/main/assets/pokebonk-core.js', 'rb').read()
    win_js = open('windows/core/pokebonk-core.js', 'rb').read()
    ios_js = open('ios/PokeBonk/Resources/pokebonk-core.js', 'rb').read()
    assert core_js == android_js == win_js == ios_js, "Core JS desynchronized across platforms!"

    core_css = open('core/pokebonk-theme.css', 'rb').read()
    android_css = open('android/app/src/main/assets/pokebonk-theme.css', 'rb').read()
    win_css = open('windows/core/pokebonk-theme.css', 'rb').read()
    ios_css = open('ios/PokeBonk/Resources/pokebonk-theme.css', 'rb').read()
    assert core_css == android_css == win_css == ios_css, "Core CSS desynchronized across platforms!"
    print("[PASS] Asset synchronization across Android, Windows, iOS, and Core passed")

def test_android_integrity():
    with open('android/app/src/main/AndroidManifest.xml', 'r', encoding='utf-8') as f:
        manifest = f.read()
    assert 'android.permission.INTERNET' in manifest
    assert '.MainActivity' in manifest
    assert 'android:exported="true"' in manifest

    with open('android/app/src/main/java/com/unofficial/pokebonk/UpdateManager.kt', 'r', encoding='utf-8') as f:
        upd = f.read()
    assert 'class UpdateManager' in upd
    assert 'checkForUpdates' in upd
    assert 'openReleasePage' in upd
    assert 'openDirectApkDownload' in upd

    with open('android/app/src/main/java/com/unofficial/pokebonk/PokeBonkWebView.kt', 'r', encoding='utf-8') as f:
        wv = f.read()
    assert 'class PokeBonkWebView' in wv
    assert 'checkForUpdatesManual' in wv
    assert 'openReleasePage' in wv
    assert 'getAppVersion' in wv
    print("[PASS] Android code integrity passed")

def test_windows_integrity():
    with open('windows/package.json', 'r', encoding='utf-8') as f:
        pkg = json.load(f)
    assert pkg['name'] == 'pokebonk-windows'
    assert 'version' in pkg
    assert pkg['main'] == 'main.js'

    with open('windows/main.js', 'r', encoding='utf-8') as f:
        main_js = f.read()
    assert 'createMainWindow' in main_js
    assert 'checkWindowsUpdates' in main_js
    assert 'applyUpdateAndRestart' in main_js
    assert 'toggle-fullscreen' in main_js
    assert 'check-for-updates-manual' in main_js

    with open('windows/preload.js', 'r', encoding='utf-8') as f:
        preload_js = f.read()
    assert 'contextBridge.exposeInMainWorld' in preload_js
    assert 'electronAPI' in preload_js
    assert 'toggleFullscreen' in preload_js
    assert 'checkForUpdates' in preload_js

    # Syntax and bracket balance checks
    for js_path in ['windows/main.js', 'windows/preload.js', 'core/pokebonk-core.js']:
        with open(js_path, 'r', encoding='utf-8') as f:
            code = f.read()
        stack = []
        i = 0
        n = len(code)
        line = 1
        last_non_ws = None
        while i < n:
            c = code[i]
            if c == '\n':
                line += 1
                i += 1
                continue
            if c.isspace():
                i += 1
                continue
            if c == '/' and i + 1 < n and code[i+1] == '/':
                i += 2
                while i < n and code[i] != '\n':
                    i += 1
                continue
            if c == '/' and i + 1 < n and code[i+1] == '*':
                i += 2
                while i + 1 < n and not (code[i] == '*' and code[i+1] == '/'):
                    if code[i] == '\n': line += 1
                    i += 1
                i += 2
                continue
            # Regex literal detection: if '/' follows punctuation/operator
            if c == '/' and last_non_ws in (None, '(', '[', '{', '=', ':', ';', ',', '!', '&', '|', '?', '~', '+', '-', '*', '%', '^', '<', '>'):
                i += 1
                in_class = False
                while i < n:
                    if code[i] == '\n':
                        line += 1
                        break
                    if code[i] == '\\':
                        i += 2
                        continue
                    if code[i] == '[':
                        in_class = True
                    elif code[i] == ']' and in_class:
                        in_class = False
                    elif code[i] == '/' and not in_class:
                        i += 1
                        while i < n and code[i].isalpha():
                            i += 1
                        break
                    i += 1
                last_non_ws = ')'
                continue
            if c in ('"', "'", '`'):
                quote = c
                i += 1
                while i < n:
                    if code[i] == '\n': line += 1
                    if code[i] == '\\':
                        i += 2
                        continue
                    if code[i] == quote:
                        i += 1
                        break
                    i += 1
                last_non_ws = quote
                continue
            if c in '({[':
                stack.append((c, line))
            elif c in ')}]':
                assert stack, f"Unmatched '{c}' at line {line} in {js_path}"
                top, top_line = stack.pop()
                matches = {'(': ')', '{': '}', '[': ']'}
                assert matches[top] == c, f"Mismatched '{top}' (line {top_line}) with '{c}' at line {line} in {js_path}"
            last_non_ws = c
            i += 1
        assert not stack, f"Unclosed '{stack[-1][0]}' from line {stack[-1][1]} in {js_path}"

    print("[PASS] Windows code integrity and JS syntax checks passed")

def test_ios_integrity():
    with open('ios/PokeBonk/Resources/Info.plist', 'r', encoding='utf-8') as f:
        plist = f.read()
    assert 'CFBundleShortVersionString' in plist
    assert 'CFBundleVersion' in plist

    with open('ios/PokeBonk/Views/GameWebView.swift', 'r', encoding='utf-8') as f:
        gwv = f.read()
    assert 'struct GameWebView' in gwv
    assert 'pokeBonkIOS' in gwv
    assert 'checkUpdate' in gwv
    print("[PASS] iOS code integrity passed")

if __name__ == '__main__':
    print("Running comprehensive repository bug test...")
    test_yaml()
    test_version_bump()
    test_js_css_sync()
    test_android_integrity()
    test_windows_integrity()
    test_ios_integrity()
    print("\nALL REPOSITORY INTEGRITY AND BUG TESTS PASSED SUCCESSFULLY!")
