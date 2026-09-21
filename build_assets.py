import os, re, json, urllib.request, ssl, concurrent.futures, collections

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'assets', '_biliEmoji.txt')
if not os.path.exists(SRC):
    print('表情源列表不存在，正在获取…')
    os.makedirs(os.path.dirname(SRC), exist_ok=True)
    _u = 'https://cdn.jsdelivr.net/gh/lrhtony/BiliEmoji@latest/biliEmoji.txt'
    _h = {'User-Agent': 'Mozilla/5.0'}
    with urllib.request.urlopen(urllib.request.Request(_u, headers=_h), timeout=60) as _r:
        open(SRC, 'wb').write(_r.read())
os.makedirs(os.path.join(ROOT, 'src'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)

# ---------- 1. 解析表情字典 ----------
txt = open(SRC, encoding='utf-8').read()
pairs = re.findall(r'"((?:[^"\\]|\\.)*)"\s*:\s*"(https?://[^"]+)"', txt)
PREFIX = 'https://i0.hdslb.com/bfs/emote/'
full = {}
for k, v in pairs:
    k = k.replace('\\"', '"')
    if v.startswith(PREFIX):
        full.setdefault(k, v[len(PREFIX):])

# 只保留 hash.ext（去掉格式化后缀），并生成 name -> hash.ext
print('dict entries:', len(full))

# ---------- 2. 找出目标聊天文件中出现的表情 ----------
# 可选：用 CHAT_TXT 指定一份记录，好把其中用到的表情一并内嵌
CHAT = os.environ.get('CHAT_TXT', '')
chat = ''
if CHAT and os.path.exists(CHAT):
    chat = io.open(CHAT, encoding='utf-8').read()
    print('参考记录:', os.path.basename(CHAT))
else:
    print('未提供 CHAT_TXT，仅内嵌通用表情集')
toks = collections.Counter()
linepat = re.compile(r'^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})\s+(.+?)说：\s?(.*)$', re.S)
for l in chat.splitlines():
    m = linepat.match(l)
    if not m:
        continue
    c = m.group(3).strip()
    if c.startswith('[') or c.startswith('{'):
        continue
    for t in re.findall(r'\[([^\[\]]{1,32})\]', c):
        toks[t] += 1

NEG = {'em', '/em', 'Your Name'}
used = [t for t in toks if t not in NEG]
print('used emote tokens:', len(used))


def resolve(n):
    """把聊天里的表情码解析为字典 key"""
    cands = []
    if n in full:
        cands.append(n)
    if '_' in n:
        cands.append(n.replace('_', '-'))
        base = n.split('_', 1)[1]
        cands += [base, 'tv-' + base]
    return next((c for c in cands if c in full), None)


resolution = {}
for n in sorted(used):
    resolution[n] = resolve(n)

hit = {k: v for k, v in resolution.items() if v}
miss = [k for k, v in resolution.items() if not v]
print('resolved:', len(hit), 'unresolved:', miss)

# ---------- 3. 下载并转 base64 ----------
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
H = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'}

# 需要内嵌的表情：本文件解析到的 + 一批通用高频表情
EXTRA = ['微笑', '大笑', '哭泣', '害羞', '笑哭', '点赞', '鼓掌', '呲牙', '滑稽', '调皮', '无语',
         '思考', '生气', '委屈', '嫌弃', '拥抱', '惊讶', '惊喜', '嫌弃', '傲娇', '星星眼',
         '给心心', '捂眼', '阴险', '翻白眼', '嘟嘟', '酸了', '打call', '喜极而泣', '嗑瓜子',
         '脸红', 'doge', 'tv-微笑', 'tv-大哭', 'tv-难过', 'tv-生气', 'tv-鼓掌', 'tv-抓狂',
         'tv-流鼻血', 'tv-色', 'tv-斜眼笑', 'tv-馋', 'tv-白眼', 'tv-惊吓', 'tv-流泪',
         'tv-思考', 'tv-亲亲', 'tv-委屈', 'tv-调皮', 'tv-惊吓', 'tv-无语', 'tv-尴尬',
         'tv-无奈', 'tv-疑问', 'tv-害羞', 'tv-白眼']

want_keys = set(hit.values())
for e in EXTRA:
    if e in full:
        want_keys.add(e)
# 也把字典里所有 tv- 前缀的收进去（只有 50 个，体积很小）
want_keys |= {k for k in full if k.startswith('tv-')}
print('to embed:', len(want_keys))

import base64
MIME = {'png': 'image/png', 'gif': 'image/gif', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'webp': 'image/webp'}


def fetch(key):
    fn = full[key]
    ext = fn.rsplit('.', 1)[-1].lower()
    url = PREFIX + fn
    for fmt in ('@64w_64h.webp', ''):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url + fmt, headers=H), timeout=25, context=ctx)
            d = r.read()
            if d:
                mt = MIME.get('webp' if fmt else ext, 'image/png')
                return key, 'data:%s;base64,%s' % (mt, base64.b64encode(d).decode('ascii'))
        except Exception as e:
            last = e
    return key, None


b64 = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
    for k, v in ex.map(fetch, sorted(want_keys)):
        if v:
            b64[k] = v
print('embedded ok:', len(b64), 'failed:', len(want_keys) - len(b64))

# ---------- 4. 写出 ----------
out = os.path.join(ROOT, 'assets')
json.dump(full, open(os.path.join(out, 'emote_dict.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
json.dump(b64, open(os.path.join(out, 'emote_b64.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('dict bytes:', os.path.getsize(os.path.join(out, 'emote_dict.json')))
print('b64  bytes:', os.path.getsize(os.path.join(out, 'emote_b64.json')))
