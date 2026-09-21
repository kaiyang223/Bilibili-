import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9340;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const PROF = path.join(os.tmpdir(), 'wb-shot-' + Date.now());
const APP = path.join(ROOT, 'dist', '聊天记录浏览器.html');
const PAGE = 'file:///' + encodeURI(APP.replace(/\\/g, '/'));
const TXT = process.env.CHAT_TXT || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = console.log;
function httpGet(u) { return new Promise((res, rej) => { http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej); }); }
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const api = { ws, id: 0, waiting: new Map(), events: [] };
    ws.addEventListener('open', () => res(api));
    ws.addEventListener('error', () => rej(new Error('ws')));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && api.waiting.has(m.id)) { const w = api.waiting.get(m.id); api.waiting.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); }
      else if (m.method) api.events.push(m);
    });
  });
}
function send(api, method, params = {}, t0 = 300000) {
  const id = ++api.id;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { api.waiting.delete(id); reject(new Error('timeout ' + method)); }, t0);
    api.waiting.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    api.ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(api, expr) {
  const r = await send(api, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || '').slice(0, 400));
  return r.result.value;
}
async function shot(api, name) {
  const r = await send(api, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  return name;
}

const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  '--window-size=1440,1000', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
let ver = null;
for (let i = 0; i < 120; i++) { try { ver = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/version`)); break; } catch (e) { await sleep(250); } }
const list = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/list`));
const api = await connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await send(api, 'Page.enable'); await send(api, 'Runtime.enable'); await send(api, 'DOM.enable');

await send(api, 'Page.navigate', { url: PAGE });
await sleep(1500);

// 用全量记录的前 420 行，图片量适中
if (!TXT || !fs.existsSync(TXT)) {
  console.error('[!] 请用环境变量 CHAT_TXT 指定一份聊天记录 txt，例如：CHAT_TXT=/path/to/chat.txt node shot.mjs');
  process.exit(1);
}
const raw = fs.readFileSync(TXT, 'utf8').split(/\r?\n/).slice(0, 420).join('\n');
await ev(api, `window.__CHAT__.loadChat(${JSON.stringify(path.basename(TXT))}, ${JSON.stringify(raw)})`);
await sleep(1500);
log('已载入 ' + (await ev(api, `window.__CHAT__.S.msgs.length`)) + ' 条');

// 给两位用户各导入一张头像（自动生成，非用户隐私图片）
const mk = (color, glyph) => `(async function(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0,0,96,96);
  g.addColorStop(0, '${color}'); g.addColorStop(1, '${glyph}');
  x.fillStyle = g; x.fillRect(0,0,96,96);
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.font = 'bold 52px system-ui'; x.textAlign='center'; x.textBaseline='middle';
  x.fillText('AI', 48, 52);
  const b = await new Promise(r => cv.toBlob(r, 'image/png'));
  const f = new File([b], 'a.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  const inp = document.getElementById('avatarInput');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;

const users = await ev(api, `window.__CHAT__.S.users`);
for (let i = 0; i < users.length; i++) {
  await ev(api, `(function(){ document.querySelectorAll('#inner .av')[${i === 0 ? 0 : 1}] .click && document.querySelectorAll('#inner .av')[${i === 0 ? 0 : 1}].click(); })()`);
  await sleep(300);
  await ev(api, mk(i === 0 ? '#00aeec' : '#fb7299', i === 0 ? '#7c4dff' : '#ff8f00'));
  await sleep(1200);
}
log('头像已设置');

await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=0;})()`);
await sleep(1500);
await shot(api, 'A-avatars');
log('截图 A 完成（自定义头像）');

await ev(api, `document.getElementById('flipBtn').click()`);
await sleep(1600);
await shot(api, 'B-flipped');
log('截图 B 完成（主宾互换后）');
await ev(api, `document.getElementById('flipBtn').click()`);
await sleep(1400);

await ev(api, `document.getElementById('statsBtn').click()`);
await sleep(800);
await shot(api, 'C-profile-panel');
log('截图 C 完成（信息面板）');
await ev(api, `document.getElementById('statsClose').click()`);
await sleep(400);

// 档案管理：补两条"其他会话"的档案，展示完整列表
await ev(api, `(function(){
  const S = window.__CHAT__.S;
  S.profiles['8888888888'] = { n: '老同学' };
  S.profiles['1357924680'] = { n: '表姐' };
  window.__CHAT__.saveProfiles ? window.__CHAT__.saveProfiles() : 0;
  document.getElementById('profilesBtn').click();
  return Object.keys(S.profiles).length;
})()`);
await sleep(900);
await shot(api, 'D-profile-manager');
log('截图 D 完成（档案管理，共 ' + (await ev(api, `Object.keys(window.__CHAT__.S.profiles).length`)) + ' 条）');

try { edge.kill(); } catch (e) { }
await sleep(400);
try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
process.exit(0);
