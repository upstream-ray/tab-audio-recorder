#!/usr/bin/env python3
"""打包 Chrome 扩展为 Web Store 可上传的 zip（强制正斜杠路径）。"""
import json
import os
import zipfile

with open("manifest.json", encoding="utf-8") as mf:
    VERSION = json.load(mf)["version"]

OUT = f"dist/tab-audio-recorder-{VERSION}.zip"
INCLUDE_ROOT = ["manifest.json"]
INCLUDE_DIRS = ["src", "icons", "_locales"]
BACKSLASH = chr(92)

files = list(INCLUDE_ROOT)
for d in INCLUDE_DIRS:
    for root, _, names in os.walk(d):
        for n in names:
            files.append(os.path.join(root, n))

os.makedirs("dist", exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f.replace(os.sep, "/"))

with zipfile.ZipFile(OUT) as z:
    bad = [n for n in z.namelist() if BACKSLASH in n]
    for n in z.namelist():
        print(("BAD " if BACKSLASH in n else "ok  ") + n)
    print("---")
    print("entries:", len(z.namelist()), "| backslash entries:", len(bad))
