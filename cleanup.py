"""清理构建与测试过程中产生的临时文件。

只删除下列明确列出的中间产物，不会触碰源码、资源或构建产物。
用法：python cleanup.py
"""
import glob
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
TEMP = os.environ.get('TEMP') or os.environ.get('TMP') or ''

# 明确的临时目标（文件或目录，支持通配符）
TARGETS = [
    os.path.join(ROOT, 'shots'),            # 界面截图
    os.path.join(ROOT, 'dl'),               # 导出实测样本
    os.path.join(ROOT, 'subset.txt'),       # 测试用记录子集
    os.path.join(ROOT, 'export-sample.html'),
    os.path.join(ROOT, '.edge-*'),          # 早期版本遗留在项目内的浏览器 profile
    os.path.join(ROOT, '__pycache__'),
    os.path.join(ROOT, 'assets', '_biliEmoji.txt'),   # 表情源清单，可由 build_assets.py 重新拉取
]
if TEMP:
    TARGETS += [os.path.join(TEMP, 'wb-edge-*'), os.path.join(TEMP, 'wb-shot-*')]


def size_of(p):
    if os.path.isfile(p):
        try:
            return os.path.getsize(p)
        except OSError:
            return 0
    total = 0
    for r, _d, fs in os.walk(p):
        for x in fs:
            try:
                total += os.path.getsize(os.path.join(r, x))
            except OSError:
                pass
    return total


freed = 0
count = 0
for pattern in TARGETS:
    for path in glob.glob(pattern):
        if not os.path.exists(path):
            continue
        size = size_of(path)
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
        except OSError as e:
            print('  ! 删除失败 %s : %s' % (path, e))
            continue
        freed += size
        count += 1
        print('  - %-50s %8.2f MB' % (path, size / 1048576))

print()
print('已清理 %d 项，释放约 %.1f MB' % (count, freed / 1048576))
print()
print('当前项目内容：')
for r, dirs, fs in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in {'__pycache__', '.git'}]
    depth = r[len(ROOT):].count(os.sep)
    if depth > 1:
        continue
    print('  ' + r)
    for x in sorted(fs):
        print('      %8d  %s' % (os.path.getsize(os.path.join(r, x)), x))
