import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DL = path.join(ROOT, 'dl');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
const PROF = path.join(os.tmpdir(), 'wb-edge-' + Date.now());
fs.mkdirSync(PROF, { recursive: true });
const TXT = process.env.CHAT_TXT || '';
const APP = path.join(ROOT, 'dist', '聊天记录浏览器.html');
const PAGE = 'file:///' + encodeURI(APP.replace(/\\/g, '/'));
const MAXSIDE = +(process.argv[2] || 1080);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = console.log;
const MB = (n) => (n / 1048576).toFixed(1) + ' MB';
function httpGet(u) { return new Promise((res, rej) => { http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej); }); }
function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const api = { ws, id: 0, waiting: new Map(), logs: [] };
    ws.addEventListener('open', () => res(api));
    ws.addEventListener('error', () => rej(new Error('ws')));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && api.waiting.has(m.id)) { const w = api.waiting.get(m.id); api.waiting.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); }
      else if (m.method) api.logs.push(m);
    });
  });
}
function send(api, method, params = {}, timeout = 1200000) {
  const id = ++api.id;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { api.waiting.delete(id); reject(new Error('timeout ' + method)); }, timeout);
    api.waiting.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    api.ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(api, expr) {
  const r = await send(api, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 700));
  return r.result.value;
}

if (!TXT || !fs.existsSync(TXT)) {
  console.error('[!] 请用环境变量 CHAT_TXT 指定一份聊天记录 txt，例如：CHAT_TXT=/path/to/chat.txt node full-export2.mjs');
  process.exit(1);
}

const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  '--window-size=1440,1000', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF, 'about:blank'], { stdio: 'ignore' });
let ver = null;
for (let i = 0; i < 120; i++) { try { ver = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/version`)); break; } catch (e) { await sleep(250); } }
const list = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/list`));
const api = await connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);

// 下载行为：允许并指定目录
try {
  await send(api, 'Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
  log('下载目录已设为 ' + DL);
} catch (e) {
  log('Browser.setDownloadBehavior 失败: ' + e.message.slice(0, 100));
  try { await send(api, 'Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }); log('已退用 Page.setDownloadBehavior'); } catch (e2) { log('均失败'); }
}
await send(api, 'Page.enable'); await send(api, 'Runtime.enable'); await send(api, 'DOM.enable'); await send(api, 'Log.enable');

log('\n== 载入全量 ==');
await send(api, 'Page.navigate', { url: PAGE });
await sleep(1500);
const doc = await send(api, 'DOM.getDocument', { depth: 1 });
const qi = await send(api, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
await send(api, 'DOM.setFileInputFiles', { files: [TXT], nodeId: qi.nodeId });
for (let i = 0; i < 80; i++) { if ((await ev(api, 'window.__CHAT__.S.msgs.length')) > 0) break; await sleep(300); }
log('  ' + JSON.stringify(await ev(api, `(()=>{const S=window.__CHAT__.S;return{msgs:S.msgs.length,imgs:S.imgCount,uniqImgs:S.allImgs.length}})()`)));

log('\n== 全量导出（压缩内嵌, 1080）==');
await ev(api, `document.getElementById('exportBtn').click()`);
await sleep(400);
await ev(api, `document.querySelector('#modeSeg button[data-v="smart"]').click()`);
await sleep(200);
await ev(api, `(function(){const m=document.getElementById('maxSide');m.value=${MAXSIDE};m.dispatchEvent(new Event('input'));})()`);
await sleep(300);
const t0 = Date.now();
await ev(api, `document.getElementById('expGo').click()`);
let last = null;
for (let i = 0; i < 900; i++) {
  last = await ev(api, `(()=>({pct:document.getElementById('expPct').textContent,label:document.getElementById('expLabel').textContent,busy:document.getElementById('expGo').disabled}))()`);
  if (!last.busy) break;
  await sleep(1000);
}
const exportSecs = ((Date.now() - t0) / 1000).toFixed(1);
log('  ' + JSON.stringify(last) + '  耗时 ' + exportSecs + 's');
log('  失败清单(exeLog):');
const flog = await ev(api, `document.getElementById('expLog').textContent`);
log('  ' + (flog || '(无)').split('\n').slice(0, 25).join('\n  '));

log('\n== 等待文件落盘 ==');
let file = null;
for (let i = 0; i < 180; i++) {
  const cand = fs.readdirSync(DL).filter((f) => f.endsWith('.html'));
  if (cand.length) {
    const fsize = fs.statSync(path.join(DL, cand[0])).size;
    await sleep(1500);
    if (fs.statSync(path.join(DL, cand[0])).size === fsize) { file = path.join(DL, cand[0]); break; }
  }
  await sleep(1000);
}
if (!file) { log('  未找到导出文件'); try { edge.kill(); } catch (e) { } process.exit(1); }
const fsize = fs.statSync(file).size;
log('  文件: ' + file);
log('  大小: ' + MB(fsize) + ' (' + fsize + ' bytes)');

log('\n== 分析导出文件内容 ==');
const raw = fs.readFileSync(file, 'latin1');
const re = /data:image\/(\w+);base64,/g;
let m, count = 0, total = 0;
const kinds = {};
const sizes = [];
let lastEnd = -1;
while ((m = re.exec(raw)) !== null) {
  count++;
  kinds[m[1]] = (kinds[m[1]] || 0) + 1;
  lastEnd = m.index + m[0].length;
  const endq = raw.indexOf('"', lastEnd);
  const len = (endq < 0 ? raw.length : endq) - lastEnd;
  total += len;
  sizes.push(len);
  re.lastIndex = lastEnd + len;
}
sizes.sort((a, b) => a - b);
log('  data URI 数量: ' + count + '  类型: ' + JSON.stringify(kinds));
log('  图片数据合计: ' + MB(total) + '  占全文 ' + (total / fsize * 100).toFixed(1) + '%');
if (sizes.length) {
  const q = (p) => sizes[Math.floor(sizes.length * p)] / 1024;
  log('  单张 base64 中位 ' + q(0.5).toFixed(1) + ' KB / 均值 ' + (total / count / 1024).toFixed(1) +
    ' KB / 最小 ' + (sizes[0] / 1024).toFixed(1) + ' KB / 最大 ' + (sizes[sizes.length - 1] / 1024).toFixed(1) + ' KB');
}
log('  非图片部分约: ' + MB(fsize - total));

log('\n== 双击打开该离线文件（计时） ==');
const url = 'file:///' + encodeURI(file.replace(/\\/g, '/'));
const tOpen = Date.now();
await send(api, 'Page.navigate', { url });
let readyAt = 0, msgs = 0;
for (let i = 0; i < 400; i++) {
  try {
    const st = await ev(api, `(()=>{try{return {r:!!(window.__CHAT__&&window.__CHAT__.S.ready),n:window.__CHAT__?window.__CHAT__.S.msgs.length:0,dom:document.getElementById('inner')?document.getElementById('inner').children.length:0}}catch(e){return {r:false,n:0,dom:0}}})()`);
    if (st.r) { readyAt = Date.now() - tOpen; msgs = st.n; break; }
  } catch (e) { }
  await sleep(150);
}
log('  可交互耗时: ' + (readyAt / 1000).toFixed(2) + ' s（消息 ' + msgs + ' 条）');
const tRender = Date.now();
const domInfo = await ev(api, `(()=>{const i=document.getElementById('inner');return{dom:i.children.length,cells:i.querySelectorAll('.imgs .cell').length,localCells:[...i.querySelectorAll('.imgs .cell img')].filter(x=>x.src.startsWith('data:')).length,emo:i.querySelectorAll('.emo-img').length}})()`);
log('  首屏 DOM: ' + JSON.stringify(domInfo) + '  渲染耗时 ' + ((Date.now() - tRender) / 1000).toFixed(2) + 's');

// 滚动性能
const tScroll = Date.now();
const snap = () => ev(api, `(()=>{const s=document.getElementById('stream');const S=window.__CHAT__.S;return{st:s.scrollTop,sh:s.scrollHeight,ch:s.clientHeight,kids:document.getElementById('inner').children.length,start:S.win.start,end:S.win.end,errs:(window.__err||[]).slice(0,3)}})()`);
await ev(api, `window.__err=[];window.addEventListener('error',function(e){window.__err.push(String(e.message))});window.addEventListener('unhandledrejection',function(e){window.__err.push('rej:'+String(e.reason))});true`);
log('  滚动前: ' + JSON.stringify(await snap()));

// 假设：长时间高负载后 headless 暂停了渲染帧，导致 scroll/IO 回调不派发。先强制渲染一帧验证。
await send(api, 'Page.captureScreenshot', { format: 'png' }).catch(() => { });
await ev(api, `document.getElementById('stream').scrollTop = 999999`);
await sleep(3000);
log('  强制渲染后下滚(3s): ' + JSON.stringify(await snap()));

// 再手动派发 scroll 事件（真实用户滚动时浏览器必然会派发）
await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=999999;s.dispatchEvent(new Event('scroll'));})()`);
await sleep(2000);
log('  手动派发 scroll 后: ' + JSON.stringify(await snap()));

for (let i = 0; i < 15; i++) {
  await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=999999;s.dispatchEvent(new Event('scroll'));})()`);
  await sleep(600);
}
log('  连续 15 次后: ' + JSON.stringify(await snap()) + '  用时 ' + ((Date.now() - tScroll) / 1000).toFixed(1) + 's');

// 内存
try {
  const mem = await send(api, 'Performance.getMetrics');
  const g = {};
  mem.metrics.forEach((x) => { if (/JSHeap|Nodes|DOMNodes/i.test(x.name)) g[x.name] = Math.round(x.value); });
  log('  指标: ' + JSON.stringify(g));
} catch (e) { }

log('\n== 汇总 ==');
log('  导出耗时 ' + exportSecs + 's | 文件 ' + MB(fsize) + ' | 打开到可交互 ' + (readyAt / 1000).toFixed(2) + 's');
log('  图片数据 ' + MB(total) + ' (' + count + ' 张, 占 ' + (total / fsize * 100).toFixed(0) + '%)，其余 ' + MB(fsize - total));

try { edge.kill(); } catch (e) { }
process.exit(0);
