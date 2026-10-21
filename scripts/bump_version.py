import os
import re
import json
import argparse
import sys

def bump_semver(version_str, bump_type='patch'):
    parts = [int(p) for p in version_str.strip().split('.')]
    if len(parts) == 1:
        parts.append(0)
    
    if bump_type == 'major':
        parts[0] += 1
        for i in range(1, len(parts)):
            parts[i] = 0
    elif bump_type == 'minor':
        if len(parts) >= 2:
            parts[1] += 1
            for i in range(2, len(parts)):
                parts[i] = 0
        else:
            parts.append(1)
    else: # patch
        parts[-1] += 1
    
    return '.'.join(str(p) for p in parts)

def main():
    parser = argparse.ArgumentParser(description="Automated version bumper for PokeBonk")
    parser.add_argument('--type', choices=['patch', 'minor', 'major'], default='patch', help="Type of bump")
    parser.add_argument('--target', choices=['all', 'android', 'windows'], default='all', help="Target platform to bump")
    parser.add_argument('--dry-run', action='store_true', help="Do not write changes to disk")
    args = parser.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    android_gradle_path = os.path.join(repo_root, 'android', 'app', 'build.gradle.kts')
    windows_pkg_path = os.path.join(repo_root, 'windows', 'package.json')

    bumped_android = False
    bumped_windows = False
    new_android_name = None
    new_android_code = None
    new_win_version = None

    # Android bump
    if args.target in ['all', 'android'] and os.path.exists(android_gradle_path):
        with open(android_gradle_path, 'r', encoding='utf-8') as f:
            gradle_content = f.read()

        code_match = re.search(r'versionCode\s*=\s*(\d+)', gradle_content)
        name_match = re.search(r'versionName\s*=\s*"([^"]+)"', gradle_content)

        if code_match and name_match:
            old_code = int(code_match.group(1))
            old_name = name_match.group(1)
            new_android_code = old_code + 1
            new_android_name = bump_semver(old_name, args.type)

            updated_gradle = re.sub(
                r'versionCode\s*=\s*\d+',
                f'versionCode = {new_android_code}',
                gradle_content,
                count=1
            )
            updated_gradle = re.sub(
                r'versionName\s*=\s*"[^"]+"',
                f'versionName = "{new_android_name}"',
                updated_gradle,
                count=1
            )

            if not args.dry_run:
                with open(android_gradle_path, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(updated_gradle)
            bumped_android = True
            print(f"[Android] Bumped version: {old_name} (Build {old_code}) -> {new_android_name} (Build {new_android_code})")

    # Windows bump
    if args.target in ['all', 'windows'] and os.path.exists(windows_pkg_path):
        with open(windows_pkg_path, 'r', encoding='utf-8') as f:
            pkg_data = json.load(f)

        old_win = pkg_data.get('version', '1.0.0')
        new_win_version = bump_semver(old_win, args.type)
        pkg_data['version'] = new_win_version

        if not args.dry_run:
            with open(windows_pkg_path, 'w', encoding='utf-8', newline='\n') as f:
                json.dump(pkg_data, f, indent=2)
                f.write('\n')
        bumped_windows = True
        print(f"[Windows] Bumped version: {old_win} -> {new_win_version}")

    # GitHub Actions outputs
    gh_output = os.environ.get('GITHUB_OUTPUT')
    if gh_output:
        with open(gh_output, 'a', encoding='utf-8') as f:
            f.write(f"bumped_android={str(bumped_android).lower()}\n")
            f.write(f"bumped_windows={str(bumped_windows).lower()}\n")
            if new_android_name:
                f.write(f"android_version_name={new_android_name}\n")
                f.write(f"android_version_code={new_android_code}\n")
            if new_win_version:
                f.write(f"windows_version={new_win_version}\n")
            
            commit_parts = []
            if bumped_android:
                commit_parts.append(f"Android v{new_android_name} ({new_android_code})")
            if bumped_windows:
                commit_parts.append(f"Windows v{new_win_version}")
            if commit_parts:
                f.write(f"commit_summary={', '.join(commit_parts)}\n")

if __name__ == '__main__':
    main()
