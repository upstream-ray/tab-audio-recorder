#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 0.2.0 扩展图标：苹果蓝圆角方块 + 白色均衡器音条 + 红色录制点。
512 超采样后降采样到 16/32/48/128，并输出一张 256 预览。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
S = 512
TOP, BOT = (10, 132, 255), (0, 96, 214)  # 苹果蓝竖向渐变

grad = Image.new("RGB", (S, S))
px = grad.load()
for y in range(S):
    t = y / (S - 1)
    row = (int(TOP[0] + (BOT[0] - TOP[0]) * t),
           int(TOP[1] + (BOT[1] - TOP[1]) * t),
           int(TOP[2] + (BOT[2] - TOP[2]) * t))
    for x in range(S):
        px[x, y] = row

mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(icon)

# 均衡器三音条（白）
bw, gap = 60, 34
heights = [150, 240, 188]
x0 = (S - (3 * bw + 2 * gap)) // 2
cy = int(S * 0.56)
for i, h in enumerate(heights):
    x = x0 + i * (bw + gap)
    d.rounded_rectangle([x, cy - h // 2, x + bw, cy + h // 2], radius=bw // 2, fill=(255, 255, 255, 255))

# 红色录制点（右上角，含柔光环）
cx, cyd, rr = int(S * 0.75), int(S * 0.235), 37
d.ellipse([cx - rr - 12, cyd - rr - 12, cx + rr + 12, cyd + rr + 12], fill=(255, 69, 58, 60))
d.ellipse([cx - rr, cyd - rr, cx + rr, cyd + rr], fill=(255, 69, 58, 255))

for size, name in [(128, "icon128"), (48, "icon48"), (32, "icon32"), (16, "icon16")]:
    icon.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, "icons", name + ".png"))
    print("wrote icons/%s.png" % name)
icon.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "store-assets", "icon-preview-256.png"))
print("wrote store-assets/icon-preview-256.png")
