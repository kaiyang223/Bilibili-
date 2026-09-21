/* =========================================================================
   聊天记录浏览器 · 引擎
   解析 txt 聊天记录 -> 对话视图 -> 导出离线单文件
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */
  var DICT = window.__EMOTE_DICT__ || {};
  var B64 = window.__EMOTE_B64__ || {};
  var EMOTE_CDN = 'https://i0.hdslb.com/bfs/emote/';
  var WIN = 220;        // 每次扩展的条数
  var MAXN = 1500;      // 同时保留在 DOM 中的最大条数
  var BATCH_FIRST = 260;

  var EXPORT = window.__CHAT_EXPORT__ || null;
  var isExport = !!EXPORT;

  var $ = function (id) { return document.getElementById(id); };

  /* --------------------------------------------------- 表情名 -> emoji 兜底 */
  var EM = {
    '微笑': '😊', '大笑': '😄', '笑哭': '😂', '呲牙': '😁', '偷笑': '🤭', '害羞': '☺️',
    '大哭': '😭', '哭泣': '😭', '流泪': '🥲', '难过': '🙁', '委屈': '🥺', '撇嘴': '😖',
    '生气': '😠', '发怒': '😡', '抓狂': '🤯', '惊讶': '😲', '惊吓': '😱', '惊喜': '🤩',
    '无语': '😑', '尴尬': '😅', '无奈': '😮‍💨', '抠鼻': '😤', '白眼': '🙄', '翻白眼': '🙄',
    '斜眼笑': '😏', '阴险': '😈', '奸笑': '😼', '调皮': '😜', '馋': '🤤', '流鼻血': '🤤',
    '色': '😍', '喜欢': '😍', '星星眼': '🤩', '给心心': '💗', '爱心': '❤️', '亲亲': '😘',
    '拥抱': '🤗', '鼓掌': '👏', '点赞': '👍', '支持': '💪', '奋斗': '💪', '加油': '💪',
    '打call': '🙌', '抱拳': '🙏', '保佑': '🙏', '跪了': '🧎', '胜利': '✌️', '响指': '🤞',
    '思考': '🤔', '疑问': '❓', '疑惑': '🤨', '酸了': '🍋', '嗑瓜子': '🍉', '吃瓜': '🍉',
    '捂眼': '🙈', '捂脸': '🤦', '嫌弃': '😒', '滑稽': '🤪', '傲娇': '😼', '嘟嘟': '😗',
    '喜极而泣': '🥹', '捂嘴': '🤭', '墨镜': '😎', '口罩': '😷', '生病': '🤒', '哈欠': '🥱',
    '睡': '😴', '困': '😪', '嘘声': '🤫', '冷': '🥶', '汗': '😰', '流汗': '😅',
    '囧': '😳', '热': '🥵', '脸红': '😳', '再见': '👋', '干杯': '🍻', '鸡腿': '🍗',
    '水稻': '🌾', '雪花': '❄️', '锦鲤': '🐟', '牛年': '🐮', 'doge': '🐶', 'doge_金箍': '🐶',
    '藏狐': '🦊', '哦呼': '😲', '歪嘴': '😏', '妙啊': '👌', '辣眼睛': '🫣'
  };

  /* ------------------------------------------------------------- 工具函数 */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(t) {
    var d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDate(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtFull(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function hashCode(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  var AV_COLORS = [
    ['#fb7299', '#ff9db9'], ['#00aeec', '#57c8f5'], ['#7c4dff', '#b39dff'],
    ['#00c853', '#69f0ae'], ['#ff8f00', '#ffc46b'], ['#e91e63', '#ff7ba9'],
    ['#00897b', '#4db6ac'], ['#5c6bc0', '#9fa8da'], ['#d81b60', '#f48fb1'],
    ['#f4511e', '#ffab91'], ['#3949ab', '#7986cb'], ['#00838f', '#4dd0e1']
  ];
  function avStyle(uid) {
    var i = S.users.indexOf(uid);
    if (i < 0) i = 0;
    var base = hashCode(String(S.users[0] || 'x')) % AV_COLORS.length;
    var c = AV_COLORS[(base + i * 5) % AV_COLORS.length];
    return 'background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')';
  }
  function avText(uid) {
    var s = String(nameOf(uid) || uid).trim();
    if (/^\d/.test(s)) return s.slice(0, 2);
    var arr = Array.from(s);
    return arr.length ? arr[0] : String(uid).slice(0, 2);
  }

  // 把头像元素画成「自定义图片」或「色块 + 文字」
  function fillAvatar(el, uid) {
    if (!el) return;
    el.dataset.uid = uid;
    el.title = nameOf(uid) + ' · 点击更换头像';
    var src = avatarOf(uid);
    if (src) {
      el.classList.add('has-img');
      el.style.cssText = '';
      el.textContent = '';
      var im = document.createElement('img');
      im.src = src;
      im.alt = '';
      el.appendChild(im);
    } else {
      el.classList.remove('has-img');
      el.textContent = avText(uid);
      el.style.cssText = avStyle(uid);
    }
  }

  /* --------------------------------------------------- 表情与图片 URL 处理 */
  function normName(n) { return String(n).replace(/_/g, '-'); }

  function matchEmote(name) {
    if (!name) return null;
    var n = String(name);
    if (DICT[n]) return n;
    var m = normName(n);
    if (DICT[m]) return m;
    var i = m.indexOf('-');
    if (i > 0) {
      var base = m.slice(i + 1);
      if (DICT[base]) return base;
    }
    return null;
  }
  function emoteEmoji(name) {
    var n = String(name);
    if (EM[n]) return EM[n];
    var m = normName(n);
    if (EM[m]) return EM[m];
    var i = m.indexOf('-');
    if (i > 0 && EM[m.slice(i + 1)]) return EM[m.slice(i + 1)];
    return null;
  }
  function emoteSrc(key) {
    if (!key) return null;
    var fn = (isExport && EXPORT.dict && EXPORT.dict[key]) || DICT[key];
    return fn ? EMOTE_CDN + fn : null;
  }

  var IMG_EXT = /\.(?:jpe?g|png|gif|webp|bmp|avif|heic|heif|svg)(?:[?#]|$)/i;
  var IMG_HOST = /(?:biliimg\.com|hdslb\.com|sinaimg\.cn|qpic\.cn|imgur\.com|githubusercontent\.com|aliyuncs\.com|myqcloud\.com|byteimg\.com|douyinpic\.com)/i;
  var NOT_IMAGE = /\.(?:mp4|m4a|mp3|webm|mov|zip|rar|7z|pdf|json|html?|js|css)(?:[?#]|$)|\/(?:video|read|bangumi|mall|detailuniversal|space|account)\/?/i;

  function isImageUrl(u) {
    if (!u) return false;
    if (IMG_EXT.test(u)) return true;
    if (IMG_HOST.test(u) && !NOT_IMAGE.test(u)) return true;
    return false;
  }

  // 把一段文本切成 parts
  var TOKEN_RE = /\[([^\[\]\n]{1,24})\]|(https?:\/\/[^\s<>"'“”‘’（）【】《》，。；：！？、]+)/g;

  function tokenize(text) {
    var parts = [], last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (m.index > last) parts.push(['t', text.slice(last, m.index)]);
      if (m[1] !== undefined) {
        var nam = m[1];
        var key = matchEmote(nam);
        if (key) parts.push(['e', nam, key]);
        else {
          var em = emoteEmoji(nam);
          if (em) parts.push(['e', nam, null, em]);
          else parts.push(['t', m[0]]);
        }
      } else {
        var u = m[2];
        // 尾部可能粘连标点
        var tail = '';
        var mm = /[.,;:!?\)\]\}]+$/.exec(u);
        if (mm && /[a-z0-9]$/i.test(u.slice(0, -mm[0].length))) { tail = mm[0]; u = u.slice(0, -mm[0].length); }
        parts.push([isImageUrl(u) ? 'i' : 'u', u]);
        if (tail) parts.push(['t', tail]);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(['t', text.slice(last)]);
    // 合并相邻文本
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (out.length && out[out.length - 1][0] === 't' && parts[i][0] === 't') out[out.length - 1][1] += parts[i][1];
      else out.push(parts[i]);
    }
    return out;
  }

  /* ------------------------------------------------------------- 解析器 */
  var HEAD_RE = /^[\s\uFEFF]*(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})[ \t]+(\d{1,2})[ \t]*:[ \t]*(\d{2})(?:[ \t]*:[ \t]*(\d{2}))?[ \t]+([\s\S]*)$/;
  var SAY_RE = /^([\s\S]*?)[ \t]*说[ \t]*[:：][ \t]?([\s\S]*)$/;
  var COLON_RE = /^([^:：\n]{1,48})[ \t]*[:：][ \t]?([\s\S]*)$/;

  function parseChat(raw) {
    var text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var msgs = [];
    var users = [], userSet = Object.create(null);
    var unresolved = 0;

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (!line.trim()) continue;
      var h = HEAD_RE.exec(line);
      if (!h) {
        if (msgs.length) {
          var lastM = msgs[msgs.length - 1];
          lastM.raw += '\n' + line;
          lastM.parts = tokenize(lastM.raw);
          lastM.edited = true;
        } else {
          unresolved++;
          msgs.push(makeSys(0, line));
        }
        continue;
      }
      var t = new Date(+h[1], +h[2] - 1, +h[3], +h[4], +h[5], +(h[6] || 0), 0).getTime();
      var rest = h[7];
      var body = null, who = null;
      var s = SAY_RE.exec(rest);
      if (s) { who = s[1].trim(); body = s[2]; }
      else {
        var c = COLON_RE.exec(rest);
        if (c) { who = c[1].trim(); body = c[2]; }
        else { who = '系统'; body = rest; }
      }
      if (!who) who = '未知';
      body = body.replace(/^[ \t]+/, '');

      if (userSet[who] === undefined) { userSet[who] = users.length; users.push(who); }

      var m = { t: t, u: who, d: fmtDate(t), raw: body, parts: null };

      // 结构化 JSON 消息（例如系统提示）
      var trimmed = body.trim();
      if (trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{') {
        try {
          var o = JSON.parse(trimmed);
          var arr = Object.prototype.toString.call(o) === '[object Array]' ? o : [o];
          if (arr.length && arr[0] && typeof arr[0].text === 'string') {
            var joined = '';
            for (var k = 0; k < arr.length; k++) joined += (arr[k].text || '');
            m.sys = true;
            m.sysText = joined;
            m.sysColor = arr[0].color_day || null;
            m.sysColorN = arr[0].color_nig || arr[0].color_nig || null;
            m.parts = [['t', joined]];
            msgs.push(m);
            continue;
          }
        } catch (e) { /* 不是 JSON，按普通文本处理 */ }
      }

      m.parts = tokenize(body);
      msgs.push(m);
    }

    // 补日期字段 & 统计图片
    var imgCount = 0, emoteCount = 0;
    for (var i = 0; i < msgs.length; i++) {
      if (!msgs[i].d) msgs[i].d = fmtDate(msgs[i].t);
      if (msgs[i].parts) {
        for (var j = 0; j < msgs[i].parts.length; j++) {
          if (msgs[i].parts[j][0] === 'i') imgCount++;
          else if (msgs[i].parts[j][0] === 'e') emoteCount++;
        }
      }
    }

    return {
      msgs: msgs, users: users, imgCount: imgCount, emoteCount: emoteCount,
      unresolved: unresolved, bytes: raw.length
    };
  }

  function makeSys(t, text) {
    return { t: t || Date.now(), u: '系统', d: fmtDate(t || Date.now()), raw: text,
      sys: true, sysText: text, parts: [['t', text]] };
  }

  /* --------------------------------------------------------------- 状态 */
  var S = {
    file: '', title: '', msgs: [], users: [], imgCount: 0, emoteCount: 0, bytes: 0,
    profiles: {}, flip: false, noPersist: false,
    win: { start: 0, end: -1 }, q: '', hits: [], hitIdx: -1,
    allImgs: [], imgPos: {}, ready: false
  };

  /* ------------------------------------ 参与者档案：昵称 + 头像（按 uid 绑定） */
  var STORE_KEY = 'chatview.profiles.v1';

  function loadProfiles() {
    if (S.noPersist) return;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      S.profiles = (raw ? JSON.parse(raw) : null) || {};
    } catch (e) { S.profiles = {}; }
  }

  function saveProfiles() {
    if (S.noPersist) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S.profiles));
    } catch (e) {
      toast('头像没能保存：本地存储空间不足，换张小一点的图片试试', 3600, true);
    }
  }

  function nameOf(uid) {
    var p = S.profiles[uid];
    return (p && p.n) || uid;
  }
  function avatarOf(uid) {
    var p = S.profiles[uid];
    return (p && p.a) || null;
  }

  function collectImages() {
    var list = [];
    for (var i = 0; i < S.msgs.length; i++) {
      var p = S.msgs[i].parts;
      if (!p) continue;
      for (var j = 0; j < p.length; j++) {
        if (p[j][0] === 'i') { S.imgPos[p[j][1]] = list.length; list.push({ url: p[j][1], m: i }); }
      }
    }
    S.allImgs = list;
  }

  /* --------------------------------------------------------------- 渲染 */
  var stream, inner, topS, botS;

  function imgSrc(url) {
    if (isExport && EXPORT.imgs && EXPORT.imgs[url]) return EXPORT.imgs[url];
    return url;
  }

  // B 站图床支持在 URL 后追加 @<w>w_<h>h.webp 参数，按需取小图，体积约为原图 1/10
  var CDN_SCALE = /^https?:\/\/(?:[a-z0-9-]+\.)?(?:biliimg\.com|hdslb\.com)\//i;
  function cdnScale(url, px) {
    if (!url || !CDN_SCALE.test(url) || /^data:/.test(url)) return null;
    var base = url.split('@')[0];
    return base + '@' + px + 'w_' + px + 'h.webp';
  }
  // 浏览时用缩放图（快 10 倍），点击灯箱再看原图
  function displaySrc(url) {
    if (isExport) return imgSrc(url);
    return cdnScale(url, 1080) || url;
  }

  function partHTML(p, ctx) {
    var k = p[0];
    if (k === 't') return ctx.hl(esc(p[1]));
    if (k === 'u') {
      return '<a href="' + esc(p[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(p[1]) + '</a>';
    }
    if (k === 'e') {
      var name = p[1], ref = p[2], emoji = p[3] || emoteEmoji(name) || '💬';
      var src = null;
      if (ref) src = /^(?:data:|https?:)/.test(ref) ? imgSrc(ref) : imgSrc(emoteSrc(ref));
      if (src) {
        return '<img class="emo-img" src="' + esc(src) + '" data-e="' + esc(ref || '') +
          '" alt="[' + esc(name) + ']" title="[' + esc(name) + ']">';
      }
      return '<span class="emo-fallback" title="[' + esc(name) + ']">' + esc(emoji) + '</span>';
    }
    if (k === 'i') return '';
    return '';
  }

  function renderParts(parts, ctx) {
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i][0] === 'i') continue;
      out += partHTML(parts[i], ctx);
    }
    return out;
  }

  function buildMsgEl(idx) {
    var m = S.msgs[idx];
    var prev = idx > 0 ? S.msgs[idx - 1] : null;
    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.dataset.i = idx;

    if (!prev || prev.d !== m.d) {
      var sep = document.createElement('div');
      sep.className = 'daysep';
      var rd = new Date(m.t);
      var wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][rd.getDay()];
      sep.innerHTML = '<span>' + esc(fmtDate(m.t)) + ' ' + wk + '</span>';
      wrap.appendChild(sep);
    }

    if (m.sys) {
      var sy = document.createElement('div');
      sy.className = 'sys';
      var sp = document.createElement('span');
      sp.textContent = m.sysText;
      if (m.sysColor) { sy.style.setProperty('--sc', m.sysColor); }
      sy.appendChild(sp);
      wrap.appendChild(sy);
      return wrap;
    }

    var isImgOnly = m.parts.length > 0 && m.parts.every(function (p) { return p[0] === 'i'; });

    var msg = document.createElement('div');
    msg.className = 'msg' + (isRightSide(m.u) ? ' right' : '');

    var av = document.createElement('div');
    av.className = 'av';
    fillAvatar(av, m.u);
    msg.appendChild(av);

    var col = document.createElement('div');
    col.className = 'col';

    var who = document.createElement('div');
    who.className = 'who';
    who.textContent = nameOf(m.u);
    who.dataset.uid = m.u;
    col.appendChild(who);

    var ctx = { hl: S.q ? function (s) { return highlight(s, m, idx); } : function (s) { return s; } };

    var txt = renderParts(m.parts, ctx);
    if (txt) {
      var b = document.createElement('div');
      b.className = 'bubble' + (isImgOnly ? ' plain' : '');
      b.innerHTML = txt;   // parts 已在 partHTML 中转义
      col.appendChild(b);
    }

    var imgs = m.parts.filter(function (p) { return p[0] === 'i'; });
    if (imgs.length) {
      var n = Math.min(imgs.length, 4);
      var box = document.createElement('div');
      box.className = 'imgs n' + n;
      for (var ii = 0; ii < imgs.length; ii++) {
        var url = imgs[ii][1];
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.pos = (S.imgPos[url] == null ? 0 : S.imgPos[url]);
        var im = document.createElement('img');
        im.loading = 'lazy';
        im.decoding = 'async';
        im.alt = '图片';
        im.dataset.src = url;
        im.src = displaySrc(url);
        var tg = document.createElement('span');
        tg.className = 'tag';
        tg.textContent = imgs.length > 1 ? (ii + 1) + ' / ' + imgs.length : '查看原图';
        cell.appendChild(im); cell.appendChild(tg);
        box.appendChild(cell);
      }
      col.appendChild(box);
    }

    var st = document.createElement('div');
    st.className = 'stamp';
    st.textContent = fmtTime(m.t);
    st.title = fmtFull(m.t);
    col.appendChild(st);

    msg.appendChild(col);
    wrap.appendChild(msg);
    return wrap;
  }

  function uidIdx(uid) {
    var i = S.users.indexOf(uid);
    return i < 0 ? 0 : i;
  }

  // 默认第 2、4、6…位参与者在右侧（主位）；flip 后整体对调
  function isRightSide(uid) {
    var right = (uidIdx(uid) % 2 === 1);
    return S.flip ? !right : right;
  }

  /* ------------------------------------------------------------- 高亮 */
  function highlight(escaped, m, idx) {
    if (!S.q) return escaped;
    var plain = m._plain || '';
    if (plain.toLowerCase().indexOf(S.q.toLowerCase()) < 0) return escaped;
    var eq = esc(S.q);
    var lo = escaped.toLowerCase(), lq = eq.toLowerCase();
    var p = 0, r = '';
    while (true) {
      var f = lo.indexOf(lq, p);
      if (f < 0) break;
      r += escaped.slice(p, f) + '<mark class="hl">' + escaped.slice(f, f + eq.length) + '</mark>';
      p = f + eq.length;
    }
    r += escaped.slice(p);
    return r;
  }

  function currentTopIdx() {
    var st = stream.scrollTop;
    var kids = inner.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].offsetTop + kids[i].offsetHeight > st + 4) return S.win.start + i;
    }
    return S.win.start;
  }

  /* ------------------------------------------------------------ 会话渲染 */
  function resetWindow(centerIdx, keepScroll) {
    var n = S.msgs.length;
    if (!n) return;
    var s = Math.max(0, centerIdx - Math.floor(WIN / 2));
    var e = Math.min(n - 1, s + WIN - 1);
    s = Math.max(0, e - WIN + 1);
    inner.textContent = '';
    S.win.start = s; S.win.end = s - 1;
    appendTo(e, true);
    if (!keepScroll) scrollToIdx(centerIdx, false);
  }

  function appendTo(endIdx, silent) {
    var frag = document.createDocumentFragment();
    for (var i = S.win.end + 1; i <= endIdx; i++) frag.appendChild(buildMsgEl(i));
    inner.appendChild(frag);
    S.win.end = endIdx;
    if (!silent) { }
  }

  function prependTo(startIdx) {
    var frag = document.createDocumentFragment();
    for (var i = S.win.start - 1; i >= startIdx; i--) frag.insertBefore(buildMsgEl(i), frag.firstChild);
    var h0 = inner.offsetHeight;
    inner.insertBefore(frag, inner.firstChild);
    S.win.start = startIdx;
    stream.scrollTop += inner.offsetHeight - h0;
  }

  function extendBottom() {
    var n = S.msgs.length;
    if (S.win.end >= n - 1) return false;
    appendTo(Math.min(n - 1, S.win.end + WIN));
    trimTop();
    return true;
  }
  function extendTop() {
    if (S.win.start <= 0) return false;
    prependTo(Math.max(0, S.win.start - WIN));
    trimBottom();
    return true;
  }

  function trimTop() {
    var cnt = inner.children.length;
    if (cnt <= MAXN) return;
    if (stream.scrollTop <= 2) return;   // 用户停留在顶部时不裁剪，避免内容被换走
    var k = Math.min(cnt - MAXN, 300);
    var ref = inner.children[k];
    var topBefore = ref.offsetTop;
    for (var i = 0; i < k; i++) inner.removeChild(inner.firstElementChild);
    var topAfter = inner.children[0].offsetTop;
    stream.scrollTop -= (topBefore - topAfter);
    S.win.start += k;
  }
  function trimBottom() {
    var cnt = inner.children.length;
    if (cnt <= MAXN) return;
    var k = Math.min(cnt - MAXN, 300);
    var n = inner.children.length;
    for (var i = 0; i < k; i++) inner.removeChild(inner.lastElementChild);
    S.win.end -= k;
  }

  function scrollToIdx(idx, smooth) {
    ensureIdx(idx);
    var el = inner.children[idx - S.win.start];
    if (!el) return;
    var y = el.offsetTop - 90;
    if (smooth) stream.scrollTo({ top: y, behavior: 'smooth' });
    else stream.scrollTop = y;
  }
  function ensureIdx(idx) {
    if (idx < S.win.start || idx > S.win.end) resetWindow(idx, true);
  }

  /* --------------------------------------------------------------- 搜索 */
  function buildPlain() {
    for (var i = 0; i < S.msgs.length; i++) {
      var m = S.msgs[i];
      if (m._plain != null) continue;
      var s = '';
      var p = m.parts || [];
      for (var j = 0; j < p.length; j++) {
        var k = p[j][0];
        if (k === 't') s += p[j][1];
        else if (k === 'u') s += ' ' + p[j][1] + ' ';
        else if (k === 'e') s += '[' + p[j][1] + ']';
        else if (k === 'i') s += ' [图片] ';
      }
      m._plain = s;
    }
  }

  function doSearch(q) {
    S.q = q.trim();
    S.hits = []; S.hitIdx = -1; S.hitSet = {};
    if (!S.q) { refreshWindow(); updateSearchUI(); return; }
    var needle = S.q.toLowerCase();
    for (var i = 0; i < S.msgs.length; i++) {
      var p = S.msgs[i]._plain || '';
      if (p.toLowerCase().indexOf(needle) >= 0) { S.hitSet[i] = S.hits.length; S.hits.push(i); }
    }
    if (S.hits.length) { S.hitIdx = 0; gotoHit(0); }
    else refreshWindow();
    updateSearchUI();
  }

  function refreshWindow() {
    if (!S.msgs.length) return;
    var topIdx = currentTopIdx();
    resetWindow(Math.min(S.msgs.length - 1, topIdx + Math.floor(WIN / 2)), true);
    scrollToIdx(topIdx, false);
  }

  function gotoHit(i) {
    if (!S.hits.length) return;
    if (i < 0) i = S.hits.length - 1;
    if (i >= S.hits.length) i = 0;
    S.hitIdx = i;
    var idx = S.hits[i];
    scrollToIdx(idx, false);
    // 重绘当前窗口以更新当前高亮
    markCurrentHit(idx);
    updateSearchUI();
  }

  function markCurrentHit(idx) {
    var els = inner.querySelectorAll('mark.hl.cur');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('cur');
    var wrap = inner.children[idx - S.win.start];
    if (!wrap) return;
    var mk = wrap.querySelectorAll('mark.hl');
    for (var j = 0; j < mk.length; j++) mk[j].classList.add('cur');
  }

  function updateSearchUI() {
    var el = $('searchCount');
    if (!el) return;
    if (!S.q) { el.textContent = ''; return; }
    if (!S.hits.length) { el.textContent = '无结果'; return; }
    el.textContent = (S.hitIdx + 1) + '/' + S.hits.length;
  }

  /* --------------------------------------------------------------- 灯箱 */
  var lb = { i: -1, scale: 1, x: 0, y: 0, drag: false };

  function openLb(pos) {
    if (pos == null || pos < 0 || pos >= S.allImgs.length) return;
    lb.i = pos; lb.scale = 1; lb.x = 0; lb.y = 0;
    applyLb();
    $('lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    var img = $('lbImg');
    img.onload = function () {
      $('lbStatus').textContent = img.naturalWidth + ' × ' + img.naturalHeight + '  ' +
        (lb.i + 1) + ' / ' + S.allImgs.length;
    };
    img.onerror = function () { $('lbStatus').textContent = '⚠ 图片加载失败'; };
    $('lbName').textContent = (lb.i + 1) + ' / ' + S.allImgs.length;
  }
  function closeLb() {
    $('lightbox').hidden = true;
    $('lbImg').removeAttribute('src');
    document.body.style.overflow = '';
  }
  function applyLb() {
    var item = S.allImgs[lb.i];
    if (!item) return;
    var img = $('lbImg');
    var url = imgSrc(item.url);
    if (img.getAttribute('src') !== url) img.src = url;
    img.style.transform = 'translate(' + lb.x + 'px,' + lb.y + 'px) scale(' + lb.scale + ')';
    $('lbName').textContent = (lb.i + 1) + ' / ' + S.allImgs.length;
  }
  function lbStep(d) {
    var n = lb.i + d;
    if (n < 0) n = S.allImgs.length - 1;
    if (n >= S.allImgs.length) n = 0;
    lb.i = n; lb.scale = 1; lb.x = 0; lb.y = 0;
    applyLb();
  }

  /* --------------------------------------------------------------- 导出 */
  var expOpts = { mode: 'smart', maxSide: 1440 };

  function estimateExport() {
    var n = S.imgCount;
    var note = $('expNote');
    if (!note) return;
    if (expOpts.mode === 'link') {
      note.innerHTML = '将导出 <b>' + S.msgs.length.toLocaleString() + '</b> 条消息，图片保留为网络链接。' +
        '文件体积约 <b>' + humanSize(S.bytes) + '</b> 左右，查看图片时需要联网。';
      return;
    }
    // 经验值：压缩内嵌时每张图片平均体积，1080 px 约 64 KB、720 px 约 45 KB
    var per = expOpts.mode === 'raw' ? 420 * 1024 : Math.round(64 * 1024 * Math.pow(expOpts.maxSide / 1080, 0.89));
    var total = S.bytes + n * per;
    note.innerHTML = '将导出 <b>' + S.msgs.length.toLocaleString() + '</b> 条消息、<b>' + n.toLocaleString() +
      '</b> 张图片。预计文件大小约 <b>' + humanSize(total) + '</b>，导出后可完全离线查看。' +
      (n > 800 ? '<br><span style="color:var(--tx3)">图片较多，建议先用「压缩内嵌」；如体积过大可降低最长边。</span>' : '');
  }

  function fetchBlob(url) {
    return fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 部分原图可达 2~4MB，高并发下会偶发失败，这里做退避重试
  function fetchBlobRetry(url, tries) {
    tries = tries == null ? 3 : tries;
    return fetchBlob(url).catch(function (err) {
      if (tries <= 1) throw err;
      return delay(280 + Math.random() * 520).then(function () { return fetchBlobRetry(url, tries - 1); });
    });
  }

  function renderWebpBlob(blob, maxSide, quality) {
    return new Promise(function (resolve) {
      if (blob.type === 'image/gif') return resolve(blob);
      var bmp;
      createImageBitmap(blob).then(function (b) {
        bmp = b;
        var w = b.width, h = b.height;
        var sc = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
        var cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(b, 0, 0, cw, ch);
        try { b.close(); } catch (e) { }
        var done = function (out) {
          if (!out || !out.size) return resolve(blob);
          resolve(out.size < blob.size ? out : blob);
        };
        cv.toBlob(function (o) {
          if (o && o.type === 'image/webp') return done(o);
          cv.toBlob(function (o2) { done(o2); }, 'image/jpeg', quality);
        }, 'image/webp', quality);
      }).catch(function () { resolve(blob); });
    });
  }

  function blobToDataURL(b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('读取失败')); };
      fr.readAsDataURL(b);
    });
  }

  function startExport() {
    if (!S.ready) return;
    var urls = [], seen = {};
    for (var i = 0; i < S.allImgs.length; i++) {
      var u = S.allImgs[i].url;
      if (!seen[u] && !/^data:/.test(u)) { seen[u] = 1; urls.push(u); }
    }
    // 表情图片一并内嵌（体积很小，保证离线完整）
    if (expOpts.mode !== 'link') {
      for (var mi = 0; mi < S.msgs.length; mi++) {
        var pp = S.msgs[mi].parts || [];
        for (var pj = 0; pj < pp.length; pj++) {
          if (pp[pj][0] === 'e' && pp[pj][2]) {
            var eu = emoteSrc(pp[pj][2]);
            if (eu && !seen[eu]) { seen[eu] = 1; urls.push(eu); }
          }
        }
      }
    }

    var bar = $('expBar'), fill = $('expFill'), pct = $('expPct'), lab = $('expLabel'), log = $('expLog');
    bar.classList.add('on');
    $('expGo').disabled = true;
    $('expCancel').textContent = '后台运行';

    var imgMap = {};
    var done = 0, fail = 0, failList = [];
    var total = urls.length;
    var t0 = Date.now();

    function tick() {
      var p = total ? Math.round(done / total * 100) : 100;
      fill.style.width = p + '%';
      pct.textContent = p + '%';
      lab.textContent = '下载并处理图片 ' + done + ' / ' + total + (fail ? '（失败 ' + fail + '）' : '');
    }
    tick();

    var CONC = expOpts.mode === 'link' ? 1 : 6;

    function one(url) {
      if (expOpts.mode === 'link') { done++; return Promise.resolve(); }
      var smart = expOpts.mode === 'smart';
      var dl = smart ? (cdnScale(url, expOpts.maxSide) || url) : url;
      var fromCdn = dl !== url;
      return fetchBlobRetry(dl, 3).catch(function () {
        if (!fromCdn) throw new Error('下载失败');
        fromCdn = false;                       // CDN 不支持则回退原图
        return fetchBlobRetry(url, 2);
      }).then(function (blob) {
        if (expOpts.mode === 'raw' || fromCdn) return blob;
        return renderWebpBlob(blob, expOpts.maxSide, 0.82);
      }).then(blobToDataURL).then(function (d) { imgMap[url] = d; }).catch(function (e) {
        fail++;
        if (failList.length < 40) failList.push(url.split('/').pop() + ' — ' + (e && e.message || e));
        if (log) log.innerHTML = failList.map(function (x) { return '· ' + esc(x); }).join('<br>');
      }).then(function () { done++; if (done % 4 === 0 || done === total) tick(); });
    }

    var idx = 0;
    function worker() {
      if (idx >= urls.length) return Promise.resolve();
      var u = urls[idx++];
      return one(u).then(worker);
    }
    var pool = [];
    for (var w = 0; w < CONC; w++) pool.push(worker());

    lab.textContent = '正在处理…';

    Promise.all(pool).then(function () {
      tick();
      fill.style.width = '100%';
      pct.textContent = '100%';
      lab.textContent = '正在生成文件…';
      return new Promise(function (r) { setTimeout(r, 30); });
    }).then(function () {
      var html = buildExportHTML(imgMap);
      var blob = new Blob(['\ufeff', html], { type: 'text/html;charset=utf-8' });
      var name = (S.title || 'chat').replace(/\.[^.]+$/, '') + '-离线版.html';
      downloadBlob(blob, name);
      var sec = ((Date.now() - t0) / 1000).toFixed(1);
      lab.textContent = '完成 · ' + humanSize(blob.size) + ' · 耗时 ' + sec + 's' + (fail ? ' · 失败 ' + fail + ' 张（已保留链接）' : '');
      $('expGo').disabled = false;
      $('expCancel').textContent = '关闭';
      toast('已导出：' + name + '（' + humanSize(blob.size) + '）', 5000);
      S.lastExport = { imgs: imgMap };
    }).catch(function (e) {
      lab.textContent = '导出失败：' + (e && e.message || e);
      $('expGo').disabled = false;
      $('expCancel').textContent = '关闭';
      toast('导出失败：' + (e && e.message || e), 5000, true);
    });
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    var u = URL.createObjectURL(blob);
    a.href = u; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  }

  function jsonForScript(o) {
    return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  // 导出副本里表情仍保留字典键，实际图片由 payload.imgs 统一提供，避免重复内联
  function exportEmoteDict() {
    var d = {};
    for (var i = 0; i < S.msgs.length; i++) {
      var pp = S.msgs[i].parts || [];
      for (var j = 0; j < pp.length; j++) {
        if (pp[j][0] === 'e' && pp[j][2] && DICT[pp[j][2]]) d[pp[j][2]] = DICT[pp[j][2]];
      }
    }
    return d;
  }

  function buildExportHTML(imgMap) {
    var styleEl = $('appstyle');
    var css = styleEl ? styleEl.textContent : '';
    var engineEl = $('engine');
    var engine = engineEl ? engineEl.textContent : '';

    var msgs = [];
    for (var i = 0; i < S.msgs.length; i++) {
      var m = S.msgs[i];
      msgs.push({
        t: m.t, u: m.u, p: m.parts,
        s: m.sys ? 1 : 0, st: m.sysText || null, sc: m.sysColor || null
      });
    }

    var payload = {
      v: 1,
      dict: exportEmoteDict(),
      meta: {
        title: S.title, gen: fmtFull(Date.now()), count: msgs.length,
        imgs: S.imgCount, emote: S.emoteCount, bytes: S.bytes,
        users: S.users.map(function (u) { return { id: u, name: nameOf(u), avatar: avatarOf(u) }; })
      },
      imgs: imgMap,
      msgs: msgs
    };

    var title = (S.title || '聊天记录').replace(/\.[^.]+$/, '') + ' · 离线版';

    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN" data-theme="' + (document.documentElement.dataset.theme || 'light') + '">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
      '<meta name="referrer" content="no-referrer">',
      '<meta name="color-scheme" content="light dark">',
      '<title>' + esc(title) + '</title>',
      '<style id="appstyle">' + css + '</style>',
      '</head>',
      '<body>',
      '<section id="app" class="app">',
      '  <header class="topbar">',
      '    <div class="tb-title"><span class="dot"></span><span class="tb-name" id="fileName"></span><span class="tb-count" id="fileMeta"></span></div>',
      '    <div class="searchwrap">',
      '      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
      '      <input id="search" type="search" placeholder="搜索消息内容…" autocomplete="off" spellcheck="false">',
      '      <div class="searchnav"><b id="searchCount"></b>',
      '        <button class="sbtn" id="prevHit" title="上一个"><svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></button>',
      '        <button class="sbtn" id="nextHit" title="下一个"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>',
      '      </div>',
      '    </div>',
      '    <select class="datesel" id="dateSel" title="跳转到日期"></select>',
      '    <div class="tb-act">',
      '      <button class="iconbtn" id="flipBtn" title="交换左右位置（主宾互换）"><svg viewBox="0 0 24 24"><path d="M4 8h13"/><path d="M14 5l3 3-3 3"/><path d="M20 16H7"/><path d="M10 13l-3 3 3 3"/></svg></button>',
      '      <button class="iconbtn" id="statsBtn" title="会话信息"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg></button>',
      '      <button class="iconbtn" id="themeBtn" title="切换主题"><svg id="themeIcon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg></button>',
      '    </div>',
      '  </header>',
      '  <div class="streamwrap">',
      '    <div class="progress" id="progress"><i></i></div>',
      '    <div class="stream" id="stream"><div class="inner" id="inner"></div></div>',
      '    <div class="fabs">',
      '      <button class="fab" id="topBtn" title="回到顶部"><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg></button>',
      '      <button class="fab" id="bottomBtn" title="跳到最新"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg></button>',
      '    </div>',
      '  </div>',
      '</section>',
      '<div class="lightbox" id="lightbox" hidden>',
      '  <div class="lb-top"><span class="nm" id="lbName"></span>',
      '    <button class="lb-b" id="lbZoomOut" title="缩小"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.6-3.6"/></svg></button>',
      '    <button class="lb-b" id="lbZoomIn" title="放大"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-3.6-3.6"/></svg></button>',
      '    <button class="lb-b" id="lbReset" title="原始大小">1:1</button>',
      '    <button class="lb-b" id="lbOpen" title="新窗口打开"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></button>',
      '    <button class="lb-b" id="lbDown" title="下载"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg></button>',
      '    <button class="lb-b" id="lbClose" title="关闭"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>',
      '  </div>',
      '  <div class="stage" id="lbStage"><img id="lbImg" alt=""></div>',
      '  <button class="lb-nav prev" id="lbPrev"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>',
      '  <button class="lb-nav next" id="lbNext"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>',
      '  <div class="lb-load" id="lbStatus"></div>',
      '</div>',
      '<div class="modal" id="statsModal" hidden>',
      '  <div class="card">',
      '    <h2><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>会话信息</h2>',
      '    <div class="body"><div class="stats" id="statGrid"></div><div class="who-list" id="whoList"></div>',
      '      <div class="exp-note">本文件为离线导出副本，图片已内嵌，可脱离网络查看。' +
      '点击头像可为该用户导入本地图片（仅本次浏览生效，不会写回文件）。</div></div>',
      '    <div class="foot"><button class="btn ghost" id="statsClose">关闭</button></div>',
      '  </div>',
      '</div>',
      '<input type="file" id="avatarInput" accept="image/*" hidden>',
      '<div id="toast"></div>',
      '<script id="payload" type="application/json">' + jsonForScript(payload) + '</' + 'script>',
      '<script>window.__CHAT_EXPORT__=JSON.parse(document.getElementById("payload").textContent);</' + 'script>',
      '<script id="engine">' + engine.replace(/<\/script>/gi, '<\\/script>') + '</' + 'script>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  /* --------------------------------------------------------------- Toast */
  var toastTimer = null;
  function toast(msg, ms, isErr) {
    var t = $('toast');
    if (!t) return;
    t.innerHTML = '<div' + (isErr ? ' class="err"' : '') + '>' + esc(msg) + '</div>';
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2600);
  }

  /* --------------------------------------------------------------- 主题 */
  function setTheme(th) {
    document.documentElement.dataset.theme = th;
    try { localStorage.setItem('chatview.theme', th); } catch (e) { }
    var ic = $('themeIcon');
    if (ic) {
      ic.innerHTML = th === 'dark'
        ? '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'
        : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
    }
  }

  /* ------------------------------------------------------- 参与者档案管理面板 */
  var pfQuery = '';

  // 当前会话的参与者 + 本机所有已保存档案的 uid
  function allProfileUids() {
    var seen = {}, list = [];
    for (var i = 0; i < S.users.length; i++) {
      if (!seen[S.users[i]]) { seen[S.users[i]] = 1; list.push(S.users[i]); }
    }
    for (var k in S.profiles) if (!seen[k]) { seen[k] = 1; list.push(k); }
    return list;
  }

  function openProfiles() {
    var m = $('profileModal');
    if (!m) return;
    pfQuery = '';
    var s = $('pfSearch');
    if (s) s.value = '';
    renderProfileManager();
    m.hidden = false;
  }

  function renderProfileManager() {
    var box = $('pfList');
    if (!box) return;
    var uids = allProfileUids();
    var q = (pfQuery || '').toLowerCase();
    var rows = [], saved = 0;
    for (var i = 0; i < uids.length; i++) {
      var uid = uids[i];
      var pr = S.profiles[uid] || null;
      var has = !!(pr && (pr.n || pr.a));
      if (has) saved++;
      var nm = (pr && pr.n) || '';
      if (q && uid.toLowerCase().indexOf(q) < 0 && nm.toLowerCase().indexOf(q) < 0) continue;
      rows.push({ uid: uid, nm: nm, av: !!(pr && pr.a), inChat: S.users.indexOf(uid) >= 0, has: has });
    }
    rows.sort(function (a, b) {
      if (a.inChat !== b.inChat) return a.inChat ? -1 : 1;
      if (a.has !== b.has) return a.has ? -1 : 1;
      return String(a.nm || a.uid).localeCompare(String(b.nm || b.uid));
    });

    var stat = $('pfStat');
    if (stat) {
      stat.innerHTML = '本机共 <b>' + saved + '</b> 条档案' +
        (rows.length !== uids.length ? '，筛选出 <b>' + rows.length + '</b> 条' : '') +
        ' · 占用 <b>' + humanSize(bytesOf(S.profiles)) + '</b>';
    }

    if (!rows.length) {
      box.innerHTML = '<div class="pf-empty">' +
        (uids.length ? '没有匹配的档案' : '还没有任何档案<br>导入聊天记录后，点头像即可创建') + '</div>';
      return;
    }

    var h = '';
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var tags = '';
      if (r.inChat) tags += '<span class="pf-tag">本次会话 · ' + countOf(r.uid).toLocaleString() + ' 条</span>';
      else tags += '<span class="pf-tag off">其他会话</span>';
      if (r.av) tags += '<span class="pf-tag img">自定义头像</span>';
      if (!r.has) tags += '<span class="pf-tag off">未设置</span>';
      h += '<div class="who-row pf-row">' +
        '<div class="av" data-uid="' + esc(r.uid) + '" title="点击更换头像"></div>' +
        '<div class="pf-meta">' +
          '<input data-uid="' + esc(r.uid) + '" value="' + esc(r.nm) + '" placeholder="' + esc(r.uid) + '">' +
          '<div class="pf-uid">' + esc(r.uid) + tags + '</div>' +
        '</div>' +
        (r.has ? '<button class="mini danger" data-act="del" data-uid="' + esc(r.uid) + '">删除</button>' : '') +
        '</div>';
    }
    box.innerHTML = h;

    var avs = box.querySelectorAll('.av');
    for (var a = 0; a < avs.length; a++) fillAvatar(avs[a], avs[a].dataset.uid);
    var inputs = box.querySelectorAll('input');
    for (var x = 0; x < inputs.length; x++) {
      inputs[x].onchange = function () {
        setName(this.dataset.uid, this.value);
        renderProfileManager();
      };
      inputs[x].onkeydown = function (ev) {
        if (ev.key === 'Enter') this.blur();
      };
    }
  }

  function bytesOf(o) {
    try { return JSON.stringify(o).length; } catch (e) { return 0; }
  }

  function deleteProfile(uid) {
    var pr = S.profiles[uid];
    if (!pr || (!pr.n && !pr.a)) { toast('该用户还没有档案'); return; }
    var nm = nameOf(uid);
    if (!confirm('删除「' + nm + '」保存的昵称与头像？\n\n此操作不可撤销。')) return;
    delete S.profiles[uid];
    saveProfiles();
    repaint();
    toast('已删除该档案');
  }

  function clearProfiles() {
    var n = 0;
    for (var k in S.profiles) if (S.profiles[k] && (S.profiles[k].n || S.profiles[k].a)) n++;
    if (!n) { toast('还没有任何档案可以清空'); return; }
    if (!confirm('清空全部 ' + n + ' 条档案？\n\n所有自定义昵称与头像都会恢复默认，此操作不可撤销。建议先「导出档案」备份。')) return;
    S.profiles = {};
    saveProfiles();
    repaint();
    renderProfileManager();
    toast('已清空全部档案');
  }

  function exportProfiles() {
    var n = 0;
    for (var k in S.profiles) if (S.profiles[k] && (S.profiles[k].n || S.profiles[k].a)) n++;
    if (!n) { toast('还没有任何档案可以导出'); return; }
    var data = { v: 1, kind: 'chatview-profiles', exportedAt: fmtFull(Date.now()), profiles: S.profiles };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, '参与者档案-' + fmtDate(Date.now()) + '.json');
    toast('已导出 ' + n + ' 条档案（' + humanSize(blob.size) + '）', 3600);
  }

  function importProfilesFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('档案文件过大（超过 8 MB）', 3400, true); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var added = 0, merged = 0;
      try {
        var o = JSON.parse(fr.result);
        var src = (o && o.profiles) ? o.profiles : o;      // 兼容直接给 map 的情况
        if (!src || typeof src !== 'object') throw new Error('bad');
        for (var k in src) {
          var v = src[k];
          if (!v || typeof v !== 'object') continue;
          var pr = S.profiles[k] || (S.profiles[k] = {});
          var isNew = !pr.n && !pr.a;
          if (typeof v.n === 'string' && v.n) pr.n = v.n;
          if (typeof v.a === 'string' && /^data:image\//.test(v.a)) pr.a = v.a;
          if (!pr.n && !pr.a) { delete S.profiles[k]; continue; }
          if (isNew) added++; else merged++;
        }
      } catch (err) {
        toast('导入失败：文件格式不正确', 3600, true);
        return;
      }
      saveProfiles();
      repaint();
      renderProfileManager();
      toast('导入完成：新增 ' + added + ' 条' + (merged ? '，更新 ' + merged + ' 条' : ''));
    };
    fr.onerror = function () { toast('读取文件失败', 3200, true); };
    fr.readAsText(file, 'UTF-8');
  }

  /* --------------------------------------------------------------- 载入 */
  function loadChat(fileName, text) {
    var t0 = performance.now();
    var r = parseChat(text);
    S.file = fileName; S.title = fileName;
    S.msgs = r.msgs; S.users = r.users;
    S.imgCount = r.imgCount; S.emoteCount = r.emoteCount; S.bytes = r.bytes;
    S.ready = true; S.q = ''; S.hits = []; S.hitIdx = -1; S.hitSet = {};
    _cntCache = null;
    loadProfiles();
    migrateLegacyNames(fileName);
    collectImages();
    buildPlain();
    var t1 = performance.now();

    $('landing').hidden = true;
    $('app').hidden = false;
    $('fileName').textContent = fileName;
    var dt = S.msgs.length ? (S.msgs[S.msgs.length - 1].t - S.msgs[0].t) : 0;
    $('fileMeta').textContent = S.msgs.length.toLocaleString() + ' 条 · ' + S.imgCount.toLocaleString() +
      ' 张图 · ' + fmtDate(S.msgs[0].t) + ' → ' + fmtDate(S.msgs[S.msgs.length - 1].t);

    buildDateSel();
    resetWindow(0, false);
    stream.scrollTop = 0;
    $('search').value = '';
    updateSearchUI();
    toast('已载入 ' + S.msgs.length.toLocaleString() + ' 条消息（解析 ' + (t1 - t0).toFixed(0) + ' ms）');
  }

  // 兼容早期版本按文件名保存的昵称，迁移到按 uid 绑定的档案里
  function migrateLegacyNames(file) {
    try {
      var raw = localStorage.getItem('chatview.names:' + file);
      if (!raw) return;
      var o = JSON.parse(raw) || {};
      for (var k in o) {
        var pr = S.profiles[k] || (S.profiles[k] = {});
        if (!pr.n) pr.n = o[k];
      }
    } catch (e) { }
  }

  function buildDateSel() {
    var sel = $('dateSel');
    if (!sel) return;
    var days = [], last = null;
    for (var i = 0; i < S.msgs.length; i++) {
      if (S.msgs[i].d !== last) { days.push({ d: S.msgs[i].d, i: i }); last = S.msgs[i].d; }
    }
    var html = '<option value="">跳转到日期</option>';
    for (var j = 0; j < days.length; j++) {
      html += '<option value="' + days[j].i + '">' + days[j].d + '</option>';
    }
    sel.innerHTML = html;
    sel.onchange = function () {
      if (sel.value === '') return;
      scrollToIdx(+sel.value, false);
      sel.value = '';
    };
  }

  /* ---------------------------------------------------- 档案写入与头像导入 */
  var pendingAvatarUid = null;

  function pickAvatar(uid) {
    pendingAvatarUid = uid;
    var fi = $('avatarInput');
    if (!fi) { toast('当前环境不支持选择本地图片', 3000, true); return; }
    fi.value = '';
    fi.click();
  }

  function readAvatarFile(file) {
    var uid = pendingAvatarUid;
    pendingAvatarUid = null;
    if (!file || !uid) return;
    if (!/^image\//.test(file.type || '')) { toast('请选择图片文件', 2600, true); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var SZ = 192;
        var w = img.naturalWidth || 1, h = img.naturalHeight || 1;
        var sc = Math.min(1, SZ / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * sc));
        cv.height = Math.max(1, Math.round(h * sc));
        try { cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); } catch (e) { }
        var out = null;
        try { out = cv.toDataURL('image/webp', 0.86); } catch (e) { }
        if (!out || out.indexOf('data:image/webp') !== 0) {
          try { out = cv.toDataURL('image/jpeg', 0.86); } catch (e2) { out = null; }
        }
        setAvatar(uid, out || fr.result);
      };
      img.onerror = function () { toast('这张图片无法读取', 2800, true); };
      img.src = fr.result;
    };
    fr.onerror = function () { toast('头像读取失败', 2800, true); };
    fr.readAsDataURL(file);
  }

  function setAvatar(uid, url) {
    var pr = S.profiles[uid] || (S.profiles[uid] = {});
    if (url) pr.a = url; else delete pr.a;
    if (!pr.n && !pr.a) delete S.profiles[uid];
    saveProfiles();
    repaint();
    toast(url ? '头像已更新' : '已恢复默认头像');
  }

  function setName(uid, name) {
    var pr = S.profiles[uid] || (S.profiles[uid] = {});
    var v = String(name == null ? '' : name).trim();
    if (!v || v === uid) delete pr.n; else pr.n = v;
    if (!pr.n && !pr.a) delete S.profiles[uid];
    saveProfiles();
    refreshWindow();
  }

  function resetProfile(uid) {
    delete S.profiles[uid];
    saveProfiles();
    repaint();
    toast('已恢复默认昵称与头像');
  }

  // 重绘当前窗口 + 已打开的信息面板
  function repaint() {
    refreshWindow();
    var m = $('statsModal');
    if (m && !m.hidden) renderProfiles();
    var pm = $('profileModal');
    if (pm && !pm.hidden) renderProfileManager();
  }

  function toggleFlip() {
    S.flip = !S.flip;
    var b = $('flipBtn');
    if (b) b.classList.toggle('on', S.flip);
    refreshWindow();
    toast(S.flip ? '已交换左右位置' : '已恢复默认位置');
  }

  /* ------------------------------------------------------------- 统计面板 */
  function showStats() {
    var g = $('statGrid');
    if (!g) return;
    var daySet = {}, imgMsgs = 0;
    for (var i = 0; i < S.msgs.length; i++) {
      daySet[S.msgs[i].d] = 1;
      if (S.msgs[i].parts && S.msgs[i].parts.some(function (p) { return p[0] === 'i'; })) imgMsgs++;
    }
    var span = S.msgs.length ? S.msgs[S.msgs.length - 1].t - S.msgs[0].t : 0;
    var spanTxt = Math.floor(span / 86400000) + ' 天';
    var cells = [
      ['消息总数', S.msgs.length.toLocaleString(), ''],
      ['参与人数', S.users.length, ''],
      ['跨越天数', Object.keys(daySet).length, ''],
      ['时间跨度', spanTxt, ''],
      ['图片总数', S.imgCount.toLocaleString(), ''],
      ['含图消息', imgMsgs.toLocaleString(), ''],
      ['表情总数', S.emoteCount.toLocaleString(), ''],
      ['源文件', humanSize(S.bytes), '']
    ];
    var h = '';
    for (var c = 0; c < cells.length; c++) {
      h += '<div class="stat"><div class="k">' + cells[c][0] + '</div><div class="v">' + cells[c][1] + '</div></div>';
    }
    g.innerHTML = h;

    renderProfiles();
    $('statsModal').hidden = false;
  }

  var _cntCache = null;
  function countOf(uid) {
    if (!_cntCache) {
      _cntCache = {};
      for (var i = 0; i < S.msgs.length; i++) _cntCache[S.msgs[i].u] = (_cntCache[S.msgs[i].u] || 0) + 1;
    }
    return _cntCache[uid] || 0;
  }

  function renderProfiles() {
    var wl = $('whoList');
    if (!wl) return;
    var h = '';
    for (var u = 0; u < S.users.length; u++) {
      var uid = S.users[u];
      h += '<div class="who-row">' +
        '<div class="av" data-uid="' + esc(uid) + '" title="点击更换头像"></div>' +
        '<input data-uid="' + esc(uid) + '" value="' + esc(nameOf(uid)) + '" placeholder="' + esc(uid) + '">' +
        '<button class="mini" data-act="reset" data-uid="' + esc(uid) + '" title="恢复默认昵称与头像">重置</button>' +
        '<span class="cnt">' + countOf(uid).toLocaleString() + ' 条</span></div>';
    }
    wl.innerHTML = h;
    var avs = wl.querySelectorAll('.av');
    for (var a = 0; a < avs.length; a++) fillAvatar(avs[a], avs[a].dataset.uid);
    var inputs = wl.querySelectorAll('input');
    for (var x = 0; x < inputs.length; x++) {
      inputs[x].onchange = function () {
        setName(this.dataset.uid, this.value);
        toast('昵称已保存');
      };
    }
  }

  /* ------------------------------------------------------------- 粘贴/文件 */
  var DEMO_TEXT = null;

  function readFile(file) {
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) {
      toast('文件较大（' + humanSize(file.size) + '），解析可能需要一点时间…', 3000);
    }
    var fr = new FileReader();
    fr.onload = function () {
      try { loadChat(file.name, fr.result); }
      catch (e) { toast('解析失败：' + (e && e.message || e), 4000, true); }
    };
    fr.onerror = function () { toast('文件读取失败', 3000, true); };
    fr.readAsText(file, 'UTF-8');
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    readFile(files[0]);
  }

  /* --------------------------------------------------------------- 绑定 */
  function boot() {
    // 导出副本里数据脚本可能后于引擎加载，这里再取一次
    EXPORT = window.__CHAT_EXPORT__ || null;
    isExport = !!EXPORT;
    stream = $('stream'); inner = $('inner');
    if (!stream || !inner) return;

    // 主题
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('chatview.theme'); } catch (e) { }
    if (!savedTheme) {
      savedTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    setTheme(savedTheme);

    var tb = $('themeBtn'); if (tb) tb.onclick = function () {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    };

    // 搜索
    var se = $('search');
    if (se) {
      var timer = null;
      se.addEventListener('input', function () {
        clearTimeout(timer);
        var v = se.value;
        timer = setTimeout(function () { doSearch(v); }, 220);
      });
      se.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (S.q) gotoHit(S.hitIdx + (e.shiftKey ? -1 : 1)); }
        if (e.key === 'Escape') { se.value = ''; doSearch(''); se.blur(); }
      });
    }
    var pb = $('prevHit'); if (pb) pb.onclick = function () { gotoHit(S.hitIdx - 1); };
    var nb = $('nextHit'); if (nb) nb.onclick = function () { gotoHit(S.hitIdx + 1); };

    // 滚动哨兵
    topS = document.createElement('div');
    botS = document.createElement('div');
    topS.style.cssText = 'height:1px';
    botS.style.cssText = 'height:1px';
    inner.parentNode.insertBefore(topS, inner);
    inner.parentNode.appendChild(botS);

    if (window.IntersectionObserver) {
      var ioTop = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) extendTop();
      }, { root: stream, rootMargin: '600px 0px 0px 0px' });
      ioTop.observe(topS);
      var ioBot = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) extendBottom();
      }, { root: stream, rootMargin: '0px 0px 900px 0px' });
      ioBot.observe(botS);
    }

    // 滚动兜底：IO 在超大页面/图片解码期间可能不及时，补一层 scroll 监听
    // 用 setTimeout 节流（rAF 在长时间高负载后会被浏览器节流甚至暂停）
    var scrollTimer = 0;
    stream.addEventListener('scroll', function () {
      if (scrollTimer) return;
      scrollTimer = setTimeout(function () {
        scrollTimer = 0;
        try {
          if (stream.scrollTop + stream.clientHeight > stream.scrollHeight - 900) extendBottom();
          if (stream.scrollTop < 900 && S.win.start > 0) extendTop();
        } catch (err) { }
      }, 40);
    }, { passive: true });

    // 图片点击 / 加载状态（事件委托）
    inner.addEventListener('click', function (e) {
      var cl = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var av = cl('.av');
      if (av) { pickAvatar(av.dataset.uid); return; }
      var cell = cl('.cell');
      if (cell) { openLb(+cell.dataset.pos); return; }
      var who = cl('.who');
      if (who) { showStats(); }
    });
    inner.addEventListener('load', function (e) {
      var im = e.target;
      if (!im || im.tagName !== 'IMG' || im.classList.contains('emo-img')) return;
      var cell = im.closest ? im.closest('.cell') : null;
      if (!cell) return;
      im.classList.add('done');
      if (im.naturalWidth > 0 && im.naturalHeight / im.naturalWidth > 2.2) {
        cell.classList.add('tall');
        var tg = cell.querySelector('.tag');
        if (tg) tg.textContent = '长图 · 点击查看完整';
      }
    }, true);
    inner.addEventListener('error', function (e) {
      var im = e.target;
      if (!im || im.tagName !== 'IMG') return;
      if (im.classList.contains('emo-img')) {
        var key = im.dataset.e;
        if (key && B64[key] && im.dataset.fb !== '1') {
          im.dataset.fb = '1';
          im.src = B64[key];
          return;
        }
        var name = (im.getAttribute('title') || '').replace(/^\[|\]$/g, '');
        var em = emoteEmoji(name) || '💬';
        var span = document.createElement('span');
        span.className = 'emo-fallback';
        span.title = '[' + name + ']';
        span.textContent = em;
        if (im.parentNode) im.parentNode.replaceChild(span, im);
        return;
      }
      var cell = im.closest ? im.closest('.cell') : null;
      if (cell) cell.classList.add('err');
    }, true);

    // 悬浮按钮
    var tbtn = $('topBtn'); if (tbtn) tbtn.onclick = function () {
      ensureIdx(0); if (S.win.start === 0) stream.scrollTo({ top: 0, behavior: 'smooth' });
      else resetWindow(0, false);
    };
    var bbtn = $('bottomBtn'); if (bbtn) bbtn.onclick = function () {
      var n = S.msgs.length - 1; if (n < 0) return;
      resetWindow(n, false);
    };

    // 主宾互换
    var fb = $('flipBtn');
    if (fb) fb.onclick = toggleFlip;

    // 头像文件选择
    var ai = $('avatarInput');
    if (ai) ai.onchange = function () {
      var f = this.files && this.files[0];
      this.value = '';
      readAvatarFile(f);
    };

    // 信息面板里的头像点击 / 重置
    var wl = $('whoList');
    if (wl) wl.addEventListener('click', function (e) {
      var cl = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var av = cl('.av');
      if (av) { pickAvatar(av.dataset.uid); return; }
      var btn = cl('button[data-act="reset"]');
      if (btn) resetProfile(btn.dataset.uid);
    });

    // 参与者档案管理
    var prb = $('profilesBtn');
    if (prb) prb.onclick = openProfiles;
    var pfm = $('profileModal');
    if (pfm) pfm.onclick = function (e) { if (e.target === pfm) pfm.hidden = true; };
    var pfc = $('pfClose'); if (pfc) pfc.onclick = function () { pfm && (pfm.hidden = true); };
    var pfe = $('pfExport'); if (pfe) pfe.onclick = exportProfiles;
    var pfd = $('pfClear'); if (pfd) pfd.onclick = clearProfiles;
    var pfin = $('profileInput');
    var pfi = $('pfImport');
    if (pfi && pfin) {
      pfi.onclick = function () { pfin.value = ''; pfin.click(); };
      pfin.onchange = function () { var f = this.files && this.files[0]; this.value = ''; importProfilesFile(f); };
    }
    var pfs = $('pfSearch');
    if (pfs) pfs.addEventListener('input', function () { pfQuery = pfs.value.trim(); renderProfileManager(); });
    var pfl = $('pfList');
    if (pfl) pfl.addEventListener('click', function (e) {
      var cl = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var av = cl('.av');
      if (av) { pickAvatar(av.dataset.uid); return; }
      var btn = cl('button[data-act="del"]');
      if (btn) deleteProfile(btn.dataset.uid);
    });

    // 统计 / 关闭
    var sb = $('statsBtn'); if (sb) sb.onclick = showStats;
    var sc = $('statsClose'); if (sc) sc.onclick = function () { $('statsModal').hidden = true; };
    var sm = $('statsModal'); if (sm) sm.onclick = function (e) { if (e.target === sm) sm.hidden = true; };

    var cb = $('closeBtn');
    if (cb) cb.onclick = function () {
      if (!confirm('重新导入会清空当前会话，确定吗？')) return;
      S.ready = false; S.msgs = []; inner.textContent = '';
      $('app').hidden = true; $('landing').hidden = false;
    };

    /* ---------------- 灯箱 ---------------- */
    var lbEl = $('lightbox');
    if (lbEl) {
      var st = $('lbStage');
      st.addEventListener('click', function (e) { if (e.target === st) closeLb(); });
      $('lbClose').onclick = closeLb;
      $('lbPrev').onclick = function (e) { e.stopPropagation(); lbStep(-1); };
      $('lbNext').onclick = function (e) { e.stopPropagation(); lbStep(1); };
      $('lbZoomIn').onclick = function () { lb.scale = Math.min(8, lb.scale * 1.35); applyLb(); };
      $('lbZoomOut').onclick = function () { lb.scale = Math.max(0.15, lb.scale / 1.35); applyLb(); };
      $('lbReset').onclick = function () { lb.scale = 1; lb.x = 0; lb.y = 0; applyLb(); };
      $('lbOpen').onclick = function () {
        var it = S.allImgs[lb.i]; if (!it) return;
        var u = imgSrc(it.url);
        if (/^data:/.test(u)) {
          var w = window.open('', '_blank');
          if (w) w.document.write('<title>图片</title><body style="margin:0;background:#111;display:grid;place-items:center;height:100vh"><img src="' + u + '" style="max-width:100%;max-height:100%"></body>');
        } else window.open(u, '_blank');
      };
      $('lbDown').onclick = function () {
        var it = S.allImgs[lb.i]; if (!it) return;
        var u = imgSrc(it.url);
        var nm = (it.url.split('/').pop() || 'image').split('?')[0];
        if (/^data:/.test(u)) {
          var a = document.createElement('a');
          a.href = u; a.download = nm;
          document.body.appendChild(a); a.click(); a.remove();
        } else {
          fetchBlob(it.url).then(function (b) { downloadBlob(b, nm); }).catch(function () { window.open(it.url, '_blank'); });
        }
      };
      st.addEventListener('wheel', function (e) {
        e.preventDefault();
        var f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        lb.scale = Math.max(0.15, Math.min(8, lb.scale * f));
        applyLb();
      }, { passive: false });
      var dragFrom = null;
      st.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        lb.drag = true; dragFrom = { x: e.clientX - lb.x, y: e.clientY - lb.y };
        st.classList.add('grabbing');
        st.setPointerCapture(e.pointerId);
      });
      st.addEventListener('pointermove', function (e) {
        if (!lb.drag || !dragFrom) return;
        lb.x = e.clientX - dragFrom.x; lb.y = e.clientY - dragFrom.y;
        applyLb();
      });
      st.addEventListener('pointerup', function (e) {
        lb.drag = false; dragFrom = null; st.classList.remove('grabbing');
        try { st.releasePointerCapture(e.pointerId); } catch (er) { }
      });
      st.addEventListener('dblclick', function () {
        if (lb.scale === 1) { lb.scale = 2.2; }
        else { lb.scale = 1; lb.x = 0; lb.y = 0; }
        applyLb();
      });
    }

    /* ---------------- 导入入口（仅主页面） ---------------- */
    var drop = $('drop');
    if (drop) {
      var pick = $('pickBtn'), fi = $('fileInput');
      if (pick && fi) {
        pick.onclick = function (e) { e.stopPropagation(); fi.click(); };
        fi.onchange = function () { handleFiles(fi.files); fi.value = ''; };
      }
      drop.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('button')) return;
        if (fi) fi.click();
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('hot'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return; drop.classList.remove('hot'); });
      });
      drop.addEventListener('drop', function (e) {
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) handleFiles(dt.files);
      });
      // 全局拖放
      ['dragover', 'drop'].forEach(function (ev) {
        window.addEventListener(ev, function (e) { e.preventDefault(); }, false);
      });
      window.addEventListener('drop', function (e) {
        if ($('landing').hidden) return;   // 已进入会话视图，忽略全局拖放
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      });

      var pb2 = $('pasteBtn');
      if (pb2) pb2.onclick = function () {
        if (!navigator.clipboard || !navigator.clipboard.readText) { toast('当前环境不支持读取剪贴板，请直接拖入文件', 3200, true); return; }
        navigator.clipboard.readText().then(function (t) {
          if (!t || !t.trim()) { toast('剪贴板是空的', 2400, true); return; }
          loadChat('剪贴板记录.txt', t);
        }).catch(function () { toast('读取剪贴板被拒绝，请直接拖入文件', 3200, true); });
      };
      window.addEventListener('paste', function (e) {
        if ($('landing').hidden) return;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') { readFile(items[i].getAsFile()); return; }
          if (items[i].type === 'text/plain') {
            items[i].getAsString(function (s) { if (s && /说[：:]/.test(s)) loadChat('剪贴板记录.txt', s); });
            return;
          }
        }
      });
    }

    /* ---------------- 导出入口 ---------------- */
    var eb = $('exportBtn');
    if (eb) eb.onclick = function () {
      if (!S.ready) return;
      $('exportModal').hidden = false;
      $('expBar').classList.remove('on');
      $('expFill').style.width = '0%';
      $('expPct').textContent = '0%';
      $('expLabel').textContent = '准备中…';
      $('expLog').innerHTML = '';
      $('expGo').disabled = false;
      $('expCancel').textContent = '取消';
      estimateExport();
    };
    var ec = $('expCancel');
    if (ec) ec.onclick = function () { $('exportModal').hidden = true; };
    var em = $('exportModal');
    if (em) em.onclick = function (e) { if (e.target === em && !$('expGo').disabled) em.hidden = true; };
    var eg = $('expGo');
    if (eg) eg.onclick = function () {
      if (!S.msgs.length) { toast('没有可导出的内容', 2600, true); return; }
      startExport();
    };
    var seg = $('modeSeg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        var btns = seg.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove('on');
        b.classList.add('on');
        expOpts.mode = b.dataset.v;
        if ($('sizeOpt')) $('sizeOpt').style.display = expOpts.mode === 'smart' ? '' : 'none';
        estimateExport();
      });
    }
    var ms = $('maxSide');
    if (ms) ms.oninput = function () {
      expOpts.maxSide = +ms.value;
      $('maxSideVal').textContent = ms.value + ' px';
      estimateExport();
    };

    /* ---------------- 快捷键 ---------------- */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('lightbox').hidden) return closeLb();
        var mods = ['exportModal', 'statsModal', 'profileModal'];
        for (var i = 0; i < mods.length; i++) { var el = $(mods[i]); if (el && !el.hidden) el.hidden = true; }
        return;
      }
      if (!$('lightbox').hidden) {
        if (e.key === 'ArrowLeft') lbStep(-1);
        if (e.key === 'ArrowRight') lbStep(1);
        if (e.key === '0') { lb.scale = 1; lb.x = 0; lb.y = 0; applyLb(); }
        return;
      }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); if ($('search')) $('search').focus(); }
    });

    /* ---------------- 启动数据 ---------------- */
    if (isExport && EXPORT.msgs) {
      hydrateExport(EXPORT);
    }
  }

  function hydrateExport(p) {
    var meta = p.meta || {};
    S.file = meta.title || '聊天记录';
    S.title = meta.title || '聊天记录';
    S.noPersist = true;          // 离线副本只读，不污染本机保存的档案
    S.profiles = {};
    _cntCache = null;
    S.users = (meta.users || []).map(function (u) { return u.id; });
    (meta.users || []).forEach(function (u) {
      var pr = {};
      if (u.name && u.name !== u.id) pr.n = u.name;
      if (u.avatar) pr.a = u.avatar;
      if (pr.n || pr.a) S.profiles[u.id] = pr;
    });
    S.bytes = meta.bytes || 0;
    S.msgs = (p.msgs || []).map(function (m) {
      return {
        t: m.t, u: m.u, d: fmtDate(m.t), sys: !!m.s,
        sysText: m.st, sysColor: m.sc,
        parts: m.p || [], raw: ''
      };
    });
    S.imgCount = meta.imgs || 0;
    S.emoteCount = meta.emote || 0;
    S.ready = true;
    collectImages();
    buildPlain();
    if ($('fileName')) $('fileName').textContent = S.file;
    if ($('fileMeta')) {
      $('fileMeta').textContent = S.msgs.length.toLocaleString() + ' 条 · ' +
        (S.imgCount || 0).toLocaleString() + ' 张图 · 离线副本' +
        (meta.gen ? ' · ' + meta.gen : '');
    }
    buildDateSel();
    resetWindow(0, false);
    stream.scrollTop = 0;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__CHAT__ = { parseChat: parseChat, S: S, loadChat: loadChat };
})();
