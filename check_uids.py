"""发布前自检：确认某些不希望公开的字符串（如个人 ID）没有出现在待发布文件里。

用法：
    python check_uids.py <词1> [词2] [词3] ...
    python check_uids.py                     # 从 .private-words 读取（每行一个词）

也可以把要检查的词写进同目录的 .private-words 文件，每行一个，
该文件已加入 .gitignore，不会被提交。

只做只读扫描，不修改任何文件。发现命中时以非零码退出，方便接入提交流程。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WORDS_FILE = os.path.join(ROOT, '.private-words')

SKIP_DIRS = {'.git', '__pycache__', 'node_modules', 'shots', 'dl'}
SKIP_FILES = {'.private-words'}
SKIP_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.7z',
            '.exe', '.dll', '.pyc', '.pack', '.idx', '.rev'}
MAX_BYTES = 8 * 1024 * 1024


def load_words():
    words = [w.strip() for w in sys.argv[1:] if w.strip()]
    if words:
        return words
    if os.path.exists(WORDS_FILE):
        with io.open(WORDS_FILE, encoding='utf-8') as f:
            return [w.strip() for w in f if w.strip() and not w.startswith('#')]
    return []


def main():
    words = load_words()
    if not words:
        print(__doc__)
        print('未提供要检查的词，也没有找到 .private-words。')
        return 0

    print('=' * 74)
    print('发布前自检：检查 %d 个词' % len(words))
    for w in words:
        print('    · %s' % w)
    print('=' * 74)

    hits = 0
    for r, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in sorted(files):
            if f in SKIP_FILES or os.path.splitext(f)[1].lower() in SKIP_EXT:
                continue
            p = os.path.join(r, f)
            try:
                if os.path.getsize(p) > MAX_BYTES:
                    continue
                text = io.open(p, encoding='utf-8', errors='ignore').read()
            except OSError:
                continue
            found = [(w, text.count(w)) for w in words if w in text]
            if found:
                hits += 1
                print('\n  [!] %s' % os.path.relpath(p, ROOT))
                for w, n in found:
                    print('        %-24s %d 处' % (w, n))

    print()
    if hits:
        print('共 %d 个文件命中，请先处理再发布。' % hits)
        return 1
    print('全部干净，可以发布。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
