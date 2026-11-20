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
  function shotDataUrl(line1, line2) {
    const src = document.getElementById('cv'), W = 900, H = 1200;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (bgOk) g.drawImage(BG, 0, 0, W, H);
    else { const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2d2468'); bg.addColorStop(1, '#110d2b'); g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    if (src && src.width && src.height) {
      const f = FRAME, s = Math.min(f.w / src.width, f.h / src.height), w = src.width * s, h = src.height * s;
      g.save();
      g.beginPath();   // 圆角裁一下，画面不压到框的圆角外面
      g.moveTo(f.x + f.r, f.y); g.arcTo(f.x + f.w, f.y, f.x + f.w, f.y + f.h, f.r); g.arcTo(f.x + f.w, f.y + f.h, f.x, f.y + f.h, f.r);
      g.arcTo(f.x, f.y + f.h, f.x, f.y, f.r); g.arcTo(f.x, f.y, f.x + f.w, f.y, f.r); g.closePath(); g.clip();
      try { g.drawImage(src, f.x + (f.w - w) / 2, f.y + (f.h - h) / 2, w, h); } catch (e) {}
      g.restore();
    }
    const font = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd35c'; g.font = `bold 58px ${font}`; g.fillText(line1, W / 2, 945, W - 80);
    g.fillStyle = '#fff7e3'; g.font = `40px ${font}`; g.fillText(line2, W / 2, 1015, W - 80);
    g.fillStyle = '#a9a1d6'; g.font = `30px ${font}`; g.fillText('小红书小工具「甲方要圆」· 外星甲方只要圆的', W / 2, 1080, W - 160);
    return c.toDataURL('image/jpeg', .88);
  }
  async function tempFile(dataUrl) {
    const r = await mt().writeTempFile({ data: dataUrl });
    if (!r || !r.filePath) throw new Error('no filePath');
    return r.filePath;
  }

  /* ---------- 这一刻要晒的内容 ---------- */
  let last = null;   // { kind, title, content, line1, line2, comment }
  const TAGS = '#甲方要圆 #小游戏 #解压小游戏 #独立游戏';
  const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
  function story(kind, d) {
    if (kind === 'result') {
      const nm = nameOf(d.id), stars = '★'.repeat(d.n || 1), r = Math.round((d.round || 0) * 100);
      const where = d.mode === 'endless' ? '无尽模式' : `第 ${d.idx + 1} 单`;
      return {
        title: clip(d.n >= 3 ? `我把${nm}砸成了满分圆` : `我把${nm}砸圆了`, 20),
        content: `在小红书小工具「甲方要圆」里，${where}「${nm}」砸到圆度 ${r}%，${stars}。外星甲方只要圆的东西，你能砸到第几单？\n${TAGS}`,
        line1: `${where} · ${nm} ${stars}`, line2: `圆度 ${r}%`,
        comment: `${where}「${nm}」砸到圆度 ${r}%，${stars}！`,
      };
    }
    if (kind === 'endless') return {
      title: clip(`无尽模式交了 ${d.done} 单`, 20),
      content: `在小红书小工具「甲方要圆」的无尽模式里，一口气交了 ${d.done} 单，酬劳 ◎${d.score}。来比比谁更会弄圆？\n${TAGS}`,
      line1: `无尽模式 · 交了 ${d.done} 单`, line2: `这一轮酬劳 ◎${d.score}`,
      comment: `无尽模式交了 ${d.done} 单，酬劳 ◎${d.score}，谁来挑战？`,
    };
    return {
      title: '我通关了「甲方要圆」！',
      content: `外星甲方的 22 单全交了，累计酬劳 ◎${d.score}。甲方很满意，所以不放我走了……\n${TAGS}`,
      line1: '冒险模式通关', line2: `累计酬劳 ◎${d.score}`,
      comment: `「甲方要圆」通关了，酬劳 ◎${d.score}！`,
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
        await bgReady(); const filePath = await tempFile(shotDataUrl(last.line1, last.line2));
        await mt().postNote({ title: last.title, content: last.content, pageType: 'photo_publish', mediaInfo: { image_resources: [{ url: filePath }] } });
      } else if (k === 'share') {
        await mt().share({ type: 'card' });
      } else if (k === 'comment') {
        if (!confirm('去评论区会关掉小工具，进度已经存好了。现在去吗？')) { busy = false; return; }
        await bgReady(); const filePath = await tempFile(shotDataUrl(last.line1, last.line2));
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
    if (ev === 'board') { showBoard('week'); return; }
    if (ev === 'endless') submit(d.score);
    if (ev === 'result' || ev === 'endless' || ev === 'win') { last = story(ev, d); addRow(ev); }
  };
})();
