# -*- coding: utf-8 -*-
"""把 2560x1600 原图缩放为精确 1280x800，覆盖正式截图。"""
import os
from PIL import Image

MK = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(MK, "..", "screenshots")

names = [
    "01-record-current-tab",
    "02-recording-in-progress",
    "03-pause-and-resume",
    "04-export-local-file",
    "05-private-by-design",
]

for n in names:
    src = os.path.join(MK, f"raw-{n.split('-')[0]}.png")
    im = Image.open(src).convert("RGB")
    im = im.resize((1280, 800), Image.LANCZOS)
    dst = os.path.join(SHOTS, n + ".png")
    im.save(dst, "PNG", optimize=True)
    print(f"{dst}  ->  {im.width}x{im.height}")
