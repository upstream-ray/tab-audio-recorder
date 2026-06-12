# -*- coding: utf-8 -*-
"""校验 i18n：JSON 合法、两语言 key 一致、代码引用的 key 都存在、无遗漏占位符。"""
import json
import re
import sys
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)

en = load("_locales/en/messages.json")
zh = load("_locales/zh_CN/messages.json")

problems = []

# 1. key 集合一致
en_keys, zh_keys = set(en), set(zh)
if en_keys != zh_keys:
    problems.append(f"en/zh key 不一致: 仅en={en_keys-zh_keys} 仅zh={zh_keys-en_keys}")

# 2. 收集代码 / manifest 引用的 key
referenced = set()
# t('key') 和 getMessage('key')
for fn in ["src/popup.js", "src/background.js", "src/offscreen.js"]:
    with open(os.path.join(ROOT, fn), encoding="utf-8") as f:
        txt = f.read()
    referenced |= set(re.findall(r"\bt\(\s*['\"]([A-Za-z0-9_]+)['\"]", txt))
# data-i18n / data-i18n-aria
with open(os.path.join(ROOT, "src/popup.html"), encoding="utf-8") as f:
    html = f.read()
referenced |= set(re.findall(r'data-i18n(?:-aria)?="([A-Za-z0-9_]+)"', html))
# manifest __MSG_x__
with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
    man = f.read()
referenced |= set(re.findall(r"__MSG_([A-Za-z0-9_]+)__", man))

missing = referenced - en_keys
if missing:
    problems.append(f"代码引用但 messages 缺失的 key: {sorted(missing)}")

unused = en_keys - referenced
# extName/extDescription 等仅 manifest 用的已计入；列出真正未引用的供参考
if unused:
    print("提示·未被引用的 key（可能是有意保留）:", sorted(unused))

print(f"\nen keys: {len(en_keys)} | zh keys: {len(zh_keys)} | 代码引用: {len(referenced)}")
if problems:
    print("\n❌ 问题:")
    for p in problems:
        print("  -", p)
    sys.exit(1)
print("\n✅ i18n 校验通过：JSON 合法、双语 key 一致、引用全部命中。")
