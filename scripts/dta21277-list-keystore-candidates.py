#!/usr/bin/env python3
from pathlib import Path
import os

home = Path.home()
try:
    repo = Path(os.popen("git rev-parse --show-toplevel 2>/dev/null").read().strip())
except Exception:
    repo = Path.cwd()

roots = [
    home / ".android",
    repo,
    home / "Library" / "Caches" / "chargeurs-jdk",
    home / "Downloads",
    home / "Desktop",
]

exact_names = {"debug.keystore"}
suffixes = {".keystore", ".jks", ".p12", ".pfx"}
max_depth = 6
seen = set()
results = []

for root in roots:
    if not root.is_dir():
        continue
    root_depth = len(root.parts)
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        depth = len(current_path.parts) - root_depth
        if depth >= max_depth:
            dirs[:] = []
        dirs[:] = [d for d in dirs if d not in {".git", "node_modules", "build", ".gradle"}]
        for name in files:
            path = current_path / name
            if name in exact_names or path.suffix.lower() in suffixes:
                text = str(path)
                if text not in seen:
                    seen.add(text)
                    results.append(text)

results.sort()
print("ACTION=LIST_KEYSTORE_CANDIDATES_READ_ONLY")
print(f"KEYSTORE_CANDIDATES={len(results)}")
for path in results:
    try:
        size = Path(path).stat().st_size
    except OSError:
        size = -1
    print(f"CANDIDATE={path} bytes={size}")
print("KEYSTORE_CANDIDATE_SEARCH_DONE")