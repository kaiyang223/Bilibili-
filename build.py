import os, json, io, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(ROOT, 'assets')
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(DIST, '聊天记录浏览器.html')

app = io.open(os.path.join(ROOT, 'src', 'app.html'), encoding='utf-8').read()
engine = io.open(os.path.join(ROOT, 'src', 'engine.js'), encoding='utf-8').read()

if '</script>' in engine.lower():
    print('!! engine.js 含有 </script> 字面量，会导致注入失败')
    sys.exit(1)

d = json.load(io.open(os.path.join(A, 'emote_dict.json'), encoding='utf-8'))
b = json.load(io.open(os.path.join(A, 'emote_b64.json'), encoding='utf-8'))

dj = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
bj = json.dumps(b, ensure_ascii=False, separators=(',', ':'))

html = app.replace('/*__EMOTE_DICT__*/{}', dj)
html = html.replace('/*__EMOTE_B64__*/{}', bj)
html = html.replace('/*__ENGINE__*/', engine)

assert '__EMOTE_DICT__' in html, 'dict 注入失败'
assert '__EMOTE_B64__' in html, 'b64 注入失败'
assert html.count(dj[:40]) == 1, 'dict 注入异常'
assert '/*__ENGINE__*/' not in html, 'engine 注入失败'

os.makedirs(DIST, exist_ok=True)
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(html)

size = os.path.getsize(OUT)
print('OK ->', OUT)
print('size:', size, 'bytes =', round(size / 1024, 1), 'KB')
print('dict entries:', len(d), '| embedded emotes:', len(b))
