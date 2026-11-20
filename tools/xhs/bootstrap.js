/* 甲方要圆 · 小红书小工具版的启动脚本（tools/build-xhs.mjs 打包时放到包根目录，index.html 只引用这一个脚本）
   规则见 ~/.claude/skills/minitool-zip-builder 和小工具在线文档（https://miniapp-sandbox.xiaohongshu.com/minitool/doc）

   1. 标记平台（游戏里 XHS 为真：不联网、固定中文、没有背景音乐），补 Chrome 61 缺的 Array flat / flatMap
   2. 存档：容器 Storage（客户端 9.46+）里只存一条 "yuan"，内容是游戏原来写进 localStorage 的那些键值。
      启动时读进内存；游戏代码里的 localStorage 在打包时换成这里的 __yuanStore（同步读写内存），写入后合并、稍等一下再写回容器。
      - 版本未知、没有 SDK、方法缺失：只放内存，不写，也不回退浏览器存储（文档明确不许）
      - 读失败 / 解析失败：只放内存、不写，免得拿空数据把原来的存档盖掉
      - 明确低于 9.46：走兼容路径，用浏览器 localStorage（读写都包 try）
   3. 窗口信息（9.49+）：整个游戏放到顶部胶囊 / 安全区下面，底部让出安全区
   4. 振动（9.50+）：vibrateShort 轻 / 中 / 重
   4b. 云存档（内测，9.51+）：同账号换手机能接着玩。启动时读云上那条，跟本机的按「每单取最好成绩」合并；之后最多一分钟写一次、切到后台时补写
   5. 按原来的顺序一个个加载游戏脚本，好了收起启动画面；失败就提示退出重进 */
(function () {
  'use strict';
  window.YUAN_PLATFORM = 'xhs';
  var BUILD = '__BUILD__';
  var SCRIPTS = __SCRIPTS__;
  var KEY = 'yuan';
  var root = document.documentElement;

  /* ---------- Chrome 61 缺的方法（游戏里只用到这两个） ---------- */
  function define(obj, name, fn) { if (!obj[name]) Object.defineProperty(obj, name, { configurable: true, writable: true, value: fn }); }
  define(Array.prototype, 'flat', function (depth) {
    var d = depth === undefined ? 1 : Math.floor(Number(depth)) || 0, out = [];
    (function walk(a, n) {
      for (var i = 0; i < a.length; i++) {
        if (!(i in a)) continue;
        if (Array.isArray(a[i]) && n > 0) walk(a[i], n - 1); else out.push(a[i]);
      }
    })(this, d);
    return out;
  });
  define(Array.prototype, 'flatMap', function (fn, self) { return Array.prototype.map.call(this, fn, self).flat(1); });

  /* ---------- 小工具：版本和方法判断（照在线文档 §3.6） ---------- */
  function miniTool() { return window.xhs && window.xhs.miniTool; }
  function hasMethods(names) {
    var m = miniTool();
    return !!m && names.every(function (n) { return typeof m[n] === 'function'; });
  }
  function readBuildVersion(launchOptions) {
    var env = launchOptions && launchOptions.miniToolEnv, value = env && env.buildVersion;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (!/^[1-9]\d{6,}$/.test(String(value))) return null;
    var v = Number(value);
    return Number.isSafeInteger(v) ? v : null;
  }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function getBuildVersion() {
    var sync = readBuildVersion(window.xhs && window.xhs.launchOptions);
    if (sync !== null) return Promise.resolve(sync);
    if (!hasMethods(['getLaunchOptions'])) return Promise.resolve(null);
    return withTimeout(miniTool().getLaunchOptions(), 3000).then(readBuildVersion, function () { return null; });
  }
  function clientOf(buildVersion) { return Number.isSafeInteger(buildVersion) && buildVersion > 0 ? Math.floor(buildVersion / 1000) : null; }

  /* ---------- 页面上的两行字：启动状态、存档提示 ---------- */
  var statusEl = document.getElementById('xhs-boot-status');
  function say(text) { if (statusEl) statusEl.textContent = text; }
  var noted = {};
  function note(key, text) {
    if (noted[key]) return; noted[key] = 1;
    var el = document.createElement('p');
    el.className = 'xhs-note'; el.setAttribute('role', 'status'); el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.className += ' gone'; }, 6000);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 6600);
  }

  /* ---------- 存档：给游戏的 localStorage 替身 ---------- */
  var mem = Object.create(null), mode = 'memory', timer = 0, writing = false, dirty = false;
  function own(k) { return Object.prototype.hasOwnProperty.call(mem, k); }
  function legacy(fn, fallback) { try { return fn(window.localStorage); } catch (e) { return fallback; } }
  var inflight = Promise.resolve();
  function flush() {
    timer = 0;
    if (mode !== 'xhs') return Promise.resolve();
    if (writing) { dirty = true; return inflight; }
    writing = true; dirty = false;
    var data;
    try { data = JSON.stringify(mem); } catch (e) { writing = false; return Promise.resolve(); }
    inflight = withTimeout(miniTool().setStorage({ key: KEY, data: data }), 8000).then(function (r) {
      writing = false;
      if (!r || r.errMsg !== 'setStorage:ok') note('save', '进度这次没存上，下次交货时会再存一次。');
      if (dirty) schedule();
    }, function () {
      writing = false;
      note('save', '进度这次没存上，下次交货时会再存一次。');
      if (dirty) schedule();
    });
    return inflight;
  }
  function schedule() { dirty = true; cloudDirty = true; if (!timer) timer = setTimeout(flush, 400); cloudSchedule(false); }
  function flushNow() { if (timer) { clearTimeout(timer); return flush(); } return writing ? inflight : Promise.resolve(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) { flushNow(); cloudSchedule(true); } });
  window.addEventListener('pagehide', function () { flushNow(); cloudSchedule(true); });

  /* ---------- 云存档（内测）：一条记录存整份键值，跟本机合并 ---------- */
  var CLOUD_COL = 'save', cloudOn = false, cloudId = '', cloudTimer = 0, cloudLast = 0, cloudBusy = false, cloudDirty = false, cloudRecheck = false;
  function parseJSON(t) { try { return JSON.parse(t); } catch (e) { return null; } }
  function mergeSave(a, b) {   // 每单取最好成绩和最多的星，无尽模式取更高的纪录
    var x = parseJSON(a) || {}, y = parseJSON(b) || {}, o = { best: {}, stars: {}, endless: { best: 0, n: 0 } };
    [x, y].forEach(function (s) {
      var best = s.best || {}, stars = s.stars || {};
      Object.keys(best).forEach(function (k) { if (+best[k] > (o.best[k] || 0)) o.best[k] = +best[k]; });
      Object.keys(stars).forEach(function (k) { var v = stars[k] | 0; if (v > (o.stars[k] || 0)) o.stars[k] = v; });
      if (s.endless && +s.endless.best > o.endless.best) o.endless = { best: +s.endless.best, n: +s.endless.n || 0 };
    });
    Object.keys(x).forEach(function (k) { if (!(k in o)) o[k] = x[k]; });
    return JSON.stringify(o);
  }
  function mergeAch(a, b) {   // 成就：拿解锁多的那份做底，另一份多出来的解锁补进去
    var x = parseJSON(a), y = parseJSON(b);
    if (!x) return b; if (!y) return a;
    var base = Object.keys(y.got || {}).length > Object.keys(x.got || {}).length ? y : x, other = base === x ? y : x;
    base.got = base.got || {};
    Object.keys(other.got || {}).forEach(function (k) { if (!(k in base.got)) base.got[k] = other.got[k]; });
    return JSON.stringify(base);
  }
  function mergeFlow(a, b) {   // 开场流程：看过 / 签过，哪边是就算是
    var x = parseJSON(a) || {}, y = parseJSON(b) || {};
    Object.keys(y).forEach(function (k) { if (y[k] && !x[k]) x[k] = y[k]; });
    return JSON.stringify(x);
  }
  function mergeAll(local, remote) {
    var out = Object.create(null);
    Object.keys(local).forEach(function (k) { out[k] = local[k]; });
    Object.keys(remote).forEach(function (k) {
      var r = remote[k];
      if (typeof r !== 'string') return;
      if (!(k in out)) { out[k] = r; return; }
      if (/^yuan\.save\./.test(k)) out[k] = mergeSave(out[k], r);
      else if (/^yuan\.ach\./.test(k)) out[k] = mergeAch(out[k], r);
      else if (k === 'yuan.flow.v1') out[k] = mergeFlow(out[k], r);
      // 其他（名字、语言之类）以这台手机为准
    });
    return out;
  }
  function cloudFail(e) { var c = e && e.errCode; if (c === 1006 || c === 10003) cloudOn = false; }   // 没授权 / 没开通：这次不再用云存档
  function cloudQuery() {
    return withTimeout(miniTool().queryCloudStorage({ collection: CLOUD_COL, limit: 5 }), 3000).then(function (r) {
      var items = (r && r.items) || [];
      items.sort(function (a, b) { return ((b.content && b.content.at) || 0) - ((a.content && a.content.at) || 0); });
      var it = items[0];
      if (it && it.id) cloudId = it.id;
      return it && it.content && it.content.data && typeof it.content.data === 'object' ? it.content.data : null;
    });
  }
  function cloudRestore() {
    if (!cloudOn || mode === 'readfail') return Promise.resolve();   // 本机都读不出来时不动，免得合并出不完整的
    return cloudQuery().then(function (data) {
      if (!data) return;
      var before = JSON.stringify(mem), merged = mergeAll(mem, data);
      if (JSON.stringify(merged) === before) return;
      mem = merged;
      if (mode === 'xhs') schedule();
    }, function (e) { cloudFail(e); });
  }
  function cloudWrite() {
    cloudTimer = 0;
    if (!cloudOn || !cloudDirty) return Promise.resolve();
    if (cloudBusy) return Promise.resolve();
    cloudBusy = true; cloudDirty = false; cloudLast = Date.now();
    var content = { v: 1, at: Date.now(), data: JSON.parse(JSON.stringify(mem)) };
    if (JSON.stringify(content).length > 60000) { cloudBusy = false; return Promise.resolve(); }   // 单条上限 64KB
    var ready = cloudRecheck && !cloudId ? cloudQuery().then(function () { cloudRecheck = false; }, function () {}) : Promise.resolve();
    return ready.then(function () {
      var m = miniTool();
      var p = cloudId
        ? m.updateCloudStorage({ collection: CLOUD_COL, items: [{ id: cloudId, content: content }] })
        : m.addCloudStorage({ collection: CLOUD_COL, items: [{ content: content }] });
      return withTimeout(p, 8000);
    }).then(function (r) {
      cloudBusy = false;
      var it = r && r.data && r.data[0];
      if (it && it.status === 'SUCCESS' && it.id) cloudId = it.id;
      else if (it && it.status === 'UNKNOWN' && !cloudId) cloudRecheck = true;   // 结果不确定：下次写之前先查一次，别重复新建
      else if (!it || it.status !== 'SUCCESS') cloudDirty = true;
      if (cloudDirty) cloudSchedule(false);
    }, function (e) { cloudBusy = false; cloudDirty = true; cloudFail(e); if (e && e.errCode === 2004) cloudRecheck = true; });
  }
  function cloudSchedule(now) {
    if (!cloudOn || !cloudDirty) return;
    if (now) { clearTimeout(cloudTimer); cloudWrite(); return; }
    if (cloudTimer) return;
    cloudTimer = setTimeout(cloudWrite, Math.max(3000, 60000 - (Date.now() - cloudLast)));   // 最多一分钟写一次
  }

  var store = {
    getItem: function (k) {
      k = String(k);
      if (mode === 'legacy') return legacy(function (s) { return s.getItem(k); }, null);
      return own(k) ? mem[k] : null;
    },
    setItem: function (k, v) {
      k = String(k); v = String(v);
      if (mode === 'legacy') { legacy(function (s) { s.setItem(k, v); }); return; }
      if (mem[k] === v) return;
      mem[k] = v; if (mode === 'xhs') schedule();
    },
    removeItem: function (k) {
      k = String(k);
      if (mode === 'legacy') { legacy(function (s) { s.removeItem(k); }); return; }
      if (!own(k)) return;
      delete mem[k]; if (mode === 'xhs') schedule();
    },
    clear: function () {
      if (mode === 'legacy') { legacy(function (s) { s.clear(); }); return; }
      mem = Object.create(null); if (mode === 'xhs') schedule();
    },
    key: function (i) { return mode === 'legacy' ? legacy(function (s) { return s.key(i); }, null) : Object.keys(mem)[i] || null; },
    get length() { return mode === 'legacy' ? legacy(function (s) { return s.length; }, 0) : Object.keys(mem).length; }
  };
  // 会话存储只放内存（游戏里只有网页版的刷新逻辑用它，小工具版没有那段）
  var session = Object.create(null);
  window.__yuanSession = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null; },
    setItem: function (k, v) { session[String(k)] = String(v); },
    removeItem: function (k) { delete session[String(k)]; },
    clear: function () { session = Object.create(null); }
  };
  window.__yuanStore = store;
  // 打包时游戏里的 fetch / sendBeacon 换成这个：小工具不能联网，万一有路径漏到这里也只是失败，不发请求
  window.__yuanNoNet = function () { return Promise.reject(new Error('offline')); };

  function prepareStorage(buildVersion) {
    var c = clientOf(buildVersion);
    cloudOn = c !== null && c >= 9510 && hasMethods(['addCloudStorage', 'updateCloudStorage', 'queryCloudStorage']);
    return prepareLocal(buildVersion).then(cloudRestore);
  }
  function prepareLocal(buildVersion) {
    var client = clientOf(buildVersion);
    if (client !== null && client < 9460) {   // 明确的旧客户端：兼容路径
      mode = 'legacy';
      if (!legacy(function (s) { s.setItem('yuan.probe', '1'); s.removeItem('yuan.probe'); return true; }, false)) {
        mode = 'memory'; note('mem', '这台手机上的小红书暂时存不了进度，这次玩的不会记下来。');
      }
      return Promise.resolve();
    }
    if (client === null || !hasMethods(['setStorage', 'getStorage', 'getStorageInfo'])) {
      mode = 'memory';
      note('mem', '这个环境存不了进度，这次玩的不会记下来。');
      return Promise.resolve();
    }
    var m = miniTool();
    return withTimeout(m.getStorageInfo(), 4000).then(function (info) {
      var keys = info && info.keys;
      if (!Array.isArray(keys)) throw new Error('bad info');
      if (keys.indexOf(KEY) < 0) { mode = 'xhs'; return; }   // 第一次玩：没有存档
      return withTimeout(m.getStorage({ key: KEY }), 4000).then(function (r) {
        var raw = r && r.data;
        if (raw === null || raw === undefined) throw new Error('missing data');
        var obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('bad data');
        Object.keys(obj).forEach(function (k) { if (typeof obj[k] === 'string') mem[k] = obj[k]; });
        mode = 'xhs';
      });
    }).catch(function () {
      // 读不出来不等于没有存档：这次只放内存、不写回，原来的存档不动
      mode = 'readfail'; mem = Object.create(null);
      note('read', '读取存档失败，这次的进度先不保存，免得覆盖原来的存档。退出重进再试试。');
    });
  }

  /* ---------- 窗口：让开顶部胶囊和安全区 ---------- */
  function applyWindowInfo(info) {
    if (!info || !info.safeArea) return;
    var mb = info.menuButtons || {};
    var visible = function (r) { return r && r.width > 0 && r.height > 0; };
    var rects = visible(mb.capsule) ? [mb.capsule] : [mb.back, mb.me, mb.share].filter(visible);
    var top = Number(info.safeArea.top) || 0;
    rects.forEach(function (r) { top = Math.max(top, Number(r.bottom) || 0); });
    var bottom = info.windowHeight && info.safeArea.bottom ? Math.max(0, info.windowHeight - info.safeArea.bottom) : 0;
    root.style.setProperty('--xhs-top', Math.max(12, top + 6) + 'px');   // 页面原来上下至少留 12px
    root.style.setProperty('--xhs-bottom', Math.max(12, bottom) + 'px');
    if (root.className.indexOf('xhs-win') < 0) root.className += ' xhs-win';
  }
  var canWindow = false, winTimer = 0;
  function measureWindow() { if (canWindow) withTimeout(miniTool().getWindowInfo(), 3000).then(applyWindowInfo, function () {}); }
  function prepareWindow(buildVersion) {
    var lo = window.xhs && window.xhs.launchOptions, env = lo && lo.miniToolEnv;
    if (env && env.windowInfo) applyWindowInfo(env.windowInfo);   // 启动快照：先用它排第一帧（胶囊可能还没排好，页面好了再量）
    var client = clientOf(buildVersion);
    canWindow = client !== null && client >= 9490 && hasMethods(['getWindowInfo']);
    measureWindow();
    window.addEventListener('resize', function () { clearTimeout(winTimer); winTimer = setTimeout(measureWindow, 200); });
  }

  /* ---------- 振动 ---------- */
  function prepareBuzz(buildVersion) {
    var client = clientOf(buildVersion), can = client !== null && client >= 9500 && hasMethods(['vibrateShort']);
    var at = function (min, names) { return client !== null && client >= min && hasMethods(names); };
    window.YUAN_XHS = {
      build: BUILD, client: client,
      get storage() { return mode; },
      get cloud() { return cloudOn; },
      rankOn: at(9510, ['submitScore', 'getRankList', 'getMyRank']),   // 排行榜（内测）；没授权时 social.js 会关掉
      can: at,
      note: function (text) { note('x' + Date.now(), text); },
      flush: function () { cloudSchedule(true); return withTimeout(flushNow(), 1500).catch(function () {}); },
      buzz: function (type) {
        if (!can) return;
        try { Promise.resolve(miniTool().vibrateShort({ type: type })).catch(function () {}); } catch (e) {}
      }
    };
  }

  /* ---------- 按顺序加载游戏脚本 ---------- */
  var failed = false;
  function fail() {
    if (failed) return; failed = true;
    say('没能打开游戏。请退出小工具后重新打开。');
    var boot = document.getElementById('xhs-boot'); if (boot) boot.setAttribute('aria-busy', 'false');
  }
  function loadScripts(list, done) {
    var i = 0;
    (function next() {
      if (failed) return;
      if (i >= list.length) { done(); return; }
      var s = document.createElement('script');
      s.src = list[i++];
      s.onload = next;
      s.onerror = fail;
      document.body.appendChild(s);
    })();
  }
  function ready() {
    if (!window.__yuan) { fail(); return; }   // 主脚本没跑起来
    var boot = document.getElementById('xhs-boot');
    if (!boot) return;
    boot.setAttribute('aria-busy', 'false');
    measureWindow();
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      boot.className += ' gone';
      setTimeout(function () { if (boot.parentNode) boot.parentNode.removeChild(boot); }, 400);
    }); });
  }

  say('正在准备第一单…如果一直没反应，请退出后重新打开。');
  getBuildVersion().then(function (bv) {
    prepareWindow(bv);
    prepareBuzz(bv);
    return prepareStorage(bv);
  }).then(function () {
    loadScripts(SCRIPTS, ready);
  }, fail);
})();
