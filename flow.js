/* 甲方要圆 · 开场流程
   封面 → 播片 → 新手关 → 甲方递合同 → 签名（就是原来的起名字存档）→ 下一关 / 收藏室选关

   整段流程都在这个文件里，index.html 只多了两行：递出内部函数的 window.__yuanFlow，和引入本文件的 <script>。
   这个文件没加载、或者 index.html 里没有那一行，游戏就按原来的流程走（封面 → 首页）。
   不改游戏本身的函数：靠捕获阶段的事件监听抢在游戏前面接管封面和新手关的按键，提示画在游戏那一帧之后。

   谁会看到：本机没有任何进度、也没签过合同的新玩家。老玩家照旧直接进首页，首页卡片底部有「重看开场和新手关」。
   调试：网址后面加 ?intro=1 强制走一遍，?intro=0 关掉。 */
(() => {
'use strict';
const Y = window.__yuan, X = window.__yuanFlow;
if (!Y || !X) return;

/* ---------- 要改的东西都在这里 ---------- */
const CONFIG = {
  video: '',            // 播片做好以后填文件名或完整网址（如 'intro.mp4'）。留空就放下面的占位动画
  placeholderMs: 4200,  // 占位动画总时长，别超过 5 秒
  collectionAct: 'book' // 「去收藏室选关」点了以后做什么。现在接的是订单簿（act('book')）；收藏室做好以后换成它的 act 名字
};
/* 新手关：一块只有一个凸起的石头。砸不碎、不计时。
   变形量不走石头原本的数值，而是每一帧按“朝下那一面凸出来多少”现算（见 tuneStone）：
   凸起朝下砸一下基本就平了，砸在圆的那一面只蹭掉一点点，所以怎么乱砸都不会越砸越糟。 */
const TUT = { R: 84, bump: 34, width: .22, hard: 20, brittle: 150, accel: 24000, target: .85, weak: .65, over: 1.3, aim: .33 };

const G = Y.G, EN = document.documentElement.lang === 'en', L = (zh, en) => EN ? en : zh;
const TOUCH = document.documentElement.classList.contains('touch');
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const $ = id => document.getElementById(id);
const stage = $('stage'), cv = $('cv'), overlay = $('overlay'), card = $('card'), deliverBtn = $('deliver'), muteBtn = $('mute');
if (!stage || !cv || !overlay || !card || !deliverBtn) return;
const TAU = Math.PI * 2, FLOOR = 520, GRAV = 5200, VMAX = 2600;
const C = { space: '#110d2b', hull: '#1e1747', rim: '#5143a0', ink: '#f4f0ff', dim: '#a9a1d6', alien: '#93e85a', coin: '#ffd35c', alarm: '#ff5683' };
const DISPLAY = "'ZCOOL KuaiLe','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const BODY = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif";
const NUM = "Fredoka,'PingFang SC','Microsoft YaHei',sans-serif";
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const escH = v => String(v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const pct = v => Math.round(v * 100) + '%';

/* ---------- 记在本机的进度：tut = 新手关过了，signed = 合同签了 ---------- */
const KEY = 'yuan.flow.v1';
let FL = {}; try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') FL = s; } catch (e) {}
const saveFL = () => { try { localStorage.setItem(KEY, JSON.stringify(FL)); } catch (e) {} };
const QUERY = (() => { try { return new URLSearchParams(location.search).get('intro'); } catch (e) { return null; } })();
const FORCED = QUERY === '1', OFF = QUERY === '0';
const hasProgress = () => Object.keys(Y.SAVE.best).length > 0;
let ran = false;         // 这次打开页面已经走过一遍了
let phase = 'idle';      // idle | cutscene | tutorial | handoff | contract
const wantIntro = () => !OFF && !ran && (FORCED || (!FL.signed && !hasProgress()));

/* ---------- 样式 ---------- */
const HAND = `"Long Cang", "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", cursive`;
const SERIF = `"Noto Serif SC", "Songti SC", "STSong", "SimSun", "Source Han Serif SC", Georgia, serif`;
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .18 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E")`;
const style = document.createElement('style');
style.textContent = `
#flow-lang { position: absolute; right: 1.6%; bottom: 2.6%; font: 500 max(10px, calc(var(--u) * 13))/1 var(--body); padding: .5em .9em; border: 0; border-radius: 999px; background: transparent; color: var(--dim); box-shadow: inset 0 0 0 1px var(--rim); cursor: pointer; }
#flow-lang:hover { color: var(--ink); }
#flow-lang:focus-visible { outline: 3px solid var(--coin); outline-offset: 3px; }
#stage:not(.cover) #flow-lang { display: none; }
#stage.port #flow-lang { font-size: max(11px, calc(var(--u) * 17)); bottom: calc(var(--u) * (var(--bot) + 10)); }   /* 竖屏跟声音按钮排在同一行 */
#stage.flow-lock #home { display: none !important; }

/* 播片 */
#flow-cut { position: absolute; inset: 0; z-index: 4; overflow: hidden; background: #07051a; color: var(--ink); animation: fcIn .25s ease-out both; }
#flow-cut.out { animation: fcOut .3s ease-in both; pointer-events: none; }
@keyframes fcIn { from { opacity: 0; } }
@keyframes fcOut { to { opacity: 0; } }
#flow-cut video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.fc-shot { position: absolute; inset: 0; opacity: 0; transition: opacity .35s ease; }
.fc-shot.on { opacity: 1; }
.fc-shot svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.fc-shot.on .fc-move { animation: fcMove 1.6s ease-out both; }
.fc-shot.on .fc-rise { animation: fcRise 1.5s ease-in both; }
@keyframes fcMove { from { transform: scale(1.12); } to { transform: scale(1); } }
@keyframes fcRise { from { transform: translateY(150px); } to { transform: translateY(-40px) scale(.5); } }
.fc-move, .fc-rise { transform-origin: 50% 50%; transform-box: view-box; }
.fc-bars::before, .fc-bars::after { content: ''; position: absolute; left: 0; right: 0; height: 11%; background: #000; z-index: 1; }
.fc-bars::before { top: 0; } .fc-bars::after { bottom: 0; }
.fc-cap { position: absolute; left: 6%; right: 6%; bottom: 15%; z-index: 2; margin: 0; text-align: center; font: 400 max(17px, calc(var(--u) * 34))/1.3 var(--display); letter-spacing: .04em; text-shadow: 0 2px 10px #000; text-wrap: balance; }
.fc-tag { position: absolute; left: 2.2%; top: 2.6%; z-index: 3; font: 500 max(10px, calc(var(--u) * 13))/1 var(--body); letter-spacing: .1em; color: var(--dim); padding: .45em .8em; border: 1px dashed var(--rim); border-radius: .5em; }
.fc-skip { position: absolute; right: 2.2%; bottom: 2.6%; z-index: 3; font: 500 max(11px, calc(var(--u) * 15))/1 var(--body); padding: .55em 1em; border: 0; border-radius: 999px; background: rgb(17 13 43 / .7); color: var(--ink); box-shadow: inset 0 0 0 1px var(--rim); cursor: pointer; }
.fc-skip kbd { font: 500 .85em var(--num); opacity: .7; margin-left: .4em; }
.touch .fc-skip kbd { display: none; }
.fc-skip:focus-visible { outline: 3px solid var(--coin); outline-offset: 3px; }
.fc-prog { position: absolute; left: 0; bottom: 0; z-index: 3; height: 3px; width: 100%; background: var(--alien); transform-origin: 0 50%; transform: scaleX(0); }
#stage.port .fc-cap { bottom: 20%; font-size: max(17px, calc(var(--u) * 33)); }
#stage.port .fc-tag, #stage.port .fc-skip { font-size: max(11px, calc(var(--u) * 19)); }

/* 合同：一张纸，不是卡片 */
#flow-deal { position: fixed; inset: 0; z-index: 8; display: flex; overflow: auto; overscroll-behavior: contain; padding: 20px max(12px, env(safe-area-inset-right, 0px)) 30px max(12px, env(safe-area-inset-left, 0px)); background: rgb(8 6 24 / .66); animation: fcIn .3s ease-out both; }
#flow-deal.out { animation: fcOut .45s ease-in both; pointer-events: none; }
.fd-paper {
  position: relative; box-sizing: border-box; margin: auto; width: min(100%, 610px); padding: 34px 46px 30px; border-radius: 2px;
  color: #2b2622; font: 500 clamp(14px, 1.94vh, 15.5px)/1.7 ${SERIF}; text-align: left;
  background-color: #f3ecda;
  background-image:
    linear-gradient(to bottom, transparent calc(34% - 1px), rgb(60 40 10 / .09) 34%, rgb(255 255 255 / .55) calc(34% + 1px), transparent calc(34% + 2px)),
    linear-gradient(to bottom, transparent calc(67% - 1px), rgb(60 40 10 / .09) 67%, rgb(255 255 255 / .55) calc(67% + 1px), transparent calc(67% + 2px)),
    radial-gradient(120% 90% at 20% 0%, rgb(255 255 255 / .5), transparent 60%),
    ${NOISE};
  box-shadow: 0 0 0 1px rgb(90 70 30 / .18), 0 22px 46px rgb(0 0 0 / .55), 0 3px 6px rgb(0 0 0 / .35);
  transform: rotate(-.7deg); transform-origin: 50% 40%;
}
.fd-paper::after { content: ''; position: absolute; right: 0; top: 0; width: 26px; height: 26px; background: linear-gradient(225deg, rgb(8 6 24 / .9) 49%, #d9cfb6 50%, #efe7d2); box-shadow: -2px 2px 3px rgb(0 0 0 / .18); }
.fd-paper p { margin: 0; }
.fd-no { font-size: .8em; letter-spacing: .05em; color: #6f655a; text-align: right; padding-right: 14px; font-variant-numeric: tabular-nums; }
.fd-title { margin: .25em 0 0; text-align: center; font: 700 2.05em/1.25 ${SERIF}; letter-spacing: .55em; padding-left: .55em; }
html[lang="en"] .fd-title { letter-spacing: .14em; padding-left: .14em; font-size: 1.7em; }
.fd-sub { text-align: center; font: 500 .7em/1 Georgia, "Times New Roman", serif; letter-spacing: .34em; color: #6f655a; padding: .7em 0 1.15em; border-bottom: 3px double #2b2622; }
.fd-parties { margin: 1em 0 .55em; display: grid; gap: .1em; }
.fd-parties b, .fd-terms b { font-weight: 700; }
.fd-who { display: inline-block; min-width: 7em; padding: 0 .4em; border-bottom: 1px solid #2b2622; font: 400 1.35em/1.1 ${HAND}; color: #1d2c6e; text-align: center; vertical-align: baseline; white-space: nowrap; }
.fd-lead { text-indent: 2em; }
html[lang="en"] .fd-lead { text-indent: 0; }
.fd-terms { margin: .55em 0 .5em; padding: 0; list-style: none; display: grid; gap: .32em; }
.fd-terms b { margin-right: .7em; white-space: nowrap; }
.fd-terms em { position: relative; font-style: normal; font-weight: 700; color: #b3261e; white-space: nowrap; }
.fd-terms em::after { content: ''; position: absolute; inset: -.22em -.55em -.26em; border: 2px solid #c0281c; border-radius: 50%; transform: rotate(-2deg); opacity: .8; pointer-events: none; }
.fd-note { display: inline-block; margin-left: 1.1em; font: 400 1.3em/1 ${HAND}; color: #2f7a28; transform: rotate(-3deg); white-space: nowrap; }
.fd-fine { font-size: .82em; color: #6f655a; padding-top: .5em; border-top: 1px solid rgb(43 38 34 / .35); }
.fd-sign { position: relative; margin-top: 1em; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 0 1.4em; align-items: start; }
.fd-a, .fd-b { position: relative; min-height: 7.4em; }
.fd-seal { position: absolute; left: 1.2em; top: 1.6em; width: 6.6em; height: 6.6em; transform: rotate(-9deg); opacity: .84; mix-blend-mode: multiply; pointer-events: none; }
.fd-scrawl { position: absolute; left: 4.4em; top: 2.2em; width: 7em; height: 3.6em; opacity: .85; pointer-events: none; }
.fd-line { position: relative; display: flex; align-items: flex-end; margin-top: .5em; border-bottom: 1.5px solid #2b2622; }
.fd-line input {
  flex: 1 1 0; min-width: 0; width: 100%; box-sizing: border-box; margin: 0; padding: .1em 3.1em 0 .25em; border: 0; border-radius: 0; background: transparent; outline: none;
  font: 400 max(27px, 1.9em)/1.25 ${HAND}; color: #1d2c6e; caret-color: #1d2c6e; -webkit-user-select: text; user-select: text; -webkit-appearance: none; appearance: none;
}
.fd-line input::placeholder { font: 500 15px/2.2 ${SERIF}; color: #a39a8c; }
.fd-line input:disabled { opacity: 1; -webkit-text-fill-color: #1d2c6e; }
.fd-line:focus-within { border-bottom-color: #1d2c6e; box-shadow: 0 1.5px 0 #1d2c6e; }
.fd-thumb { position: absolute; right: -.3em; bottom: -1.1em; width: 4.3em; height: 4.3em; padding: 0; border: 2px dashed #c0281c; border-radius: 50%; background: rgb(192 40 28 / .05); color: #b3261e; font: 700 .8em/1.25 ${SERIF}; cursor: pointer; transform: rotate(-8deg); }
.fd-thumb:hover { background: rgb(192 40 28 / .13); }
.fd-thumb:focus-visible { outline: 2px solid #1d2c6e; outline-offset: 3px; }
.fd-thumb svg { display: none; width: 100%; height: 100%; }
.fd-thumb.done { border-color: transparent; background: none; cursor: default; mix-blend-mode: multiply; }
.fd-thumb.done span { display: none; } .fd-thumb.done svg { display: block; }
.fd-flag { position: absolute; right: -1.1em; bottom: calc(100% + 12px); padding: .5em .75em 1.05em; font: 700 12.5px/1 ${BODY}; color: #5b2b00; background: #ffd35c; clip-path: polygon(0 0, 100% 0, 100% 68%, 62% 68%, 50% 100%, 38% 68%, 0 68%); filter: drop-shadow(0 1px 1px rgb(0 0 0 / .35)); white-space: nowrap; animation: fdFlag 1s ease-in-out infinite alternate; pointer-events: none; }
@keyframes fdFlag { to { transform: translateY(5px); } }
.fd-msg { min-height: 1.5em; margin-top: 1.25em !important; font: 400 1.2em/1.25 ${HAND}; color: #b3261e; }
.fd-date { grid-column: 1 / -1; margin-top: .2em !important; text-align: right; font-size: .88em; color: #4a433c; }
.fd-stamp { position: absolute; left: 50%; top: 43%; width: 8.6em; height: 8.6em; margin: -4.3em 0 0 -4.3em; display: grid; place-items: center; border: 4px solid #c0281c; border-radius: 50%; outline: 1.5px solid #c0281c; outline-offset: -9px; color: #c0281c; font: 700 1.75em/1.2 ${SERIF}; letter-spacing: .12em; text-align: center; transform: rotate(-14deg); opacity: .86; mix-blend-mode: multiply; pointer-events: none; animation: fdStamp .32s cubic-bezier(.2, 1.4, .4, 1) both; }
html[lang="en"] .fd-stamp { font-size: 1.25em; letter-spacing: .08em; width: 11em; height: 11em; margin: -5.5em 0 0 -5.5em; }
@keyframes fdStamp { from { transform: rotate(-14deg) scale(2.4); opacity: 0; } }
.fd-hand { position: absolute; left: -64px; top: -50px; width: 120px; height: 104px; pointer-events: none; animation: fdHand .5s 1.15s ease-in both; }
@keyframes fdHand { to { transform: translate(-90px, -70px); opacity: 0; } }
.fd-shake { animation: fdShake .32s linear; }
@keyframes fdShake { 20% { transform: translateX(-7px); } 45% { transform: translateX(6px); } 70% { transform: translateX(-4px); } 90% { transform: translateX(2px); } }
.fd-more { position: fixed; left: 50%; bottom: max(14px, env(safe-area-inset-bottom, 0px)); z-index: 9; transform: translateX(-50%); padding: .5em 1.1em; border: 0; border-radius: 3px; background: #ffd35c; color: #5b2b00; font: 700 14px/1 ${BODY}; white-space: nowrap; box-shadow: 0 3px 10px rgb(0 0 0 / .45); cursor: pointer; }
@media (max-width: 560px) {
  .fd-paper { padding: 24px 24px 22px; font-size: 14px; line-height: 1.66; }
  .fd-title { font-size: 1.8em; }
  .fd-sign { grid-template-columns: minmax(0, 4fr) minmax(0, 7fr); gap: 0 .8em; }
  .fd-seal { left: 0; top: 1.3em; width: 5.8em; height: 5.8em; }
  .fd-scrawl { left: 2.2em; top: 2em; width: 5.4em; }
  .fd-note { margin-left: .2em; }
  html[lang="en"] .fd-b label { display: block; max-width: calc(100% - 5.6em); line-height: 1.3; }
}
@media (prefers-reduced-motion: reduce) { .fd-flag, .fd-stamp, .fd-hand, .fc-shot.on .fc-move, .fc-shot.on .fc-rise { animation: none; } .fd-hand { display: none; } }

/* 签完以后的两个去处：下一关最大 */
.flow-go { display: flex; flex-wrap: wrap; gap: .8em 1em; align-items: center; margin-top: .2em; }
.btn.flow-big { flex: 1 1 13em; display: grid; gap: .28em; justify-items: center; font-size: 2.1em; padding: .62em 1em .56em; box-shadow: 0 0 0 calc(var(--u) * 6) rgb(147 232 90 / .2); }
.btn.flow-big small { font: 500 .36em/1 var(--body); letter-spacing: .06em; opacity: .78; }
.flow-go .btn.ghost { flex: 0 1 auto; }
.flow-again { text-align: right; }
`;
document.head.appendChild(style);
// 合同用的宋体和手写体。加载不到也没关系，有系统字体兜底
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet'; fontLink.href = 'https://fonts.googleapis.com/css2?family=Long+Cang&family=Noto+Serif+SC:wght@500;700&display=swap';
fontLink.media = 'print'; fontLink.onload = () => { fontLink.media = 'all'; };
document.head.appendChild(fontLink);

/* ---------- 新手关的石头 ---------- */
Y.MATS.tutor = Object.assign({}, Y.MATS.stone, { hard: TUT.hard, brittle: TUT.brittle, loose: 1, accel: TUT.accel, rough: 0, rnd: null, snd: 'stone', target: TUT.target });
X.SHAPES.tutor = () => {   // 一个圆，加一个朝右上的凸起
  const p = [], a0 = -Math.PI / 2 + .5;
  for (let k = 0; k < 120; k++) { const a = k / 120 * TAU, d = wrapPi(a - a0); const r = TUT.R + 1.2 * Math.sin(a * 3 + 1) + TUT.bump * Math.exp(-d * d / (2 * TUT.width * TUT.width)); p.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return p;
};
X.ART.tutor = X.ART.stone;

let T = null, raf = 0;   // 新手关的临时状态
function geom(b) {
  const n = b.r.length, dphi = TAU / n, down = Math.PI / 2 - b.a;
  let bi = 0, top = 0;
  for (let i = 0; i < n; i++) { if (b.r[i] > b.r[bi]) bi = i; const h = b.r[i] * Math.cos(i * dphi - down); if (h > top) top = h; }
  const ref = Array.from(b.r).sort((p, q) => p - q)[n >> 1];   // 中位数半径 = 那个“圆”本来的半径，不受凸起影响
  const ang = b.a + bi * dphi;                                  // 凸起现在朝哪（世界角度，朝下 = π/2）
  return { ref, rmax: b.r[bi], hgt: b.r[bi] - ref, out: top - ref, ang, err: wrapPi(Math.PI / 2 - ang) };
}
/* 每帧按“朝下那一面凸出来多少”定这一下能砸掉多少：力度够（≥60）就把凸出来的全砸平再多一点，轻一点砸掉六成多；没凸出来就只蹭掉一点点 */
function tuneStone(b, g) {
  const m = b.mat, vy = Math.max(0, b.vy);
  const F = clamp((b.held ? vy + m.accel * .008 : Math.sqrt(vy * vy + 2 * GRAV * Math.max(0, b.clear))) / VMAX * 100, 0, 100);   // 估一下落地力度
  const t = clamp((F - m.hard) / (m.brittle - m.hard), 0, 1), k = clamp(TUT.weak + (1 - TUT.weak) * (F - m.hard) / 40, TUT.weak, 1);
  m.loose = (g.out > 2 ? g.out * k * TUT.over : .4) / (b.meanR * (Y.TUNE.D0 + Y.TUNE.D1 * t));
}
function newStone() {
  G.idx = 0; G.loop = 0; G.score = 0; G.done = 0; X.setupRound();
  const m = Y.MATS.tutor; m.loose = 1;
  G.mat = m; G.body = Y.makeBody('tutor'); G.target = TUT.target; G.hp = m.hp; G.timeLeft = G.timeMax = m.time;
  G.round = G.shown = Y.roundness(G.body.r); G.wasReady = false; deliverBtn.hidden = true;
  G.idx = -1;   // 界面上显示成“第 0 单”：试工不算在 48 单里
  T = { grabbed: false, rotated: false, hit: null, before: G.round, note: null, keyL: false, keyR: false, light: 0 };
}
function startTutorial() {
  phase = 'tutorial'; newStone(); G.state = 'play';
  stage.classList.add('flow-tut'); stage.classList.toggle('flow-lock', !(FL.signed || hasProgress()));   // 第一次来不给回首页，重看的时候可以走
  G.mood = 'calm'; G.moodT = 0;
  G.bubble = { text: L('先试工。把这块石头的凸起砸掉。', 'A trial first. Knock the bump off this stone.'), t0: G.time, dur: 5.5, lines: null };
  cancelAnimationFrame(raf); raf = requestAnimationFrame(tutFrame);
  try { document.fonts.load(`20px 'ZCOOL KuaiLe'`, HINT_TEXT); } catch (e) {}
}
function stopTutorial() { cancelAnimationFrame(raf); raf = 0; stage.classList.remove('flow-tut', 'flow-lock'); }
function quitTutorial() {   // 只有重看的时候能走到这里
  stopTutorial(); phase = 'idle'; G.idx = 0; Y.release(); Y.act('restart');
}
function tryFinish() {
  const b = G.body; if (phase !== 'tutorial' || G.state !== 'play' || !b) return;
  if (G.round < G.target) { T.note = { text: L('还没达标，先把凸起砸掉', 'Not round enough yet: knock the bump off first'), t: G.time }; return; }
  Y.release(); const round = G.round;
  stopTutorial(); phase = 'handoff'; G.state = 'flow'; deliverBtn.hidden = true;
  X.sfx.win(); G.mood = 'happy'; G.moodT = G.time + 8;
  G.bubble = { text: L('做得不错，地球人。我们决定雇你。', 'Not bad, Earthling. We are hiring you.'), t0: G.time, dur: 3.6, lines: null };
  FL.tut = 1; saveFL();
  setTimeout(() => openContract(round), 1900);
}

/* 提示文字：电脑上教 A / D，手机上教“抓对面那头”和第二根手指 */
const TXT = {
  grab: L('按住石头，把它拎起来', 'Press and hold the stone to lift it'),
  again: L('再拎起来，凸起朝下砸', 'Lift it again and slam it bump-down'),
  turn: TOUCH ? L('让凸起朝下', 'Point the bump down') : L('按住 A 或 D 旋转，让凸起朝下', 'Hold A or D to rotate: point the bump down'),
  turnSub: TOUCH ? L('另一根手指左右滑，或者松手改抓凸起对面那头', 'Slide a second finger, or let go and grab the side opposite the bump') : '',
  slam: L('凸起朝下了，往地板上砸', 'Bump is down. Slam it on the floor'),
  light: L('太轻了：举高一点，甩快一点', 'Too soft: lift higher and swing faster'),
  miss: L('没砸到凸起，先让凸起朝下', 'That missed the bump. Point the bump down first'),
  ready: TOUCH ? L('够圆了，点「交货」', 'Round enough. Tap Deliver') : L('够圆了，按空格交货', 'Round enough. Press Space to deliver'),
  readySub: TOUCH ? '' : L('记一下：拎着的时候按 A / D 可以旋转', 'Remember: A / D rotates it while you hold it'),
  bump: L('凸起', 'bump')
};
const HINT_TEXT = Object.values(TXT).join('');
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function pill(c, v, main, sub, hot) {
  const fs = v.PORT ? 25 : 22, fs2 = v.PORT ? 17 : 14.5, maxW = v.VW - (v.PORT ? 24 : 320);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `${fs}px ${DISPLAY}`; let w = c.measureText(main).width, f1 = fs;
  if (w > maxW - 40) { f1 = Math.floor(fs * (maxW - 40) / w); c.font = `${f1}px ${DISPLAY}`; w = c.measureText(main).width; }
  let w2 = 0, f2 = fs2;
  if (sub) { c.font = `${f2}px ${BODY}`; w2 = c.measureText(sub).width; if (w2 > maxW - 40) { f2 = Math.floor(fs2 * (maxW - 40) / w2 * 10) / 10; c.font = `${f2}px ${BODY}`; w2 = c.measureText(sub).width; } }
  const bw = Math.max(w, w2) + 44, bh = f1 + 22 + (sub ? f2 + 9 : 0);
  const x = v.PORT ? v.CAMX + v.VW / 2 - 5 : 500, y = v.PORT ? 106 : 214;   // 横屏放在甲方气泡下面，不跟它抢地方
  rr(c, x - bw / 2, y - bh / 2, bw, bh, Math.min(22, bh / 2)); c.fillStyle = 'rgba(17,13,43,.88)'; c.fill();
  c.strokeStyle = hot ? C.alien : C.coin; c.lineWidth = 2; c.stroke();
  c.fillStyle = hot ? C.alien : C.ink; c.font = `${f1}px ${DISPLAY}`; c.fillText(main, x, y - (sub ? (f2 + 9) / 2 : 0) + 1);
  if (sub) { c.fillStyle = C.dim; c.font = `${f2}px ${BODY}`; c.fillText(sub, x, y + (f1 + 9) / 2 + 1); }
}
function keycap(c, x, y, letter, glyph, on, want, t) {
  const s = 50; c.save(); c.translate(x, y + (on ? 3 : 0));
  if (want && !on) { c.globalAlpha = .35 + .3 * Math.sin(t * 6); rr(c, -s / 2 - 6, -s / 2 - 6, s + 12, s + 12, 15); c.strokeStyle = C.coin; c.lineWidth = 3; c.stroke(); c.globalAlpha = 1; }
  if (!on) { rr(c, -s / 2, -s / 2 + 5, s, s, 10); c.fillStyle = '#0b0820'; c.fill(); }   // 键帽的厚度
  rr(c, -s / 2, -s / 2, s, s, 10); c.fillStyle = on ? C.coin : want ? '#3a2f86' : '#2a2262'; c.fill();
  c.strokeStyle = on || want ? C.coin : C.rim; c.lineWidth = 2; c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = on ? C.space : C.ink; c.font = `700 27px ${NUM}`; c.fillText(letter, 0, 1);
  c.fillStyle = on || want ? C.coin : C.dim; c.font = `22px ${BODY}`; c.fillText(glyph, 0, -s / 2 - 17);
  c.restore();
}
function drawHints(b, g, ready) {
  const v = X.view, c = Y.ctx, t = G.time;
  c.save(); c.setTransform(v.scale, 0, 0, v.scale, 0, 0); c.translate(-v.CAMX, v.TOP); c.lineJoin = 'round'; c.lineCap = 'round';
  const aligned = Math.abs(g.err) < TUT.aim, bumpy = g.hgt > 7;
  if (!ready && bumpy) {
    // 凸起上标两个字
    if (!(b.held && aligned)) {   // 对准以后这里要画往下的箭头，两个字让开
      const lx = b.x + Math.cos(g.ang) * (g.rmax + 22), ly = b.y + Math.sin(g.ang) * (g.rmax + 22);
      c.font = `${v.PORT ? 20 : 17}px ${DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 5; c.strokeStyle = 'rgba(17,13,43,.85)'; c.strokeText(TXT.bump, lx, ly); c.fillStyle = C.coin; c.fillText(TXT.bump, lx, ly);
    }
    // 从凸起到正下方的弧形箭头
    if (!aligned && (b.held || T.grabbed)) {
      const dir = g.err > 0 ? 1 : -1, R = b.meanR + 44, a0 = g.ang + dir * .3, a1 = Math.PI / 2 - dir * .05;
      if (dir * wrapPi(a1 - a0) > .12 || Math.abs(g.err) > 2.6) {
        c.strokeStyle = C.coin; c.lineWidth = 4; c.globalAlpha = .9; c.setLineDash([2, 11]); c.lineDashOffset = -dir * t * 40;
        c.beginPath(); c.arc(b.x, b.y, R, a0, a1, dir < 0); c.stroke(); c.setLineDash([]);
        const ex = b.x + Math.cos(a1) * R, ey = b.y + Math.sin(a1) * R, tx = -Math.sin(a1) * dir, ty = Math.cos(a1) * dir;
        c.fillStyle = C.coin; c.beginPath(); c.moveTo(ex + tx * 13, ey + ty * 13); c.lineTo(ex - tx * 7 + ty * 10, ey - ty * 7 - tx * 10); c.lineTo(ex - tx * 7 - ty * 10, ey - ty * 7 + tx * 10); c.closePath(); c.fill(); c.globalAlpha = 1;
      }
    }
  }
  if (!ready && !b.held) {   // 还没拎：石头外面一圈呼吸的光圈
    const k = (t * .9) % 1; c.strokeStyle = C.coin; c.lineWidth = 3; c.globalAlpha = .75 * (1 - k); c.beginPath(); c.arc(b.x, b.y, b.meanR + 12 + 34 * k, 0, TAU); c.stroke(); c.globalAlpha = 1;
  }
  if (!ready && b.held && aligned && bumpy && b.clear > 26) {   // 对准了：往下的箭头
    const x = b.lowX, y0 = FLOOR - b.clear + 12, span = Math.min(90, FLOOR - 14 - y0);
    c.strokeStyle = C.alien; c.lineWidth = 5;
    for (let k = 0; k < 3; k++) { const f = ((t * 1.6 + k / 3) % 1), y = y0 + span * f; c.globalAlpha = Math.sin(Math.PI * f); c.beginPath(); c.moveTo(x - 14, y - 8); c.lineTo(x, y + 6); c.lineTo(x + 14, y - 8); c.stroke(); }
    c.globalAlpha = 1;
  }
  if (!TOUCH && b.held && !ready) {   // 电脑：石头两边的 A / D 键帽，正在按的亮起来，该按的那个闪
    const gap = b.meanR + 78, lo = v.CAMX + 44, hi = 880 - 44, y = clamp(b.y + 8, 96, FLOOR - 40);
    const need = !aligned && bumpy ? (g.err > 0 ? 'R' : 'L') : '';
    keycap(c, clamp(b.x - gap, lo, hi), y, 'A', '↺', T.keyL, need === 'L', t);
    keycap(c, clamp(b.x + gap, lo, hi), y, 'D', '↻', T.keyR, need === 'R', t);
  }
  // 一句话提示
  const flash = T.note && t - T.note.t < 2.4 ? T.note.text : '';
  if (ready) pill(c, v, TXT.ready, T.rotated ? '' : TXT.readySub, true);
  else if (flash) pill(c, v, flash, '', false);
  else if (!b.held) pill(c, v, T.grabbed ? TXT.again : TXT.grab, '', false);
  else if (aligned && bumpy) pill(c, v, TXT.slam, T.light >= 2 ? TXT.light : '', true);
  else pill(c, v, TXT.turn, TXT.turnSub, false);
  c.restore();
}
function tutFrame() {
  raf = requestAnimationFrame(tutFrame);
  const b = G.body; if (phase !== 'tutorial' || G.state !== 'play' || !b || b.id !== 'tutor') return;
  try {
    G.started = false; G.timeLeft = G.timeMax; G.hp = b.mat.hp;   // 不计时、砸不坏
    if (b.held) { T.grabbed = true; if (Math.abs(b.userRot) > .2) T.rotated = true; }
    if (G.lastHit && G.lastHit !== T.hit) {   // 刚砸了一下：没变圆就说一句为什么
      T.hit = G.lastHit;
      if (T.hit.kind === 'light') T.light++;
      else if (G.round < G.target && G.round - T.before < .006) T.note = { text: TXT.miss, t: G.time };
    }
    T.before = G.round;
    const g = geom(b); tuneStone(b, g); drawHints(b, g, G.round >= G.target);
  } catch (e) { console.error('[flow] tutorial frame', e); }
}

/* ---------- 播片 ---------- */
let cutSkip = null;
const SHOTS = [
  { cap: L('你是地球上手艺最好的工匠。', 'You are the finest artisan on Earth.'),
    svg: `<g class="fc-move"><circle cx="480" cy="330" r="150" fill="#2f6fd0"/><path d="M398 262c34-30 78-18 92 8s-10 52-44 58-76-34-48-66zM520 372c26-12 62-2 66 22s-30 44-56 34-34-44-10-56z" fill="#4fae5a"/><circle cx="480" cy="330" r="150" fill="none" stroke="#9fd0ff" stroke-width="5" opacity=".5"/><path d="M468 206l10-34 12 34 34 10-34 12-12 34-10-34-34-12z" fill="#ffd35c"/></g>` },
  { cap: L('所以，你被外星人绑走了。', 'So the aliens abducted you.'),
    svg: `<path d="M420 190L330 600h300L540 190z" fill="#93e85a" opacity=".22"/><g class="fc-rise"><circle cx="480" cy="400" r="15" fill="#f4f0ff"/><path d="M480 415v48M480 428l-22 18M480 428l22-20M480 463l-16 34M480 463l16 34" stroke="#f4f0ff" stroke-width="8" stroke-linecap="round" fill="none"/></g><g class="fc-move"><ellipse cx="480" cy="150" rx="74" ry="50" fill="#9fd0ff" opacity=".55"/><ellipse cx="480" cy="178" rx="170" ry="40" fill="#5143a0"/><ellipse cx="480" cy="170" rx="170" ry="34" fill="#7a6ad0"/><circle cx="400" cy="178" r="8" fill="#ffd35c"/><circle cx="480" cy="186" r="8" fill="#ffd35c"/><circle cx="560" cy="178" r="8" fill="#ffd35c"/></g>` },
  { cap: L('甲方只有一个需求：圆。', 'The Client wants one thing: round.'),
    svg: `<g class="fc-move"><ellipse cx="480" cy="300" rx="250" ry="56" fill="none" stroke="#a9a1d6" stroke-width="10" opacity=".45" transform="rotate(-16 480 300)"/><circle cx="480" cy="300" r="140" fill="#93e85a"/><circle cx="480" cy="300" r="140" fill="none" stroke="#4f9c33" stroke-width="8"/><ellipse cx="432" cy="286" rx="26" ry="34" fill="#12202e"/><ellipse cx="528" cy="286" rx="26" ry="34" fill="#12202e"/><circle cx="440" cy="276" r="8" fill="#fff"/><circle cx="536" cy="276" r="8" fill="#fff"/><path d="M452 356q28 18 56 0" stroke="#2c5a1c" stroke-width="8" stroke-linecap="round" fill="none"/></g>` }
];
function playCutscene(done) {
  phase = 'cutscene';
  const el = document.createElement('div'); el.id = 'flow-cut'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', L('开场动画', 'Opening cutscene'));
  el.innerHTML = `<button class="fc-skip" type="button">${L('跳过', 'Skip')}<kbd>Esc</kbd></button>`;
  stage.appendChild(el);
  const timers = [], t0 = performance.now(); let over = false, video = null;
  const end = () => {
    if (over) return; over = true; cutSkip = null; timers.forEach(clearTimeout);
    if (video) { try { video.pause(); } catch (e) {} }
    el.classList.add('out'); setTimeout(() => el.remove(), 320); done();
  };
  cutSkip = () => { if (performance.now() - t0 > 350) { X.sfx.ui(); end(); } };   // 刚点完封面的那一下不算跳过
  el.querySelector('.fc-skip').addEventListener('click', cutSkip);
  const placeholder = () => {
    if (video) { video.remove(); video = null; }
    const d = clamp(CONFIG.placeholderMs, 900, 5000) / SHOTS.length;
    el.classList.add('fc-bars');
    el.insertAdjacentHTML('afterbegin', SHOTS.map(s => `<div class="fc-shot"><svg viewBox="0 0 960 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="960" height="600" fill="#0a0722"/><g transform="translate(0 -44)">${s.svg}</g></svg><p class="fc-cap">${s.cap}</p></div>`).join('') + `<span class="fc-tag">${L('播片占位', 'Cutscene placeholder')}</span><i class="fc-prog"></i>`);
    const shots = el.querySelectorAll('.fc-shot');
    shots.forEach((s, i) => timers.push(setTimeout(() => { shots.forEach(o => o.classList.toggle('on', o === s)); }, i * d + 20)));
    try { el.querySelector('.fc-prog').animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: d * SHOTS.length, fill: 'forwards' }); } catch (e) {}
    timers.push(setTimeout(end, d * SHOTS.length));
  };
  if (!CONFIG.video) { placeholder(); return; }
  video = document.createElement('video');
  video.src = CONFIG.video; video.playsInline = true; video.setAttribute('playsinline', ''); video.preload = 'auto';
  video.muted = !!(muteBtn && muteBtn.getAttribute('aria-pressed') === 'true');
  let started = false;
  video.addEventListener('playing', () => { started = true; });
  video.addEventListener('ended', end);
  video.addEventListener('error', () => { if (!over && !started) placeholder(); else end(); });
  el.insertBefore(video, el.firstChild);
  const p = video.play(); if (p && p.catch) p.catch(() => { if (over) return; video.muted = true; const q = video.play(); if (q && q.catch) q.catch(() => { if (!over && !started) placeholder(); }); });
  timers.push(setTimeout(() => { if (!over && !started) placeholder(); }, 5000));   // 5 秒还没开始放：当作没有这个文件
}

/* ---------- 合同 ---------- */
const NAME_OK = (() => { try { return new RegExp("^[\\p{L}\\p{N} \\-_·.']+$", 'u'); } catch (e) { return null; } })();
function cleanName(raw) { let s = String(raw || ''); try { s = s.normalize('NFKC'); } catch (e) {} return s.trim().replace(/\s+/g, ' '); }
function contractNo() {   // 看着像流水号：从本机的随机玩家 ID 算出来，同一个人每次都一样
  let pid = ''; try { pid = localStorage.getItem('yuan.pid') || ''; } catch (e) {}
  let h = 7; for (const ch of pid || 'yuan') h = (h * 31 + ch.charCodeAt(0)) % 9000000;
  return String(1000000 + h).slice(1).padStart(7, '0');
}
function alienPoint() {
  const rc = cv.getBoundingClientRect(), v = X.view, k = rc.width / v.VW;
  return v.PORT ? { x: rc.left + 50 * k, y: rc.top + 52 * k } : { x: rc.left + (92 - v.CAMX) * k, y: rc.top + (112 + v.TOP) * k };
}
const SEAL = () => `<svg class="fd-seal" viewBox="0 0 120 120" aria-hidden="true"><defs><path id="fd-arc" d="M60 60m-43 0a43 43 0 1 1 86 0"/><path id="fd-arc2" d="M22 68a38 38 0 0 0 76 0"/></defs>
  <circle cx="60" cy="60" r="55" fill="none" stroke="#c0281c" stroke-width="4.5"/><circle cx="60" cy="60" r="35" fill="none" stroke="#c0281c" stroke-width="1"/>
  <circle cx="60" cy="60" r="13" fill="none" stroke="#c0281c" stroke-width="4"/><circle cx="60" cy="60" r="4" fill="#c0281c"/>
  <text fill="#c0281c" font-family='${SERIF.replace(/"/g, '')}' font-weight="700" font-size="${EN ? 9.4 : 13}" letter-spacing="${EN ? .6 : 2.5}"><textPath href="#fd-arc" startOffset="50%" text-anchor="middle">${L('母星圆形事务管理局', 'HOMEWORLD BUREAU OF ROUND AFFAIRS')}</textPath></text>
  <text fill="#c0281c" font-family='${SERIF.replace(/"/g, '')}' font-weight="700" font-size="${EN ? 8.5 : 10.5}" letter-spacing="${EN ? 1 : 2}"><textPath href="#fd-arc2" startOffset="50%" text-anchor="middle">${L('合同专用章', 'CONTRACT SEAL')}</textPath></text></svg>`;
const SCRAWL = `<svg class="fd-scrawl" viewBox="0 0 140 70" aria-hidden="true"><path d="M12 40c-4-22 26-34 38-16s-8 38-24 30S14 26 40 22M52 44c0-20 24-28 32-12s-6 30-20 24-8-28 12-28M88 42c2-18 22-22 28-8s-8 24-18 18-4-22 12-20c10 2 16 8 20 14" fill="none" stroke="#2f7a28" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PRINT = `<svg viewBox="0 0 60 60" aria-hidden="true"><g fill="none" stroke="#c0281c" stroke-width="2.6" stroke-linecap="round" opacity=".88"><ellipse cx="30" cy="31" rx="21" ry="26" fill="rgba(192,40,28,.16)" stroke="none"/><path d="M14 38c-3-16 4-28 16-28s19 12 16 28"/><path d="M19 42c-3-14 2-25 11-25s14 11 11 25"/><path d="M24 45c-2-11 1-21 6-21s8 10 6 21"/><path d="M29 46c-1-6 0-14 1-14s2 8 1 14"/><path d="M17 50c8 4 18 4 26 0"/></g></svg>`;
const HANDSVG = `<svg class="fd-hand" viewBox="0 0 120 104" aria-hidden="true"><g fill="none" stroke-linecap="round"><path d="M-10 -6L66 60" stroke="#4f9c33" stroke-width="30"/><path d="M-10 -6L66 60" stroke="#93e85a" stroke-width="23"/><path d="M68 58l30-6M70 64l26 16M62 68l8 30" stroke="#4f9c33" stroke-width="17"/><path d="M68 58l30-6M70 64l26 16M62 68l8 30" stroke="#93e85a" stroke-width="11"/></g></svg>`;

function openContract(round) {
  phase = 'contract';
  const no = contractNo(), now = new Date(), orders = Y.ORDER.length, shifts = X.CHAPS.length, name0 = X.NAME || FL.name || '';
  const date = EN ? now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const trial = round ? L(`乙方试工一单，圆度 ${pct(round)}，甲方点了点头，决定雇用。`, `The Artisan completed one trial order at ${pct(round)} roundness. The Client nodded and decided to hire.`) : L('乙方试工合格，甲方决定雇用。', 'The Artisan passed the trial and the Client decided to hire.');
  const layer = document.createElement('div'); layer.id = 'flow-deal'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-labelledby', 'fd-title');
  layer.innerHTML = `
  <article class="fd-paper">
    ${HANDSVG}
    <p class="fd-no">${L('合同编号：圆字第 ' + no + ' 号', 'Contract No. R-' + no)}</p>
    <h2 class="fd-title" id="fd-title">${L('劳务合同', 'Employment Contract')}</h2>
    <p class="fd-sub">${L('EMPLOYMENT CONTRACT', '劳 务 合 同')}</p>
    <div class="fd-parties">
      <p><b>${L('甲方（雇主）：', 'Party A (the Client): ')}</b>${L('母星甲方', 'The Client, Homeworld')}</p>
      <p><b>${L('乙方（工匠）：', 'Party B (the Artisan): ')}</b><span class="fd-who" data-who-mirror>${escH(name0) || '&nbsp;'}</span>${L('，地球', ', Earth')}</p>
    </div>
    <p class="fd-lead">${trial}${L('双方订立条款如下：', ' The parties agree as follows:')}</p>
    <ol class="fd-terms">
      <li><b>${L('第一条　工作内容', '1. Work.')}</b>${L(`甲方送来什么，乙方就把什么做成圆的。共 ${orders} 单，分 ${shifts} 班。`, `Whatever the Client sends, the Artisan makes round. ${orders} orders in ${shifts} shifts.`)}</li>
      <li><b>${L('第二条　验收标准', '2. Acceptance.')}</b>${L('每单圆度不低于达标线，并在甲方耐心耗尽之前交货。', "Each order must reach its roundness target before the Client's patience runs out.")}</li>
      <li><b>${L('第三条　酬劳', '3. Pay.')}</b>${L('达标即付，以 ◎ 结算。越圆、越快，给得越多。', 'Paid on delivery, in ◎. Rounder and faster pays more.')}</li>
      <li><b>${L('第四条　违约责任', '4. Breach.')}</b>${L('乙方完不成任务的，由<em>乙方本人被做成圆形</em>，抵作该单货物。', 'If the Artisan fails an order, <em>the Artisan will be made round</em> in place of the goods.')}<span class="fd-note">${L('← 这条是认真的', '← we mean it')}</span></li>
      <li><b>${L('第五条　档案', '5. Records.')}</b>${X.CLOUD
        ? L('乙方的签名就是存档名，连同每单最高酬劳存入甲方档案室（服务器）。换设备签同一个名字，可以接着干。', "The signature is the Artisan's save name, kept on the Client's server with the best pay per order. Sign the same name on another device to continue.")
        : L('乙方的签名就是存档名。现在是离线打开，签名只记在这台设备上。', "The signature is the Artisan's save name. This copy is running offline, so it is kept on this device only.")}</li>
    </ol>
    <p class="fd-fine">${L('本合同自乙方签字之时生效。乙方人已在母星，无权拒签。', 'This contract takes effect upon signature. The Artisan is already on the homeworld and may not decline.')}</p>
    <form class="fd-sign" autocomplete="off" novalidate>
      <div class="fd-a"><span>${L('甲方（盖章）：', 'Party A (seal):')}</span>${SEAL()}${SCRAWL}</div>
      <div class="fd-b">
        <label for="fd-name">${L('乙方（签字）：', 'Party B (signature):')}</label>
        <div class="fd-line">
          <input id="fd-name" name="sign" maxlength="16" autocomplete="nickname" enterkeyhint="done" spellcheck="false" autocapitalize="off" placeholder="${L('在这里写下名字', 'Write your name here')}" value="${escH(name0)}">
          <button class="fd-thumb" type="submit" aria-label="${L('按手印，签下合同', 'Press your thumbprint to sign')}"><span>${L('按<br>手印', 'thumb<br>print')}</span>${PRINT}</button>
          <i class="fd-flag" aria-hidden="true">${L('签这里', 'Sign here')}</i>
        </div>
        <p class="fd-msg" role="alert"></p>
      </div>
      <p class="fd-date">${L('签于母星 · ', 'Signed on the homeworld, ')}${date}</p>
    </form>
  </article>`;
  document.body.appendChild(layer);
  const paper = layer.querySelector('.fd-paper'), form = layer.querySelector('form'), input = layer.querySelector('#fd-name'), thumb = layer.querySelector('.fd-thumb');
  const msg = layer.querySelector('.fd-msg'), mirror = layer.querySelector('[data-who-mirror]'), flag = layer.querySelector('.fd-flag'), line = layer.querySelector('.fd-line');
  X.sfx.ui();
  // 从甲方的舷窗里递出来
  const fly = (out) => {
    const a = alienPoint(), rc = paper.getBoundingClientRect(), dx = a.x - (rc.left + rc.width / 2), dy = a.y - (rc.top + rc.height * .4);
    const far = { transform: `translate(${dx}px, ${dy}px) rotate(-34deg) scale(.05)`, opacity: .3 }, near = { transform: 'translate(0, 0) rotate(-.7deg) scale(1)', opacity: 1 };
    try { return paper.animate(out ? [near, far] : [far, near], { duration: REDUCED ? 1 : out ? 520 : 760, easing: out ? 'cubic-bezier(.5,0,.9,.4)' : 'cubic-bezier(.16,.9,.3,1)', fill: out ? 'forwards' : 'none' }); } catch (e) { return null; }
  };
  fly(false);
  // 纸比屏幕长的时候：底下一个小标签带人翻到签字的地方
  let more = null;
  const needMore = () => line.getBoundingClientRect().bottom > innerHeight - 22;
  setTimeout(() => {
    if (!layer.isConnected || !needMore()) return;
    more = document.createElement('button'); more.type = 'button'; more.className = 'fd-more'; more.textContent = L('↓ 签字在最后', '↓ Signature at the end');
    more.addEventListener('click', () => layer.scrollTo({ top: layer.scrollHeight, behavior: REDUCED ? 'auto' : 'smooth' }));
    layer.appendChild(more);
    layer.addEventListener('scroll', () => { if (more && !needMore()) { more.remove(); more = null; } }, { passive: true });
  }, 900);
  if (!TOUCH) setTimeout(() => { if (layer.isConnected && !busy && !signedOff) try { input.focus({ preventScroll: true }); const n = input.value.length; input.setSelectionRange(n, n); } catch (e) {} }, 820);   // 手机上不自动弹键盘，先让人看合同
  // 名字长了就把字写小一点，别让开头被挤出横线（不小于 16px，免得 iOS 一聚焦就放大页面）
  const fit = () => { input.style.fontSize = ''; let fs = parseFloat(getComputedStyle(input).fontSize) || 27; while (fs > 16 && input.scrollWidth > input.clientWidth + 1) { fs -= 1; input.style.fontSize = fs + 'px'; } };
  fit();
  input.addEventListener('input', () => { mirror.textContent = input.value.trim() || '\u00a0'; msg.textContent = ''; fit(); });
  let busy = false, signedOff = false;
  const refuse = (text) => {
    msg.textContent = text; line.classList.remove('fd-shake'); void line.offsetWidth; line.classList.add('fd-shake');
    try { input.focus(); } catch (e) {}
  };
  const finish = (name, how) => {
    signedOff = true; FL.signed = 1; FL.name = name; saveFL();
    input.value = name; mirror.textContent = name; fit(); input.disabled = true; thumb.disabled = true; thumb.classList.add('done'); flag.remove(); if (more) { more.remove(); more = null; }
    msg.textContent = '';
    X.sfx.thud(1); setTimeout(() => { X.sfx.thud(1); X.sfx.win(); paper.insertAdjacentHTML('beforeend', `<div class="fd-stamp" aria-hidden="true">${L('合同<br>生效', 'IN<br>EFFECT')}</div>`); }, 380);
    setTimeout(() => {
      const an = fly(true); layer.classList.add('out');
      const gone = () => { layer.remove(); showChoice(name, how, no); };
      if (an && an.finished) an.finished.then(gone, gone); else setTimeout(gone, 480);
    }, 1750);
  };
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy || signedOff) return;
    X.audioInit();
    const name = cleanName(input.value);
    if (!name) { X.sfx.thud(.6); return refuse(L('乙方无权拒签。请签上名字。', 'The Artisan may not decline. Please sign.')); }
    if ([...name].length > 16 || (NAME_OK && !NAME_OK.test(name))) { X.sfx.thud(.6); return refuse(L('名字只能用文字、数字、空格和 - _ · .，最多 16 个字。', 'Names can use letters, numbers, spaces and - _ · . (16 max).')); }
    if (!X.CLOUD) return finish(name, 'offline');   // file:// 打开：没有云存档，签名只记在本机
    busy = true; input.disabled = true; thumb.disabled = true; msg.textContent = L('归档中…', 'Filing…');
    X.WHO.err = '';
    await Promise.race([X.setName(name), new Promise(r => setTimeout(r, 7000))]).catch(() => {});
    busy = false;
    const err = X.WHO.err; X.WHO.err = '';
    if (X.NAME && X.NAME.toLowerCase() === name.toLowerCase()) return finish(X.NAME, 'cloud');
    if (err && /16/.test(err)) { input.disabled = false; thumb.disabled = false; X.sfx.thud(.6); return refuse(err); }   // 服务器说名字不合规
    // 存档服务连不上：先在本机签了，名字留在 yuan.name 里，下次打开时游戏会自己补存
    try { localStorage.setItem('yuan.name', name); } catch (e2) {}
    finish(name, 'later');
  });
}

/* 签完：两个去处。下一关最大，排在第一个，所以空格 / 回车也是它 */
function showChoice(name, how, no) {
  phase = 'idle';
  G.idx = 0; G.loop = 0; G.score = 0; G.done = 0; X.setupRound(); G.state = 'menu'; G.mood = 'happy'; G.moodT = G.time + 4;
  const at = X.firstOpen(), mat = Y.MATS[Y.ORDER[at]];
  const note = how === 'later' ? L('存档服务这会儿连不上，签名先记在这台设备上，下次打开会自动补存。', 'The save server is unreachable right now. Your signature is kept on this device and will sync next time you open the game.')
    : how === 'offline' ? L('现在是离线打开，签名只记在这台设备上。', 'Running offline: your signature is kept on this device only.') : '';
  X.setCard(`
    <p class="eyebrow">${L('合同生效 · 圆字第 ' + no + ' 号', 'Contract R-' + no + ' in effect')}</p>
    <h2>${L(`签好了，${escH(name)}。开工吧`, `Signed, ${escH(name)}. Get to work`)}</h2>
    <p>${L(`一共 <strong>${Y.ORDER.length} 单</strong>，分 ${X.CHAPS.length} 班。完不成会怎样，合同第四条写着。`, `<strong>${Y.ORDER.length} orders</strong> in ${X.CHAPS.length} shifts. What happens if you fail is in clause 4.`)}</p>
    <div class="flow-go">
      <button class="btn flow-big" type="button" data-act="resume">${L('下一关', 'Next level')}<small>${L(`第 ${at + 1} 单 · ${mat ? mat.name : ''}`, `Order ${at + 1} · ${mat ? mat.name : ''}`)}</small></button>
      <button class="btn ghost" type="button" data-act="${escH(CONFIG.collectionAct)}">${L('去收藏室选关', 'Collection room')}</button>
    </div>
    ${note ? `<p class="note">${note}</p>` : ''}`);
}

/* ---------- 开始 ---------- */
function begin(replay) {
  ran = true;
  X.audioInit(); X.sfx.ui();
  card.innerHTML = ''; overlay.hidden = true; stage.classList.remove('cover'); deliverBtn.hidden = true;
  G.idx = 0; G.loop = 0; G.score = 0; G.done = 0; X.setupRound(); G.state = 'flow';   // 游戏不认识的状态：照常画场景，但不能拎、不计时
  if (!replay && !FORCED && FL.tut && !FL.signed) {   // 上次过了新手关没签字就走了：直接接着签
    phase = 'handoff';
    G.bubble = { text: L('合同还没签呢，地球人。', 'You have not signed yet, Earthling.'), t0: G.time, dur: 3, lines: null };
    setTimeout(() => openContract(0), 1100);
    return;
  }
  playCutscene(startTutorial);
}

/* ---------- 抢在游戏前面的事件监听（捕获阶段） ---------- */
window.addEventListener('pointerdown', e => {
  if (phase === 'idle' && G.state === 'cover' && e.target === cv && wantIntro()) { e.preventDefault(); e.stopImmediatePropagation(); begin(false); }
}, true);
window.addEventListener('keydown', e => {
  if (phase === 'idle') {
    if (G.state !== 'cover' || !wantIntro() || e.metaKey || e.ctrlKey || e.altKey || document.activeElement === muteBtn) return;
    if (document.activeElement === langBtn) { e.stopImmediatePropagation(); return; }   // 焦点在语言按钮上：让按钮自己响应
    e.preventDefault(); e.stopImmediatePropagation(); begin(false); return;
  }
  if (phase === 'cutscene') {
    e.stopImmediatePropagation();
    if ((e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); if (cutSkip) cutSkip(); }
    return;
  }
  if (phase === 'tutorial') {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (T) { if (e.code === 'KeyA' || e.code === 'ArrowLeft') T.keyL = true; else if (e.code === 'KeyD' || e.code === 'ArrowRight') T.keyR = true; }
    if (e.code === 'Space' || e.code === 'Enter') {
      const el = document.activeElement; if (el && el.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) tryFinish();
    } else if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation(); if (!stage.classList.contains('flow-lock')) quitTutorial();
    } else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) { X.sfx.ui(); newStone(); }
    }
    return;
  }
  // handoff / contract：按键都不给游戏。合同里的输入框和按钮照常工作
  e.stopImmediatePropagation();
  if (phase === 'contract' && (e.code === 'Enter' || e.code === 'Space') && !(e.target && /^(INPUT|BUTTON)$/.test(e.target.tagName))) {
    const i = document.getElementById('fd-name'); if (i && !i.disabled) { e.preventDefault(); i.focus(); }
  }
}, true);
window.addEventListener('keyup', e => {
  if (!T) return;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') T.keyL = false; else if (e.code === 'KeyD' || e.code === 'ArrowRight') T.keyR = false;
}, true);
window.addEventListener('blur', () => { if (T) T.keyL = T.keyR = false; });
stage.addEventListener('click', e => {   // 新手关里的 交货 / 重来 / 回首页：不走游戏原来的逻辑（那边会存档、记数据）
  if (phase !== 'tutorial') return;
  const t = e.target && e.target.closest ? e.target.closest('#deliver, #replay, #home') : null; if (!t) return;
  e.preventDefault(); e.stopImmediatePropagation(); t.blur(); X.audioInit();
  if (t.id === 'deliver') tryFinish(); else if (t.id === 'replay') { X.sfx.ui(); newStone(); } else quitTutorial();
}, true);
window.addEventListener('pagehide', e => { if (phase === 'tutorial') e.stopImmediatePropagation(); }, true);   // 新手关不算“中途放弃了一单”

/* ---------- 首页卡片上的「重看」，封面上的语言切换 ---------- */
const addReplayLink = () => {
  if (phase !== 'idle' || !card.querySelector('h1') || card.querySelector('[data-flow]')) return;
  card.insertAdjacentHTML('beforeend', `<p class="note flow-again"><button class="link" type="button" data-flow="replay">${L('重看开场和新手关', 'Replay the intro and tutorial')}</button></p>`);
};
new MutationObserver(addReplayLink).observe(card, { childList: true });
card.addEventListener('click', e => { const t = e.target && e.target.closest ? e.target.closest('[data-flow="replay"]') : null; if (t && phase === 'idle') begin(true); });
addReplayLink();

// 新玩家要签完合同才见得到首页，语言切换先在封面上放一个
let langBtn = null;
if (wantIntro()) {
  langBtn = document.createElement('button'); langBtn.id = 'flow-lang'; langBtn.type = 'button'; langBtn.lang = EN ? 'zh' : 'en'; langBtn.textContent = EN ? '中文' : 'English';
  langBtn.addEventListener('click', () => Y.act('lang'));
  stage.appendChild(langBtn);
  // 刚切完语言回来时游戏会直接开首页；新玩家退回封面，从点一下开始（声音和播片都要这一下）
  if (G.state === 'menu') { G.state = 'cover'; card.innerHTML = ''; overlay.hidden = true; deliverBtn.hidden = true; stage.classList.add('cover'); }
}

window.__yuanFlowDebug = { CONFIG, TUT, get phase() { return phase; }, begin, geom };
})();
