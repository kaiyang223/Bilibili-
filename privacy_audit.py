"""隐私审计：找出项目里可能泄露聊天记录特征的内容。

用法：
    python privacy_audit.py                 # 扫描本目录及上一级
    python privacy_audit.py <dir> [dir...]  # 扫描指定目录

检查项：长数字串（疑似用户 ID）、图床域名、平台名称、形如 <长数字>.txt 的记录文件。
只做只读扫描，不修改任何文件。
"""
import io
import os
import sys
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOTS = sys.argv[1:] or [HERE, os.path.normpath(os.path.join(HERE, os.pardir))]

SKIP_DIRS = {'.git', 'node_modules', '.workbuddy', '__pycache__', 'assets'}
SKIP_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.exe', '.pack', '.idx',
            '.rev', '.dll', '.zip', '.7z'}
SKIP_FILES = {os.path.basename(__file__)}
MAX_BYTES = 3 * 1024 * 1024

PATTERNS = [
    # 前后不能再是十六进制字符，避免把表情图 hash 里的数字段也算进来
    ('长数字串（疑似用户ID）', re.compile(r'(?<![0-9a-f.])\d{10,16}(?![0-9a-f.])', re.I)),
    ('图床 / CDN 域名', re.compile(r'[a-z0-9-]+\.(?:biliimg|hdslb|bilivideo)\.(?:com|cn)', re.I)),
    ('平台名称', re.compile(r'B\s?站|bilibili', re.I)),
    ('<长数字>.txt 形式的记录文件', re.compile(r'\d{10,16}\.\w{2,5}')),
]


def scan(path):
    try:
        if os.path.getsize(path) > MAX_BYTES:
            return None
        text = io.open(path, encoding='utf-8', errors='ignore').read()
    except OSError:
        return None
    hits = [(name, len(pat.findall(text))) for name, pat in PATTERNS if pat.search(text)]
    return hits or None


def main():
    print('=' * 74)
    print('隐私审计  |  扫描目录: %s' % ', '.join(ROOTS))
    print('=' * 74)

    total = 0
    for root in ROOTS:
        if not os.path.isdir(root):
            continue
        for r, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if f in SKIP_FILES or os.path.splitext(f)[1].lower() in SKIP_EXT:
                    continue
                p = os.path.join(r, f)
                hits = scan(p)
                if not hits:
                    continue
                total += 1
                print('\n  %s' % os.path.relpath(p, root))
                for name, cnt in hits:
                    print('      · %-24s %d 处' % (name, cnt))

    print()
    if total:
        print('共 %d 个文件命中。请确认这些出现是功能必需（如公开图床域名），还是应当清理。' % total)
    else:
        print('未发现敏感内容。')


if __name__ == '__main__':
    main()
