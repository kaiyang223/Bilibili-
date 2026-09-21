import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const EDGE = process.env.EDGE_BIN || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || 'msedge';
const PORT = 9333;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROF = path.join(os.tmpdir(), 'wb-edge-' + Date.now());
/* ---------------------------------------------------------------------------
   测试需要一份聊天记录 txt，用环境变量指定：
     Windows:  set CHAT_TXT=D:\\path\\to\\chat.txt && node e2e.mjs
     bash:     CHAT_TXT=/path/to/chat.txt node e2e.mjs

   另可用 CHAT_MSGS / CHAT_USERS / CHAT_IMGS 给出期望数量做严格比对；
   不设置时只校验「解析出了合理内容」。
   --------------------------------------------------------------------------- */
const TXT = process.env.CHAT_TXT || '';
const EXPECT = {
  msgs: +(process.env.CHAT_MSGS || 0),
  users: +(process.env.CHAT_USERS || 0),
  imgs: +(process.env.CHAT_IMGS || 0),
};
const APP = path.join(ROOT, 'dist', '聊天记录浏览器.html');
const PAGE = 'file:///' + encodeURI(APP.replace(/\\/g, '/'));
const SHOT = path.join(ROOT, 'shots');
fs.mkdirSync(SHOT, { recursive: true });
fs.mkdirSync(PROF, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
  });
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const api = { ws, id: 0, waiting: new Map(), logs: [] };
    ws.addEventListener('open', () => res(api));
    ws.addEventListener('error', () => rej(new Error('ws error')));
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.id && api.waiting.has(m.id)) {
        const w = api.waiting.get(m.id); api.waiting.delete(m.id);
        if (m.error) w.reject(new Error(JSON.stringify(m.error))); else w.resolve(m.result);
      } else if (m.method) api.logs.push(m);
    });
  });
}
function send(api, method, params = {}) {
  const id = ++api.id;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { api.waiting.delete(id); reject(new Error('timeout ' + method)); }, 180000);
    api.waiting.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    api.ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(api, expr) {
  const r = await send(api, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 900));
  return r.result.value;
}
async function shot(api, name) {
  const r = await send(api, 'Page.captureScreenshot', { format: 'png' });
  const p = path.join(SHOT, name + '.png');
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
}

// 通过真实 File 对象 + DataTransfer 注入文件（走 FileReader 阅读路径）
async function injectFile(api, name, text) {
  const CH = 200000;
  await ev(api, `window.__inj=''`);
  for (let i = 0; i < text.length; i += CH) {
    const chunk = JSON.stringify(text.slice(i, i + CH)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    await ev(api, `window.__inj += ${chunk}`);
  }
  await ev(api, `(function(){
    const f = new File([window.__inj], ${JSON.stringify(name)}, {type:'text/plain'});
    window.__inj = null;
    const dt = new DataTransfer();
    dt.items.add(f);
    const input = document.getElementById('fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    return input.files.length;
  })()`);
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? '  → ' + detail : ''));
}

let edge = null;

async function main() {
  if (!TXT || !fs.existsSync(TXT)) {
    console.error('');
    console.error('[!] 请先指定一份聊天记录 txt：');
    console.error('      Windows:  set CHAT_TXT=D:\\path\\to\\chat.txt && node e2e.mjs');
    console.error('      bash:     CHAT_TXT=/path/to/chat.txt node e2e.mjs');
    console.error('    可选：用 CHAT_MSGS / CHAT_USERS / CHAT_IMGS 指定期望数量以严格比对。');
    console.error('');
    process.exit(1);
  }
  log('== 启动 Edge headless ==');
  edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--allow-file-access-from-files',
    '--window-size=1440,1000', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, 'about:blank',
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 120; i++) {
    try { ver = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/version`)); break; } catch (e) { await sleep(250); }
  }
  if (!ver) throw new Error('Edge CDP 未就绪');
  log('  ' + ver.Browser);

  const list = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/list`));
  const tgt = list.find((t) => t.type === 'page');
  const api = await connect(tgt.webSocketDebuggerUrl);
  await send(api, 'Page.enable');
  await send(api, 'Runtime.enable');
  await send(api, 'DOM.enable');
  await send(api, 'Log.enable');

  /* ============ 1. 打开主页面 ============ */
  log('\n== 1. 打开主页面 ==');
  await send(api, 'Page.navigate', { url: PAGE });
  await sleep(1200);
  let ok = false;
  for (let i = 0; i < 40; i++) { try { ok = await ev(api, '!!window.__CHAT__'); } catch (e) { } if (ok) break; await sleep(250); }
  check('页面加载 / 引擎就绪', ok);
  check('落地页提示可见', await ev(api, `!document.getElementById('landing').hidden`));
  check('未导入时灯箱/主界面确实不可见(computed)', await ev(api, `getComputedStyle(document.getElementById('lightbox')).display==='none' && getComputedStyle(document.getElementById('app')).display==='none' && getComputedStyle(document.getElementById('exportModal')).display==='none'`));
  check('提示文案「把聊天记录拖进来」', /把聊天记录拖进来/.test(await ev(api, `document.querySelector('#drop h1').textContent`)));
  await shot(api, '01-landing');

  /* ============ 2. 导入 txt（真实 file input 路径） ============ */
  log('\n== 2. 导入 txt ==');
  const t0 = Date.now();
  let viaCDP = false;
  try {
    const doc = await send(api, 'DOM.getDocument', { depth: 1 });
    const qi = await send(api, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
    if (qi && qi.nodeId) {
      await send(api, 'DOM.setFileInputFiles', { files: [TXT], nodeId: qi.nodeId });
      await sleep(1500);
      viaCDP = (await ev(api, 'window.__CHAT__.S.msgs.length')) > 0;
    }
  } catch (e) { log('  CDP setFileInputFiles 不可用：' + e.message.slice(0, 80)); }
  if (!viaCDP) {
    log('  改用 File+DataTransfer 注入（等同用户选择文件）');
    await injectFile(api, path.basename(TXT), fs.readFileSync(TXT, 'utf8'));
  }
  check('文件已送入 <input type=file>', true, viaCDP ? 'CDP 直传' : 'DataTransfer 注入');
  const tInject = Date.now();
  for (let i = 0; i < 120; i++) {
    const n = await ev(api, 'window.__CHAT__.S.ready ? window.__CHAT__.S.msgs.length : 0');
    if (n > 0) break;
    await sleep(300);
  }
  const parseMs = Date.now() - tInject;
  const st = await ev(api, `(()=>{const S=window.__CHAT__.S;return{msgs:S.msgs.length,users:S.users.length,imgs:S.imgCount,emotes:S.emoteCount,bytes:S.bytes,file:S.file,landingHidden:document.getElementById('landing').hidden,appHidden:document.getElementById('app').hidden}})()`);
  log('  ' + JSON.stringify(st));
  check('解析出消息', EXPECT.msgs ? st.msgs === EXPECT.msgs : st.msgs > 0,
    st.msgs + ' 条' + (EXPECT.msgs ? '（期望 ' + EXPECT.msgs + '）' : ''));
  check('识别出参与人', EXPECT.users ? st.users === EXPECT.users : st.users >= 1,
    st.users + ' 人' + (EXPECT.users ? '（期望 ' + EXPECT.users + '）' : ''));
  check('识别出图片链接', EXPECT.imgs ? st.imgs === EXPECT.imgs : st.imgs >= 0,
    st.imgs + ' 张' + (EXPECT.imgs ? '（期望 ' + EXPECT.imgs + '）' : ''));
  check('识别出表情', st.emotes > 0, st.emotes + ' 个');
  const cons = await ev(api, `(function(){
    const S = window.__CHAT__.S;
    let n = 0;
    for (let i = 0; i < S.msgs.length; i++) {
      const p = S.msgs[i].parts || [];
      for (let j = 0; j < p.length; j++) if (p[j][0] === 'i') n++;
    }
    return { counted: n, reported: S.imgCount, allImgs: S.allImgs.length };
  })()`);
  check('图片统计与消息内容自洽', cons.counted === cons.reported && cons.counted === cons.allImgs,
    JSON.stringify(cons));
  check('自动切换到对话视图', st.landingHidden === true && st.appHidden === false);
  log('  解析+首屏耗时 ' + parseMs + ' ms（含注入）');

  /* ============ 3. 渲染 ============ */
  log('\n== 3. 渲染验证 ==');
  const r = await ev(api, `(()=>{const inner=document.getElementById('inner');return{
    dom:inner.children.length, start:window.__CHAT__.S.win.start, end:window.__CHAT__.S.win.end,
    daysep:inner.querySelectorAll('.daysep').length, bubbles:inner.querySelectorAll('.bubble').length,
    left:inner.querySelectorAll('.msg:not(.right)').length, right:inner.querySelectorAll('.msg.right').length,
    avatars:inner.querySelectorAll('.av').length, cells:inner.querySelectorAll('.imgs .cell').length,
    emoImg:inner.querySelectorAll('.emo-img').length, emoFb:inner.querySelectorAll('.emo-fallback').length,
    links:inner.querySelectorAll('.bubble a').length,
    first:inner.children[0]?inner.children[0].textContent.slice(0,60):''}})()`);
  log('  ' + JSON.stringify(r));
  check('首屏渲染消息 > 100 条', r.dom > 100, r.dom + ' 条');
  check('左右气泡均存在', r.left > 0 && r.right > 0, '左 ' + r.left + ' / 右 ' + r.right);
  check('头像已生成', r.avatars > 0, r.avatars + ' 个');
  check('日期分隔线已渲染', r.daysep >= 1, r.daysep + ' 条');
  check('表情以内联图片渲染', r.emoImg > 0, r.emoImg + ' 图 / ' + r.emoFb + ' 兜底');
  check('图片消息进入 DOM', r.cells > 0, r.cells + ' 张');
  await shot(api, '02-chat-top');

  /* ============ 4. 图片可访问 ============ */
  log('\n== 4. 图片加载验证 ==');
  const imgTest = await ev(api, `(async()=>{
    const uniq=[...new Set([...document.querySelectorAll('.imgs .cell img')].map(i=>i.dataset.src))].slice(0,6);
    const out=[];
    for(const u of uniq){
      out.push(await new Promise(res=>{const im=new Image();const t=setTimeout(()=>res({ok:false,why:'timeout',url:u.slice(-38)}),20000);
        im.onload=()=>{clearTimeout(t);res({ok:true,nw:im.naturalWidth,nh:im.naturalHeight,url:u.slice(-38)})};
        im.onerror=()=>{clearTimeout(t);res({ok:false,why:'err',url:u.slice(-38)})};im.src=u;}));
    }
    return out;
  })()`);
  imgTest.forEach((x) => log('    ' + (x.ok ? 'OK  ' : 'FAIL') + ' ' + x.nw + 'x' + x.nh + '  ...' + x.url));
  check('图片 CDN 可加载', imgTest.filter((x) => x.ok).length >= 4, imgTest.filter((x) => x.ok).length + '/' + imgTest.length);

  const emoTest = await ev(api, `(async()=>{
    const es=[...document.querySelectorAll('.emo-img')].slice(0,8);const out=[];
    for(const e of es){out.push(await new Promise(res=>{const im=new Image();const t=setTimeout(()=>res(false),8000);
      im.onload=()=>{clearTimeout(t);res(true)};im.onerror=()=>{clearTimeout(t);res(false)};im.src=e.src;}));}
    return out;})()`);
  check('表情图片可加载', emoTest.filter(Boolean).length >= 5, emoTest.filter(Boolean).length + '/' + emoTest.length);

  /* ============ 5. 滚动扩展 + 窗口限制 ============ */
  log('\n== 5. 滚动加载验证 ==');
  await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=s.scrollHeight;})()`);
  await sleep(1200);
  const a1 = await ev(api, `(()=>{const S=window.__CHAT__.S;return{start:S.win.start,end:S.win.end,dom:document.getElementById('inner').children.length}})()`);
  log('  ' + JSON.stringify(a1));
  check('向下滚动自动加载更多', a1.end > r.end, r.end + ' → ' + a1.end);
  check('DOM 窗口受上限约束', a1.dom <= 1600, 'DOM ' + a1.dom + ' 条');

  for (let i = 0; i < 12; i++) { await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=s.scrollHeight;})()`); await sleep(300); }
  const a2 = await ev(api, `(()=>{const S=window.__CHAT__.S;return{start:S.win.start,end:S.win.end,dom:document.getElementById('inner').children.length,scrollTop:document.getElementById('stream').scrollTop}})()`);
  log('  连续下滚 12 次后: ' + JSON.stringify(a2));
  check('持续滚动窗口仍受约束', a2.dom <= 1600, 'DOM ' + a2.dom + ' 条');

  await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=0;})()`);
  await sleep(1200);
  const a3 = await ev(api, `(()=>{const S=window.__CHAT__.S;return{start:S.win.start,end:S.win.end,dom:document.getElementById('inner').children.length}})()`);
  log('  回到顶部: ' + JSON.stringify(a3));
  check('可向上滚动回看早期消息', a3.start < a2.start, a2.start + ' → ' + a3.start);
  await shot(api, '03-chat-scroll');

  /* ============ 6. 搜索 ============ */
  log('\n== 6. 搜索验证 ==');
  const KW = await ev(api, `(function(){
    const S = window.__CHAT__.S, cnt = {};
    let best = '', n = 0;
    for (let i = 0; i < Math.min(3000, S.msgs.length); i++) {
      const t = S.msgs[i]._plain || '';
      for (let j = 0; j + 2 <= t.length; j++) {
        const g = t.slice(j, j + 2);
        if (/\\s/.test(g)) continue;
        cnt[g] = (cnt[g] || 0) + 1;
      }
    }
    for (const k in cnt) if (cnt[k] > n) { n = cnt[k]; best = k; }
    return best;
  })()`);
  await ev(api, `(function(){const s=document.getElementById('search');s.value=${JSON.stringify(KW)};s.dispatchEvent(new Event('input'));})()`);
  await sleep(1000);
  const srch = await ev(api, `(()=>{const S=window.__CHAT__.S;return{q:S.q,hits:S.hits.length,idx:S.hitIdx,count:document.getElementById('searchCount').textContent,marks:document.querySelectorAll('mark.hl').length,cur:document.querySelectorAll('mark.hl.cur').length}})()`);
  log('  ' + JSON.stringify(srch));
  check('搜索有命中', srch.hits > 0, srch.hits + ' 条（关键词「' + KW + '」）');
  check('命中计数显示', /\d+\/\d+/.test(srch.count), srch.count);
  check('命中已高亮标记', srch.marks > 0, srch.marks + ' 处');
  check('可视窗口已定位到命中', await ev(api, `(function(){const S=window.__CHAT__.S;const h=S.hits[S.hitIdx];return S.win.start<=h&&S.win.end>=h;})()`));
  await shot(api, '04-search');
  await ev(api, `document.getElementById('nextHit').click()`);
  await sleep(700);
  check('「下一个」可切换', await ev(api, `window.__CHAT__.S.hitIdx===1`));
  await ev(api, `(function(){const s=document.getElementById('search');s.value='';s.dispatchEvent(new Event('input'));})()`);
  await sleep(700);

  /* ============ 7. 日期跳转 ============ */
  log('\n== 7. 日期跳转验证 ==');
  const di = await ev(api, `(()=>{const s=document.getElementById('dateSel');return{n:s.options.length,sample:[...s.options].slice(1,4).map(o=>o.textContent)}})()`);
  log('  ' + JSON.stringify(di));
  check('日期下拉已生成', di.n > 50, di.n + ' 个日期');
  const before = await ev(api, `window.__CHAT__.S.win.start`);
  await ev(api, `(function(){const s=document.getElementById('dateSel');s.value=s.options[Math.min(20,s.options.length-1)].value;s.dispatchEvent(new Event('change'));})()`);
  await sleep(900);
  const dj = await ev(api, `(()=>{const S=window.__CHAT__.S;const d=document.querySelector('#inner .daysep span');return{start:S.win.start,end:S.win.end,day:d?d.textContent:''}})()`);
  log('  ' + JSON.stringify(dj));
  check('日期跳转生效', dj.start !== before && dj.start > 0, '跳到「' + dj.day + '」');

  /* ============ 8. 灯箱 ============ */
  log('\n== 8. 灯箱验证 ==');
  await ev(api, `(function(){const s=document.getElementById('dateSel');s.value=s.options[1].value;s.dispatchEvent(new Event('change'));})()`);
  await sleep(900);
  const lbOpen = await ev(api, `(function(){const c=document.querySelector('#inner .imgs .cell');if(!c)return 'none';c.click();return document.getElementById('lightbox').hidden?'hidden':'open';})()`);
  await sleep(3000);
  const lbs = await ev(api, `(()=>{const i=document.getElementById('lbImg');return{open:!document.getElementById('lightbox').hidden,nw:i.naturalWidth,nh:i.naturalHeight,name:document.getElementById('lbName').textContent,status:document.getElementById('lbStatus').textContent}})()`);
  log('  ' + JSON.stringify(lbs));
  check('点击图片打开灯箱', lbs.open && lbs.nw > 0, lbs.nw + '×' + lbs.nh + ' · ' + lbs.name);
  await shot(api, '05-lightbox');
  await ev(api, `document.getElementById('lbNext').click()`);
  await sleep(2500);
  const lbName2 = (await ev(api, `document.getElementById('lbName').textContent`)).trim();
  check('灯箱可翻到下一张', /^2\s*\//.test(lbName2), lbName2);
  await ev(api, `document.getElementById('lbClose').click()`);
  check('灯箱可关闭', await ev(api, `document.getElementById('lightbox').hidden`));

  /* ============ 9. 主题 / 统计 ============ */
  log('\n== 9. 主题与统计 ==');
  await ev(api, `document.getElementById('themeBtn').click()`);
  await sleep(500);
  const th = await ev(api, `document.documentElement.dataset.theme`);
  check('主题可切换', th === 'dark' || th === 'light', th);
  await shot(api, '06-theme-' + th);
  await ev(api, `document.getElementById('themeBtn').click()`);
  await sleep(300);
  await ev(api, `document.getElementById('statsBtn').click()`);
  await sleep(500);
  const stats = await ev(api, `(()=>({open:!document.getElementById('statsModal').hidden,cells:document.querySelectorAll('#statGrid .stat').length,rows:document.querySelectorAll('#whoList .who-row').length}))()`);
  log('  ' + JSON.stringify(stats));
  check('统计面板正常', stats.open && stats.cells >= 8 && stats.rows === 2, stats.cells + ' 项 / ' + stats.rows + ' 人');
  await shot(api, '07-stats');
  await ev(api, `document.getElementById('statsClose').click()`);

  /* ============ 9.5 头像导入 / 昵称绑定 / 主宾互换 ============ */
  log('\n== 9.5 头像导入 / 昵称绑定 / 主宾互换 ==');

  check('工具栏有「主宾互换」按钮', await ev(api, `!!document.getElementById('flipBtn')`));

  const sideBefore = await ev(api, `(()=>({right:document.querySelectorAll('#inner .msg.right').length,left:document.querySelectorAll('#inner .msg:not(.right)').length}))()`);
  await ev(api, `document.getElementById('flipBtn').click()`);
  await sleep(1000);
  const sideAfter = await ev(api, `(()=>({right:document.querySelectorAll('#inner .msg.right').length,left:document.querySelectorAll('#inner .msg:not(.right)').length,flip:window.__CHAT__.S.flip,on:document.getElementById('flipBtn').classList.contains('on')}))()`);
  log('  ' + JSON.stringify(sideBefore) + '  ->  ' + JSON.stringify(sideAfter));
  check('点击后左右互换', sideAfter.flip === true &&
    Math.abs(sideAfter.right - sideBefore.left) <= 3 && Math.abs(sideAfter.left - sideBefore.right) <= 3,
    '右 ' + sideBefore.right + '→' + sideAfter.right + '，左 ' + sideBefore.left + '→' + sideAfter.left);
  check('互换按钮显示激活态', sideAfter.on === true);
  await ev(api, `document.getElementById('flipBtn').click()`);
  await sleep(1000);
  check('再次点击可恢复默认', await ev(api, `window.__CHAT__.S.flip === false`));

  const picked = await ev(api, `(function(){
    window.__picked = 0;
    const oc = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function(){
      if (this.id === 'avatarInput') { window.__picked++; return; }
      return oc.apply(this, arguments);
    };
    const av = document.querySelector('#inner .av');
    window.__uid0 = av ? av.dataset.uid : null;
    if (av) av.click();
    return { picked: window.__picked, uid: window.__uid0 };
  })()`);
  log('  ' + JSON.stringify(picked));
  check('点击消息头像会调起图片选择', picked.picked === 1 && !!picked.uid, '目标用户 ' + picked.uid);

  await ev(api, `(async function(){
    const cv = document.createElement('canvas'); cv.width = cv.height = 40;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#e91e63'; ctx.fillRect(0, 0, 40, 40);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(20, 20, 11, 0, Math.PI * 2); ctx.fill();
    const blob = await new Promise(function(r){ cv.toBlob(r, 'image/png'); });
    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const inp = document.getElementById('avatarInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(1800);
  const avInfo = await ev(api, `(function(){
    const all = document.querySelectorAll('#inner .av');
    const imgs = [].slice.call(document.querySelectorAll('#inner .av img'));
    const data = imgs.filter(function(i){ return i.src.indexOf('data:image/') === 0; });
    let store = '';
    try { store = localStorage.getItem('chatview.profiles.v1') || ''; } catch (e) { store = 'ERR'; }
    return { total: all.length, withImg: imgs.length, dataImgs: data.length,
             sample: data[0] ? data[0].src.slice(0, 32) : '', storeLen: store.length,
             storeHasImg: store.indexOf('data:image') >= 0 };
  })()`);
  log('  ' + JSON.stringify(avInfo));
  check('头像已替换为导入的图片', avInfo.dataImgs > 0, avInfo.dataImgs + ' 张生效 / 共 ' + avInfo.total + ' 个头像');
  check('头像已绑定到用户并写入本机存储', avInfo.storeHasImg, '存储 ' + avInfo.storeLen + ' 字节');

  await ev(api, `document.getElementById('statsBtn').click()`);
  await sleep(600);
  check('信息面板里也显示自定义头像', await ev(api, `[].slice.call(document.querySelectorAll('#whoList .av img')).filter(function(i){return i.src.indexOf('data:')===0}).length > 0`));
  await ev(api, `(function(){ const i = document.querySelector('#whoList input'); i.value = '测试昵称'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(700);
  const bind = await ev(api, `(function(){
    let p = {};
    try { p = JSON.parse(localStorage.getItem('chatview.profiles.v1') || '{}'); } catch (e) {}
    const uid = Object.keys(p).filter(function(k){ return p[k].n === '测试昵称'; })[0] || null;
    return { uid: uid, hasAvatar: uid ? !!p[uid].a : false,
             who: [].slice.call(document.querySelectorAll('#inner .who')).slice(0, 10).map(function(w){return w.textContent;}).join(',') };
  })()`);
  log('  ' + JSON.stringify(bind));
  check('昵称与头像绑定在同一用户档案下', !!bind.uid && bind.hasAvatar, 'uid = ' + bind.uid);
  check('改名已在对话区生效', bind.who.indexOf('测试昵称') >= 0, bind.who.slice(0, 50));
  await ev(api, `document.getElementById('statsClose').click()`);
  await sleep(300);

  const uids = await ev(api, `window.__CHAT__.S.users.slice(0, 2)`);
  const probeText = [
    '2025/03/14 09:30:00 ' + uids[0] + '说： a',
    '2025/03/14 09:30:10 ' + (uids[1] || uids[0]) + '说： b',
  ].join('\n');
  await ev(api, `window.__CHAT__.loadChat('probe.txt', ${JSON.stringify(probeText)})`);
  await sleep(600);
  const restored = await ev(api, `(function(){
    const S = window.__CHAT__.S;
    return S.users.map(function(u){ var p = S.profiles[u] || {}; return u + ' → ' + (p.n || '(默认)') + ' / ' + (p.a ? '有头像' : '无头像'); });
  })()`);
  log('  重新导入后: ' + JSON.stringify(restored));
  check('重新导入后昵称与头像自动恢复', restored.join(' ').indexOf('测试昵称') >= 0 && restored.join(' ').indexOf('有头像') >= 0);

  /* ============ 9.6 参与者档案管理 ============ */
  log('\n== 9.6 参与者档案管理 ==');
  await ev(api, `window.__origConfirm = window.confirm; window.confirm = function(){ return true; }; true`);

  check('工具栏有「档案管理」按钮', await ev(api, `!!document.getElementById('profilesBtn')`));
  await ev(api, `document.getElementById('profilesBtn').click()`);
  await sleep(800);
  const pfOpen = await ev(api, `(()=>({
    open: !document.getElementById('profileModal').hidden,
    rows: document.querySelectorAll('#pfList .pf-row').length,
    stat: document.getElementById('pfStat').textContent,
    tags: [].slice.call(document.querySelectorAll('#pfList .pf-tag')).map(function(x){return x.textContent;}).slice(0,6)
  }))()`);
  log('  ' + JSON.stringify(pfOpen));
  check('档案管理面板可打开并列出条目', pfOpen.open && pfOpen.rows >= 2, pfOpen.rows + ' 行 | ' + pfOpen.stat);
  check('列表带会话归属标记', pfOpen.tags.join('|').indexOf('本次会话') >= 0, pfOpen.tags.join(' / '));

  const pfTotal = await ev(api, `document.querySelectorAll('#pfList .pf-row').length`);
  const pfName = await ev(api, `(function(){ const S = window.__CHAT__.S; const u = S.users[0]; return (S.profiles[u] || {}).n || u; })()`);
  await ev(api, `(function(){ const s=document.getElementById('pfSearch'); s.value=${JSON.stringify(pfName)}; s.dispatchEvent(new Event('input')); })()`);
  await sleep(600);
  const pfFiltered = await ev(api, `document.querySelectorAll('#pfList .pf-row').length`);
  check('搜索可过滤档案', pfFiltered >= 1 && pfFiltered <= pfTotal,
    '按「' + pfName + '」过滤：' + pfTotal + ' → ' + pfFiltered + ' 行');
  await ev(api, `(function(){ const s=document.getElementById('pfSearch'); s.value=''; s.dispatchEvent(new Event('input')); })()`);
  await sleep(500);

  await ev(api, `(function(){ const i=document.querySelector('#pfList input'); i.value='档案面板改名'; i.dispatchEvent(new Event('change')); })()`);
  await sleep(700);
  const pfRename = await ev(api, `(function(){ const p=JSON.parse(localStorage.getItem('chatview.profiles.v1')||'{}'); return Object.keys(p).some(function(k){return p[k].n==='档案面板改名';}); })()`);
  check('面板内改名可保存', pfRename);

  await ev(api, `window.__cap=null;(function(){const o=URL.createObjectURL.bind(URL);URL.createObjectURL=function(b){window.__cap=b;return o(b);};})()`);
  await ev(api, `document.getElementById('pfExport').click()`);
  await sleep(1200);
  const dump = await ev(api, `(async function(){ if(!window.__cap) return null; return await window.__cap.text(); })()`);
  let dumpOk = false, dumpCount = 0;
  try { const j = JSON.parse(dump); dumpOk = j.kind === 'chatview-profiles'; dumpCount = Object.keys(j.profiles || {}).length; } catch (e) { }
  check('可导出档案为 JSON', dumpOk && dumpCount > 0, dumpCount + ' 条 / ' + (dump ? dump.length : 0) + ' 字节');

  const beforeClear = await ev(api, `Object.keys(JSON.parse(localStorage.getItem('chatview.profiles.v1')||'{}')).length`);
  await ev(api, `document.getElementById('pfClear').click()`);
  await sleep(900);
  const afterClear = await ev(api, `(()=>({store: Object.keys(JSON.parse(localStorage.getItem('chatview.profiles.v1')||'{}')).length, rows: document.querySelectorAll('#pfList .pf-row').length, stat: document.getElementById('pfStat').textContent}))()`);
  log('  清空前 ' + beforeClear + ' 条 → ' + JSON.stringify(afterClear));
  check('可清空全部档案', afterClear.store === 0 && afterClear.rows >= 2, '存储剩 ' + afterClear.store + ' 条，列表仍列出 ' + afterClear.rows + ' 位参与者');

  if (dump) {
    await ev(api, `(async function(){
      const blob = new Blob([${JSON.stringify(dump)}], { type: 'application/json' });
      const file = new File([blob], 'p.json', { type: 'application/json' });
      const dt = new DataTransfer(); dt.items.add(file);
      const inp = document.getElementById('profileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(1200);
    const afterImport = await ev(api, `(()=>({store: Object.keys(JSON.parse(localStorage.getItem('chatview.profiles.v1')||'{}')).length, avatars: [].slice.call(document.querySelectorAll('#pfList .av img')).length}))()`);
    log('  导入后: ' + JSON.stringify(afterImport));
    check('可导入档案并恢复', afterImport.store > 0, '恢复 ' + afterImport.store + ' 条');
    check('导入的头像能正确渲染', afterImport.avatars > 0, afterImport.avatars + ' 个');

    await ev(api, `(function(){ const b=document.querySelector('#pfList button[data-act="del"]'); if(b) b.click(); })()`);
    await sleep(800);
    const afterDel = await ev(api, `Object.keys(JSON.parse(localStorage.getItem('chatview.profiles.v1')||'{}')).length`);
    check('可删除单条档案', afterDel < afterImport.store, afterImport.store + ' → ' + afterDel);

    // 恢复档案，供后面的导出验证使用
    await ev(api, `(async function(){
      const blob = new Blob([${JSON.stringify(dump)}], { type: 'application/json' });
      const file = new File([blob], 'p2.json', { type: 'application/json' });
      const dt = new DataTransfer(); dt.items.add(file);
      const inp = document.getElementById('profileInput');
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
    await sleep(1000);
    const restoredN = await ev(api, `Object.keys(JSON.parse(localStorage.getItem('chatview.profiles.v1')||'{}')).length`);
    check('删除后可再次导入恢复', restoredN > 0, '恢复 ' + restoredN + ' 条');
  }

  await ev(api, `document.getElementById('pfClose').click()`);
  await sleep(400);
  check('面板可关闭', await ev(api, `document.getElementById('profileModal').hidden`));
  await ev(api, `window.confirm = window.__origConfirm; true`);

  /* ============ 10. 导出（子集，完整真实流程） ============ */
  log('\n== 10. 导出流程（子集 320 行，真实下载+内嵌） ==');
  const rawLines = fs.readFileSync(TXT, 'utf8').split(/\r?\n/);
  const subsetPath = path.join(ROOT, 'subset.txt');
  const subsetText = rawLines.slice(0, 320).join('\n');
  fs.writeFileSync(subsetPath, subsetText, 'utf8');

  await ev(api, `window.__cap=null;(function(){const o=URL.createObjectURL.bind(URL);URL.createObjectURL=function(b){window.__cap=b;return o(b);};})()`);
  await ev(api, `window.__CHAT__.loadChat('subset.txt', ${JSON.stringify(subsetText)})`);
  await sleep(1200);
  const sub = await ev(api, `(()=>{const S=window.__CHAT__.S;return{msgs:S.msgs.length,imgs:S.imgCount,emotes:S.emoteCount}})()`);
  log('  子集: ' + JSON.stringify(sub));
  check('子集导入成功', sub.msgs > 200 && sub.imgs > 10, sub.msgs + ' 条 / ' + sub.imgs + ' 图');

  await ev(api, `document.getElementById('exportBtn').click()`);
  await sleep(400);
  check('导出对话框打开', await ev(api, `!document.getElementById('exportModal').hidden`));
  log('  体积预估: ' + (await ev(api, `document.getElementById('expNote').textContent`)).slice(0, 120));
  await shot(api, '08-export-dialog');

  await ev(api, `document.querySelector('#modeSeg button[data-v="smart"]').click()`);
  await sleep(200);
  await ev(api, `(function(){const m=document.getElementById('maxSide');m.value=1080;m.dispatchEvent(new Event('input'));})()`);
  await sleep(200);
  await ev(api, `document.getElementById('expGo').click()`);

  let done = false, last = null;
  for (let i = 0; i < 240; i++) {
    last = await ev(api, `(()=>({pct:document.getElementById('expPct').textContent,label:document.getElementById('expLabel').textContent,cap:!!window.__cap,busy:document.getElementById('expGo').disabled}))()`);
    if (last.cap && !last.busy) { done = true; break; }
    await sleep(600);
  }
  log('  导出结束: ' + JSON.stringify(last));
  check('导出流程完成并生成文件', done, last && last.label);

  if (!done) throw new Error('导出未完成，终止后续验证');

  const expPath = path.join(ROOT, 'export-sample.html');
  const text = await ev(api, `(async()=>await window.__cap.text())()`);
  fs.writeFileSync(expPath, text, 'utf8');
  const sizeKB = Math.round(fs.statSync(expPath).size / 1024);
  log('  导出文件: ' + expPath + '  ' + sizeKB + ' KB');
  const dataImgs = (text.match(/data:image\//g) || []).length;
  check('导出文件内嵌图片', dataImgs > 5, dataImgs + ' 处 data:image');
  check('导出文件含消息数据', text.includes('"msgs"'));
  check('导出文件自包含引擎', text.includes('__CHAT_EXPORT__') && text.includes('charset="utf-8"'));
  check('导出文件带上自定义头像', text.indexOf('"avatar":"data:image') >= 0);
  const expectName = await ev(api, `(function(){ const S=window.__CHAT__.S; return (S.profiles[S.users[0]]||{}).n || ''; })()`);
  check('导出文件带上自定义昵称', !!expectName && text.indexOf(expectName) >= 0, '期望昵称「' + expectName + '」');

  /* ============ 11. 打开导出文件（离线可用性） ============ */
  log('\n== 11. 打开导出文件验证 ==');
  await send(api, 'Page.navigate', { url: 'file:///' + encodeURI(expPath.replace(/\\/g, '/')) });
  await sleep(1500);
  let ok2 = false;
  for (let i = 0; i < 50; i++) { try { ok2 = await ev(api, '!!window.__CHAT__ && window.__CHAT__.S.ready'); } catch (e) { } if (ok2) break; await sleep(250); }
  check('导出文件可独立打开', ok2);
  const ex = await ev(api, `(()=>{const S=window.__CHAT__.S;const inn=document.getElementById('inner');const cells=[...inn.querySelectorAll('.imgs .cell img')];const emos=[...inn.querySelectorAll('.emo-img')];
    return{msgs:S.msgs.length,dom:inn.children.length,cells:cells.length,localCells:cells.filter(i=>i.src.startsWith('data:')).length,onlineCells:cells.filter(i=>/^https?:/.test(i.src)).length,emos:emos.length,localEmos:emos.filter(i=>i.src.startsWith('data:')).length}})()`);
  log('  ' + JSON.stringify(ex));
  check('导出文件消息数一致', ex.msgs === sub.msgs, ex.msgs + ' 条');
  check('图片全部本地 data: 读取（无需联网）', ex.localCells > 0 && ex.onlineCells === 0, '本地 ' + ex.localCells + ' / 联网 ' + ex.onlineCells);
  check('表情已内嵌本地', ex.localEmos > 0, ex.localEmos + ' 个');
  const exAv = await ev(api, `(function(){
    const s = window.__CHAT__.S;
    const imgs = [].slice.call(document.querySelectorAll('#inner .av img')).filter(function(i){ return i.src.indexOf('data:') === 0; });
    return { n: imgs.length, names: s.users.map(function(u){ var p = s.profiles[u] || {}; return p.n || ''; }).join(',') };
  })()`);
  check('离线副本内头像正常显示', exAv.n > 0, exAv.n + ' 个');
  check('离线副本内昵称保留', !!expectName && exAv.names.indexOf(expectName) >= 0, '副本内昵称: ' + exAv.names);
  const off = await ev(api, `(async()=>{
    const i=[...document.querySelectorAll('.imgs .cell img')].find(x=>x.src.startsWith('data:'));
    if(!i)return{ok:false};
    const u=i.src;
    return await new Promise(res=>{const t=setTimeout(()=>res({ok:false,why:'timeout'}),20000);
      const im=new Image();
      im.onload=()=>{clearTimeout(t);res({ok:true,nw:im.naturalWidth,nh:im.naturalHeight})};
      im.onerror=()=>{clearTimeout(t);res({ok:false,why:'error'})};
      im.src=u;});
  })()`);
  check('内嵌图片可正常解码', off.ok, off.nw + '×' + off.nh);
  await shot(api, '09-export-offline');

  const KW2 = await ev(api, `(function(){
    const S = window.__CHAT__.S, cnt = {};
    let best = '', n = 0;
    for (let i = 0; i < S.msgs.length; i++) {
      const t = S.msgs[i]._plain || '';
      for (let j = 0; j + 2 <= t.length; j++) {
        const g = t.slice(j, j + 2);
        if (/\\s/.test(g)) continue;
        cnt[g] = (cnt[g] || 0) + 1;
      }
    }
    for (const k in cnt) if (cnt[k] > n) { n = cnt[k]; best = k; }
    return best;
  })()`);
  await ev(api, `(function(){const s=document.getElementById('search');s.value=${JSON.stringify(KW2)};s.dispatchEvent(new Event('input'));})()`);
  await sleep(1000);
  const hitsN = await ev(api, `window.__CHAT__.S.hits.length`);
  check('导出文件内搜索可用', hitsN > 0, hitsN + ' 条');
  await ev(api, `(function(){const s=document.getElementById('search');s.value='';s.dispatchEvent(new Event('input'));})()`);
  await sleep(500);
  await ev(api, `(function(){const c=document.querySelector('#inner .imgs .cell');if(c)c.click();})()`);
  await sleep(1500);
  check('导出文件内灯箱可用', await ev(api, `!document.getElementById('lightbox').hidden && document.getElementById('lbImg').naturalWidth>0`));
  await shot(api, '10-export-lightbox');
  await ev(api, `document.getElementById('lbClose').click()`);

  await ev(api, `(function(){const s=document.getElementById('stream');s.scrollTop=s.scrollHeight;})()`);
  await sleep(1000);
  await shot(api, '11-export-bottom');

  /* ============ 12. 控制台错误 ============ */
  const errs = api.logs.filter((m) => m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    .map((m) => (m.params.entry.text || '').slice(0, 160))
    .filter((t) => !/favicon/i.test(t));
  check('无控制台报错', errs.length === 0, errs.slice(0, 4).join(' | '));

  log('\n========================================');
  const pass = results.filter((x) => x.ok).length;
  log('结果: ' + pass + ' / ' + results.length + ' 项通过');
  results.filter((x) => !x.ok).forEach((x) => log('  [FAIL] ' + x.name + ' -> ' + x.detail));
  log('========================================');

  try { edge.kill(); } catch (e) { }
  await sleep(400);
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}

main().catch(async (e) => {
  log('\n!! 测试异常: ' + (e && e.stack || e));
  try { if (edge) edge.kill(); } catch (er) { }
  process.exit(2);
});
