/* 甲方要圆 · 小红书小工具版专用：晒笔记、分享、去评论区、关注作者、赞赏（内测）、无尽模式排行榜（内测）
   只有 tools/build-xhs.mjs 打的包里有这个文件，最后一个加载。游戏在几个时刻调 window.__yuanXhs(事件, 数据)（index.html 里的 XHOOK）：
     result  交货结算卡出来了      → 卡片底下加一行「晒到笔记」「分享给朋友」
     endless 无尽模式收工          → 提交成绩到排行榜；加「晒到笔记」「分享」「去评论区报成绩」「关注作者」「赞赏一下作者」
     win     冒险模式通关          → 同上（不提交成绩）
     board   点了「排行榜」        → 小红书排行榜卡片（本周 / 总榜）
   每个能力先看客户端版本和方法在不在（bootstrap.js 的 YUAN_XHS.can），不在就不显示按钮；调用失败给一句提示，不影响游戏。
   赞赏：客户端 9.53.3+ 才显示；开没开通只能在创作者平台的发布配置里看，页面查不到，所以点了失败一次就本次不再显示。
   关闭挽留（关掉小工具时客户端可能弹赞赏）只在玩家真玩进去以后才打开：这次交了 3 单、通关或无尽收工。
   能力说明见小工具在线文档 §3.3 发布笔记、§3.5 临时文件、§3.9 发布评论、§3.15 关注作者、§3.17 排行榜、§3.18 分享、§3.19 赞赏、§3.20 赞赏挽留 */
(function () {
  'use strict';
  const Y = window.__yuan, X = window.__yuanFlow, XS = window.YUAN_XHS;
  if (!Y || !X || !XS) return;
  const G = Y.G, card = document.getElementById('card');
  const mt = () => window.xhs && window.xhs.miniTool;
  const CAN = {
    note: XS.can(0, ['writeTempFile', 'postNote']),
    share: XS.can(9530, ['share']),
    comment: XS.can(9490, ['writeTempFile', 'interactionOpenApi']),
    follow: XS.can(9510, ['followAuthor', 'getFollowStatus']),
    reward: XS.can(9533, ['rewardAuthor']),
    retention: XS.can(9533, ['setCloseRetentionEnabled']),
  };
  const say = t => XS.note(t);
  const sfx = k => { try { X.sfx.ui(k); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const nameOf = id => (Y.MATS[id] && Y.MATS[id].name) || '';
  const errCode = e => e && (e.errCode !== undefined ? e.errCode : e.code);

  /* ---------- 成绩图：底图（Codex 画的，tools/xhs/share-bg.webp，打包进 res/）+ 框里放游戏画面 + 三行字，900×1200 ---------- */
  const BG = new Image(); let bgOk = false;
  BG.onload = () => { bgOk = true; }; BG.src = 'res/share-bg.webp';
  const FRAME = { x: 51, y: 90, w: 798, h: 744, r: 34 };   // 底图里圆角框的内部（量出来的）
  const bgReady = () => bgOk ? Promise.resolve() : new Promise(r => { BG.addEventListener('load', r); BG.addEventListener('error', r); setTimeout(r, 1500); });
  // 玩家在游戏里的名字和进度（小红书不给小工具读用户的小红书头像昵称，这里用游戏里起的名字，头像是名字第一个字的圆章）
  const who = () => {   // 离线版起的名字记在开场流程的存档里（yuan.flow.v1 的 name），打字起的也存在 yuan.name
    let n = String(X.NAME || '').trim();
    if (!n) try { n = String(localStorage.getItem('yuan.name') || '').trim() || String((JSON.parse(localStorage.getItem('yuan.flow.v1') || '{}') || {}).name || '').trim(); } catch (e) {}
    return n || '一位地球工匠';
  };
  function progress() {
    const ids = Y.ADV_IDS || [], S = Y.SAVE;
    return { done: ids.filter(id => S.best[id]).length, total: ids.length || 22, stars: Object.keys(S.stars).reduce((a, k) => a + (S.stars[k] || 0), 0) };
  }
  const DISPLAY = '"Maoken Assorted Sans", system-ui, -apple-system, "PingFang SC", sans-serif';
  const PLAIN = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  const fontReady = () => (document.fonts && document.fonts.load ? Promise.race([document.fonts.load('52px "Maoken Assorted Sans"'), new Promise(r => setTimeout(r, 1200))]).catch(() => {}) : Promise.resolve());
  /* ---------- 框里的画面：不用截屏，画一张「奖杯照」 ----------
     单子：上面三颗星，左边原来坑坑洼洼的样子 → 右边砸圆了、立在发光台子上
     通关：冒险模式所有东西砸圆了排成一面奖杯墙；无尽收工：最后交的那件放大 + 「× N 单」 */
  const PED = new Image(); let pedOk = false;
  PED.onload = () => { pedOk = true; }; PED.src = (typeof ART_IMG !== 'undefined' && ART_IMG.aPed) || '';
  let lastEndlessId = '';
  function star(g, x, y, R, on) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? R * .46 : R, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
    g.closePath(); g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = on ? '#fff7e3' : 'rgba(255,247,227,.35)';
    g.fillStyle = on ? '#ffd35c' : 'rgba(255,255,255,.08)'; g.fill(); g.stroke();
  }
  function pill(g, text, x, y, size, fg, bgc) {
    g.font = `bold ${size}px ${PLAIN}`;
    const w = g.measureText(text).width + size * 1.2, h = size * 1.7;
    g.beginPath(); g.moveTo(x - w / 2 + h / 2, y - h / 2);
    g.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, h / 2); g.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, h / 2);
    g.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, h / 2); g.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, h / 2); g.closePath();
    g.fillStyle = bgc; g.fill(); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
  }
  function put(g, id, cx, cy, size, round, alpha) {
    const c = Y.itemCanvas && Y.itemCanvas(id, Math.round(size), round); if (!c) return;
    g.save(); g.globalAlpha = alpha == null ? 1 : alpha;
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24; g.shadowOffsetY = 10;
    g.drawImage(c, cx - size / 2, cy - size / 2, size, size); g.restore();
  }
  function pedestal(g, cx, top, w) { if (pedOk) g.drawImage(PED, cx - w / 2, top, w, w * PED.height / PED.width); }
  function drawScene(g, st, rr) {
    const f = FRAME, cx = f.x + f.w / 2, focus = cx + (st.scene === 'item' ? 140 : 0), gy = f.y + f.h * .5;
    g.save(); rr(f.x, f.y, f.w, f.h, f.r); g.clip();
    const glow = g.createRadialGradient(focus, gy, 20, cx, gy, f.w * .75);
    glow.addColorStop(0, '#6a4bd6'); glow.addColorStop(.5, '#33277a'); glow.addColorStop(1, '#1e1747');
    g.fillStyle = glow; g.fillRect(f.x, f.y, f.w, f.h);
    g.save(); g.translate(focus, gy); g.globalAlpha = .07; g.fillStyle = '#fff7e3';   // 一圈淡淡的光芒
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(-55, -760); g.lineTo(55, -760); g.closePath(); g.fill(); }
    g.restore();
    g.fillStyle = 'rgba(255,247,227,.8)';   // 零星的小亮点
    [[.08, .12, 3], [.9, .1, 4], [.15, .85, 3], [.93, .7, 3], [.5, .06, 2], [.72, .9, 2], [.3, .3, 2]].forEach(([u, v, r]) => { g.beginPath(); g.arc(f.x + f.w * u, f.y + f.h * v, r, 0, Math.PI * 2); g.fill(); });
    if (st.scene === 'item') {
      for (let k = 0; k < 3; k++) star(g, cx + (k - 1) * 104, f.y + 92, 44, k < st.n);
      const bx = f.x + 190, ax = f.x + 548, y = f.y + 400;
      put(g, st.id, bx, y + 10, 230, false, .92);
      pill(g, '接单时', bx, y + 168, 26, '#fff7e3', 'rgba(17,13,43,.7)');
      g.save(); g.translate((bx + ax) / 2 - 18, y + 4);   // 粗箭头
      g.fillStyle = '#ffd35c'; g.strokeStyle = '#653616'; g.lineWidth = 5; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-34, -16); g.lineTo(10, -16); g.lineTo(10, -38); g.lineTo(52, 0); g.lineTo(10, 38); g.lineTo(10, 16); g.lineTo(-34, 16); g.closePath(); g.fill(); g.stroke();
      g.restore();
      pedestal(g, ax, y + 110, 400);
      put(g, st.id, ax, y - 20, 330, true);
      pill(g, `交货 · 圆度 ${st.r}%`, ax, f.y + f.h - 56, 30, '#653616', '#ffd35c');
    } else if (st.scene === 'grid') {
      const ids = (Y.ADV_IDS || []).slice(0, 25), cols = 5, rows = Math.ceil(ids.length / cols) || 1, cell = Math.min((f.w - 60) / cols, (f.h - 150) / rows);
      ids.forEach((id, i) => put(g, id, cx + ((i % cols) - (cols - 1) / 2) * cell, f.y + 70 + cell / 2 + Math.floor(i / cols) * cell, cell * .86, true));
      pill(g, `${ids.length} 样全部砸圆`, cx, f.y + f.h - 50, 32, '#653616', '#ffd35c');
    } else {
      const id = st.id || 'wood', y = f.y + 350;
      pedestal(g, cx, y + 150, 460);
      put(g, id, cx, y, 400, true);
      pill(g, `× ${st.done} 单`, cx + 190, y - 180, 44, '#653616', '#ffd35c');
      pill(g, '无尽模式', cx, f.y + f.h - 56, 30, '#fff7e3', 'rgba(17,13,43,.7)');
    }
    g.restore();
  }
  function shotDataUrl(st) {
    const W = 900, H = 1200;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (bgOk) g.drawImage(BG, 0, 0, W, H);
    else { const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2d2468'); bg.addColorStop(1, '#110d2b'); g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    const f = FRAME, rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    drawScene(g, st, rr);
    // 名字行：圆章头像 + 名字 + 进度
    const name = who(), ax = 104, ay = 918, ar = 40;
    const grad = g.createRadialGradient(ax - 12, ay - 14, 6, ax, ay, ar); grad.addColorStop(0, '#d8ff8a'); grad.addColorStop(1, '#5cb83a');
    g.beginPath(); g.arc(ax, ay, ar, 0, Math.PI * 2); g.fillStyle = grad; g.fill(); g.lineWidth = 5; g.strokeStyle = '#fff7e3'; g.stroke();
    g.fillStyle = '#ffffff'; g.font = `bold 40px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(Array.from(name)[0], ax, ay + 2);
    g.textAlign = 'left'; g.fillStyle = '#fff7e3'; g.font = `bold 36px ${PLAIN}`; g.fillText(name, ax + 62, ay - 16, 640);
    g.fillStyle = '#a9a1d6'; g.font = `26px ${PLAIN}`; g.fillText(st.progressLine, ax + 62, ay + 24, 640);
    // 炫耀 + 邀请
    g.textAlign = 'center';
    g.fillStyle = '#ffd35c'; g.font = `56px ${DISPLAY}`; g.fillText(st.boast, W / 2, 1008, W - 80);
    g.fillStyle = '#fff7e3'; g.font = `30px ${PLAIN}`; g.fillText(st.invite, W / 2, 1066, W - 220);
    return c.toDataURL('image/jpeg', .88);
  }
  async function tempFile(dataUrl) {
    const r = await mt().writeTempFile({ data: dataUrl });
    if (!r || !r.filePath) throw new Error('no filePath');
    return r.filePath;
  }

  /* ---------- 这一刻要晒的内容 ---------- */
  let last = null;   // story() 的结果：标题、正文、图上的字、评论草稿
  const TAGS = '#甲方要圆 #小游戏 #解压小游戏 #独立游戏';
  const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
  function story(kind, d) {
    const pg = progress(), name = who();
    const progressLine = `冒险进度 ${pg.done}/${pg.total} · 一共 ${pg.stars} 颗星`;
    const invite = '你能砸到第几关？来小红书小工具「甲方要圆」试试吧！';
    const end = `外星甲方只要圆的东西，砸不圆就会被它做成圆形😂\n你能打到第几关？快来试试，打完回来评论区报成绩！\n${TAGS}`;
    if (kind === 'endless' || (kind === 'result' && d.mode === 'endless')) {
      const done = kind === 'endless' ? d.done : G.done, score = kind === 'endless' ? d.score : G.score;
      return {
        title: clip(`无尽模式交了${done}单，来挑战我！`, 20),
        content: `我是「${name}」，在小红书小工具「甲方要圆」的无尽模式里一口气交了 ${done} 单，酬劳 ◎${score}！\n${end}`,
        scene: kind === 'endless' ? 'endless' : 'item', id: kind === 'endless' ? lastEndlessId : d.id, n: d.n || 3, r: Math.round((d.round || 0) * 100), done,
        boast: `无尽模式一口气交了 ${done} 单！`, invite, progressLine,
        comment: `无尽模式交了 ${done} 单，酬劳 ◎${score}，谁来超过我？`,
      };
    }
    if (kind === 'result') {
      const nm = nameOf(d.id), k = d.idx + 1, stars = '★'.repeat(d.n || 1), r = Math.round((d.round || 0) * 100);
      return {
        title: clip(`我打到第${k}关了，你也来试试！`, 20),
        content: `我是「${name}」，在小红书小工具「甲方要圆」里已经打到第 ${k} 关「${nm}」${d.n >= 3 ? '，还拿了满分三星' : ''}，一共收集了 ${pg.stars} 颗星⭐\n${end}`,
        scene: 'item', id: d.id, n: d.n || 1, r, boast: d.n >= 3 ? `第 ${k} 关「${nm}」满分通过！` : `我已经打到第 ${k} 关啦！`, invite, progressLine,
        comment: `我打到第 ${k} 关「${nm}」了，${stars}！你能超过我吗？`,
      };
    }
    return {
      title: '我通关了「甲方要圆」，你敢来吗？',
      content: `我是「${name}」，外星甲方的 ${pg.total} 关我全打完了，一共 ${pg.stars} 颗星⭐，累计酬劳 ◎${d.score}！甲方很满意，所以不放我走了……\n${end}`,
      scene: 'grid', boast: `${pg.total} 关全部通关！`, invite, progressLine,
      comment: `「甲方要圆」${pg.total} 关全部通关，${pg.stars} 颗星！谁来挑战？`,
    };
  }

  /* ---------- 按钮 ---------- */
  let followState = -1;
  if (CAN.follow) Promise.resolve(mt().getFollowStatus()).then(r => { followState = r ? r.follow_status : -1; }, () => {});
  function addRow(kind) {
    const old = card.querySelector('.xhs-social'); if (old) old.remove();
    const big = kind !== 'result';
    const b = [];
    if (CAN.note) b.push(['note', '晒到笔记']);
    if (CAN.share) b.push(['share', '分享给朋友']);
    if (big && CAN.comment) b.push(['comment', '去评论区报成绩']);
    if (big && CAN.follow && followState === 0) b.push(['follow', '关注作者']);
    if (big && CAN.reward) b.push(['reward', '赞赏一下作者']);
    if (!b.length) return;
    card.insertAdjacentHTML('beforeend', `<div class="row xhs-social">${b.map(([k, t]) => `<button class="btn ghost small" type="button" data-xhs="${k}">${t}</button>`).join('')}</div>`);
  }
  let busy = false;
  card.addEventListener('click', async e => {
    const t = e.target.closest && e.target.closest('[data-xhs]'); if (!t || busy) return;
    const k = t.dataset.xhs;
    if (k.startsWith('board-')) { sfx('open'); showBoard(k.slice(6), true); return; }
    if (!last) return;
    busy = true; sfx('open');
    try {
      if (k === 'note') {
        await Promise.all([bgReady(), fontReady(), pedOk ? 0 : new Promise(r => { PED.addEventListener('load', r); setTimeout(r, 1500); })]); const filePath = await tempFile(shotDataUrl(last));
        await mt().postNote({ title: last.title, content: last.content, pageType: 'photo_publish', mediaInfo: { image_resources: [{ url: filePath }] } });
      } else if (k === 'share') {
        await mt().share({ type: 'card' });
      } else if (k === 'comment') {
        if (!confirm('去评论区会关掉小工具，进度已经存好了。现在去吗？')) { busy = false; return; }
        await Promise.all([bgReady(), fontReady(), pedOk ? 0 : new Promise(r => { PED.addEventListener('load', r); setTimeout(r, 1500); })]); const filePath = await tempFile(shotDataUrl(last));
        await XS.flush();
        await mt().interactionOpenApi({ payload: { action: 'post_comment', content: last.comment, media_bean: [{ media_type: 'image', cover_image_url: filePath }] }, saveToAlbum: false });
      } else if (k === 'reward') {
        // 旧客户端可能不理这个调用、一直不回：最多等 15 秒，别把按钮卡死
        await Promise.race([mt().rewardAuthor(), new Promise((_, no) => setTimeout(() => no({ errCode: 'timeout' }), 15000))]);
      } else if (k === 'follow') {
        const r = await mt().followAuthor();
        followState = r ? r.follow_status : -1;
        if (followState === 1) { t.textContent = '已关注 ✓'; t.disabled = true; }
      }
    } catch (err) {
      const c = errCode(err);
      if (c === 20002) {}   // 用户自己关掉了
      else if (k === 'reward') { CAN.reward = false; t.remove(); if (c !== 'timeout') say('赞赏暂时用不了。'); }
      else if (k === 'share' && c === 15502) say('现在这个模式分享不了，全屏打开小工具再试试。');
      else if (k === 'share' && c === 15503) say('今天分享次数用完了，明天再来。');
      else if (k === 'follow' && c === 15404) say('今天关注提示弹得太多了，明天再试。');
      else say('没成功，过一会儿再试试。');
    }
    busy = false;
  });

  /* ---------- 排行榜（内测） ---------- */
  const RANK = { cache: {}, at: {} };
  function rankOff() { XS.rankOn = false; }
  async function rankCall(fn, args, tries) {
    for (let i = 0; ; i++) {
      try { return await mt()[fn](args); }
      catch (e) {
        const c = errCode(e);
        if ((c === 1005 || c === 10003) && fn !== 'submitScore') rankOff();
        if (c === 1005 || c === 10003) throw e;
        if (c === 2002 && i < (tries || 4)) { await new Promise(r => setTimeout(r, 500 * Math.pow(2, i))); continue; }   // 榜单还没算好：退避重试
        throw e;
      }
    }
  }
  async function showBoard(period, force) {
    period = period === 'all' ? 'all' : 'week';
    G.state = 'menu';
    const tabs = `<div class="row xhs-tabs">${[['week', '本周'], ['all', '总榜']].map(([p, t]) => `<button class="btn ${p === period ? '' : 'ghost '}small" type="button" data-xhs="board-${p}">${t}</button>`).join('')}</div>`;
    const frame = body => X.setCard(`
      <p class="eyebrow" data-board>排行榜 · 无尽模式</p>
      <h2>谁最会弄圆</h2>
      ${tabs}
      ${body}
      <div class="row"><button class="btn ghost" type="button" data-act="restart">回首页</button></div>`);
    if (!XS.rankOn) { frame('<p class="note">排行榜暂时用不了。</p>'); return; }
    const fresh = RANK.cache[period] && Date.now() - RANK.at[period] < 45000;
    if (!fresh || force) {
      frame('<p class="note">加载中…</p>');
      try {
        const [list, mine] = await Promise.all([
          rankCall('getRankList', { board: 1, period }),
          rankCall('getMyRank', { board: 1, period }).catch(() => null),
        ]);
        RANK.cache[period] = { top: (list && list.data) || [], mine }; RANK.at[period] = Date.now();
      } catch (e) {
        const c = errCode(e);
        frame(`<p class="note">${c === 1005 || c === 10003 ? '排行榜暂时用不了。' : c === 2002 ? '榜单还在算，过一会儿再看。' : '排行榜没加载出来，过一会儿再试。'}</p>`);
        return;
      }
    }
    if (G.state !== 'menu') return;   // 加载期间离开了
    const d = RANK.cache[period];
    const row = p => `<li><b>${p.rank}</b><span class="nm">${esc(p.nickname || '小红薯')}</span><span class="dl">◎ ${esc(p.score)}</span></li>`;
    let body = d.top.length ? `<ol class="board">${d.top.map(row).join('')}</ol>` : '<p class="note">还没人上榜。打一轮无尽模式，你就是第一。</p>';
    const m = d.mine;
    if (m && m.status === 'EXACT') body += `<p class="note">你排第 ${m.rank} 名，最好 ◎ ${esc(m.score)}。</p>`;
    else if (m && m.status === 'OVER_LIMIT') body += '<p class="note">你在 500 名以外，再冲一冲。</p>';
    else if (m && (m.status === 'NO_SCORE' || m.status === 'NOT_PARTICIPATING')) body += `<p class="note">${period === 'week' ? '这周' : '你'}还没有成绩，打一轮无尽模式就能上榜。</p>`;
    body += '<p class="note">按无尽模式最好的一轮的总酬劳排，昵称由小红书提供。</p>';
    frame(body);
  }
  function submit(score) {
    if (!XS.rankOn || !(score > 0)) return;
    rankCall('submitScore', { board: 1, score: Math.min(999999, Math.round(score)) }).then(() => { RANK.at = {}; }, e => {
      const c = errCode(e); if (c === 1005 || c === 10003) rankOff();
    });
  }

  /* ---------- 关闭挽留：玩进去了才打开 ---------- */
  let delivered = 0, retained = false;
  function retainSoon(ev) {
    if (retained || !CAN.retention || !CAN.reward) return;
    if (ev === 'result') delivered++;
    if (ev === 'result' && delivered < 3) return;
    retained = true;
    Promise.resolve(mt().setCloseRetentionEnabled({ enabled: true })).catch(() => { retained = false; });
  }

  /* ---------- 游戏的钩子 ---------- */
  window.__yuanXhs = (ev, d) => {
    if (ev === 'result' || ev === 'endless' || ev === 'win') retainSoon(ev);
    if (ev === 'result' && d.mode === 'endless') lastEndlessId = d.id;
    if (ev === 'board') { showBoard('week'); return; }
    if (ev === 'endless') submit(d.score);
    if (ev === 'result' || ev === 'endless' || ev === 'win') { last = story(ev, d); addRow(ev); }
  };
})();
