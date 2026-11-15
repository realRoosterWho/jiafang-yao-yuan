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
/* 声音都走 index.html 里的 sfx（音量、静音、防连发都在那边管）。万一 index.html 是老版本、没有新的那几个，就退回到原来有的 */
const SFX_OLD = { paper: s => s.ui(), press: s => s.thud(1), stamp: s => { s.thud(1); s.win(); }, nope: s => s.thud(.6) };
const S = (name, ...a) => { try { const s = X.sfx || {}; if (s[name]) s[name](...a); else if (SFX_OLD[name]) SFX_OLD[name](s); } catch (e) {} };

/* ---------- 要改的东西都在这里 ---------- */
const CONFIG = {
  video: '',            // 播片做好以后填文件名或完整网址（如 'intro.mp4'）。留空就放下面的占位动画
  placeholderMs: 4200,  // 占位动画总时长，别超过 5 秒
  collectionAct: 'dex' // 「去收藏室看看」点了以后做什么。现在接的是图鉴（act('dex')）；订单簿藏起来了，是开发者入口
};
/* 新手关：一块只有一个凸起的石头。砸不碎、不计时。只教两件事，限制得很死：
   ① 手势：一根手指按住往上拎，另一根手指左右滑把凸起转到朝下（电脑上是 A / D），然后松手。
      抓的时候石头不会自己转（游戏里抓凸起对面会自动把凸起甩到下面，这里关掉了），只能用第二根手指转。
   ② 靠「松手让它自己掉下去」来改形状。拿着往下砸（进阶手法）在新手关里不算数：不触发敲击，只提示一句。
   变形量不走石头原本的数值，而是每一帧按“朝下那一面凸出来多少”现算（见 tuneStone）：
   凸起朝下、从虚线以上掉下去，一下基本就平了；砸在圆的那一面只蹭掉一点点，所以不会越砸越糟。
   lift = 要拎到多高（石头最低点离地板），从这个高度掉下去力度大约 55。 */
const TUT = { R: 84, bump: 34, width: .22, hard: 20, brittle: 150, accel: 24000, target: .85, weak: .65, over: 1.3, aim: .33, lift: 200 };

const G = Y.G, EN = document.documentElement.lang === 'en', L = (zh, en) => EN ? en : zh;
const TOUCH = document.documentElement.classList.contains('touch');
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const $ = id => document.getElementById(id);
const stage = $('stage'), cv = $('cv'), overlay = $('overlay'), card = $('card'), deliverBtn = $('deliver'), muteBtn = $('mute');
if (!stage || !cv || !overlay || !card || !deliverBtn) return;
const TAU = Math.PI * 2, FLOOR = 520, GRAV = 5200, VMAX = 2600;
const C = { space: '#110d2b', hull: '#1e1747', rim: '#5143a0', ink: '#f4f0ff', dim: '#a9a1d6', alien: '#93e85a', coin: '#ffd35c', alarm: '#ff5683' };
const DISPLAY = "Chewy,'Maoken Assorted Sans','ZCOOL KuaiLe','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";   // 跟 index.html 的新界面一样
const BODY = "'Maoken Assorted Sans','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',system-ui,sans-serif";
const NUM = "Chewy,'Maoken Assorted Sans','PingFang SC','Microsoft YaHei',sans-serif";
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
/* 上报：开场流程每走一步发一条 intro 事件 { s: 哪一步, replay: 是不是重看 }，后台据此看新玩家在哪一步走掉。
   新手关里每个阶段（tut_lift 按住了 / tut_turn 拎过虚线 / tut_drop 转好了 / tut_hit 砸中凸起 / tut_ready 够圆了）每次开场只发一次。
   关页面时发 leave { at: 当时在哪一段, st: 新手关卡在哪一步 }。本地打开时游戏的 TRACK 什么都不发 */
let replaying = 0, tutSeen = {}, tutT0 = 0, leaving = false;
const track = (s, d) => { try { if (X.TRACK) X.TRACK('intro', Object.assign({ s, replay: replaying }, d || {})); } catch (e) {} };
const tutOnce = (s, d) => { if (tutSeen[s]) return; tutSeen[s] = 1; track(s, Object.assign({ sec: Math.round((performance.now() - tutT0) / 100) / 10 }, d || {})); };
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
.flow-tut-on #help, .flow-tut-on #replay { visibility: hidden !important; }   /* 新手关：页面底下那行说明和「重来」都收起来 */

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
/* 签名下面两颗小按钮：随便起一个名字 / 不起名，先当访客 */
.fd-alt { display: flex; flex-wrap: wrap; gap: .5em 1.1em; align-items: center; margin-top: 1.5em; }
.fd-alt button { min-height: 40px; padding: .35em .2em; border: 0; background: none; color: #1d2c6e; font: 600 .9em/1.2 ${BODY}; cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: .28em; -webkit-tap-highlight-color: transparent; }
.fd-alt button:hover { color: #b3261e; }
.fd-alt button:focus-visible { outline: 2px solid #1d2c6e; outline-offset: 2px; }
.fd-alt button:disabled { opacity: .4; cursor: default; }
.fd-alt .fd-dice::before { content: '🎲'; margin-right: .3em; text-decoration: none; display: inline-block; }
.fd-alt .fd-dice.roll::before { animation: fdRoll .35s ease-out; }
@keyframes fdRoll { from { transform: rotate(-200deg) scale(.6); } }
.fd-alt .fd-guest { margin-left: auto; color: #6f655a; }
.fd-msg:empty { margin-top: 0 !important; min-height: 0; }
@media (max-width: 560px) {
  .fd-paper { padding: 22px 20px 20px; font-size: 14px; line-height: 1.62; transform: none; }   /* 手机上纸不歪：字更清楚 */
  .fd-title { font-size: 1.8em; }
  /* 签字那一栏占满整行，甲方的章挪到下面跟日期一排 */
  .fd-sign { grid-template-columns: minmax(0, 1fr); gap: 0; margin-top: 1.1em; }
  .fd-b { order: 1; min-height: 0; }
  .fd-a { order: 2; min-height: 6.4em; margin-top: .9em; }
  .fd-date { order: 3; margin-top: -1.7em !important; }
  .fd-seal { left: .2em; top: 1.2em; width: 5.4em; height: 5.4em; }
  .fd-scrawl { left: 2.6em; top: 1.9em; width: 5.4em; }
  .fd-line input { font-size: max(28px, 2em); padding-right: 4em; }
  .fd-thumb { width: 5em; height: 5em; bottom: -1.3em; }   /* 拇指好按 */
  .fd-alt { margin-top: 1.9em; }
  .fd-note { margin-left: .2em; }
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
// 合同用的宋体和手写体：只裁了合同里出现的字，放在 assets/（tools/subset_contract_fonts.py 生成，合同改字要重跑）。
// 浏览器只在合同真的显示出来时才去下；没裁进去的字（比如玩家签的名字）退到系统的楷体 / 宋体
const fontFace = document.createElement('style');
fontFace.textContent = `@font-face { font-family: "Noto Serif SC"; font-weight: 500 700; font-display: swap; src: url(assets/notoserif.66392edeb9.woff2) format("woff2"); }
@font-face { font-family: "Long Cang"; font-weight: 400; font-display: swap; src: url(assets/longcang.b8c5885324.woff2) format("woff2"); }`;
document.head.appendChild(fontFace);

/* ---------- 新手关的石头 ---------- */
Y.MATS.tutor = Object.assign({}, Y.MATS.stone, { hard: TUT.hard, brittle: TUT.brittle, loose: 1, accel: TUT.accel, rough: 0, rnd: null, snd: 'stone', target: TUT.target, talk: null });   // 新手关的石头不说话：画面上只留甲方气泡那一句
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
  if (Y.starLines) { G.lines = Y.starLines(G.target, G.round); G.tier = 0; }   // 星级线按这块石头重算（setupRound 算的是第 1 单的）
  G.idx = -1;   // 界面上显示成“第 0 单”：试工不算在 48 单里
  // 拿着的时候永远不“上膛”：拎着往下砸碰到地板不算一次敲击。松手以后游戏照常上膛，掉下去才算
  const b = G.body; let armed = !!b.armed;
  Object.defineProperty(b, 'armed', { configurable: true, enumerable: true, get() { return armed && !this.held; }, set(v) { armed = !!v && !this.held; } });
  T = { grabbed: false, hit: null, before: G.round, note: null, keyL: false, keyR: false,
    held: false, holdT0: 0, preHeld: false, prevVy: 0, prevClear: 0, slamT: -9, high: false, stage: '', introUntil: 0 };
}
const note = text => { T.note = { text, t: G.time }; };
function startTutorial() {
  phase = 'tutorial'; newStone(); G.state = 'play'; tutSeen = {}; tutT0 = performance.now(); track('tut');
  stage.classList.add('flow-tut'); stage.classList.toggle('flow-lock', !(FL.signed || hasProgress()));
  G.tutUI = true; document.documentElement.classList.add('flow-tut-on');   // 新手关的界面极简：index.html 不画力度表、底部提示和顶栏的小字   // 第一次来不给回首页，重看的时候可以走
  G.mood = 'calm'; G.moodT = 0;
  G.bubble = { text: L('先试工：把它弄圆。', 'Trial run: make it round.'), t0: G.time, dur: 4, lines: null }; T.introUntil = G.time + 2.4; S('alien', 'hi', .2);   // 先说一句，再换成第一步
  cancelAnimationFrame(raf); raf = requestAnimationFrame(tutFrame);
  try { document.fonts.load(`600 17px 'Maoken Assorted Sans'`, HINT_TEXT); } catch (e) {}
}
function stopTutorial() { cancelAnimationFrame(raf); raf = 0; G.tutUI = false; document.documentElement.classList.remove('flow-tut-on'); stage.classList.remove('flow-tut', 'flow-lock'); }
function quitTutorial() {   // 只有重看的时候能走到这里
  stopTutorial(); phase = 'idle'; G.idx = 0; Y.release(); Y.act('restart');
}
function tryFinish() {
  const b = G.body; if (phase !== 'tutorial' || G.state !== 'play' || !b) return;
  if (G.round < G.target) { note(L('还不够圆', 'Not round yet')); S('nope'); return; }
  Y.release(); const round = G.round;
  stopTutorial(); phase = 'handoff'; G.state = 'flow'; deliverBtn.hidden = true;
  S('win'); S('alien', 'hi', .7); G.mood = 'happy'; G.moodT = G.time + 8;
  G.bubble = { text: L('做得不错，地球人。我们决定雇你。', 'Not bad, Earthling. We are hiring you.'), t0: G.time, dur: 3.6, lines: null };
  FL.tut = 1; saveFL(); track('tut_done', { sec: Math.round((performance.now() - tutT0) / 100) / 10 });
  setTimeout(() => openContract(round), 1900);
}

/* 提示文字：玩家嫌字多看不懂，每一步只留一句几个字的话，别的都靠光和摇杆示范。
   这句话由甲方在左上角的气泡里说（新界面的奶油色气泡）：手机上底部那条会被两个大拇指挡住，顶上没人挡。够圆了不说话，交货按钮自己会发光 */
const TXT = {
  grab: L('按住，往上拎', 'Hold & lift'),
  lift: L('往上拎', 'Lift it up'),
  turn: L('把凸起转到下面', 'Turn the bump down'),
  drop: L('松手！', 'Let go!'),
  slam: L('松手，让它自己掉', 'Let go, let it fall'),
  early: L('先转好再松手', 'Turn it first'),
  low: L('再拎高一点', 'Lift higher'),
  miss: L('凸起朝下再松手', 'Bump down first'),
  bump: L('凸起', 'bump')
};
const HINT_TEXT = Object.values(TXT).flat().join('');
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
/* 「凸起」两个字：新界面的小奶油牌子（深棕字、浅金边） */
function tag(c, v, text, x, y) {
  c.font = `600 ${v.PORT ? 17 : 15}px ${BODY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = c.measureText(text).width + 18, h = v.PORT ? 28 : 25;
  rr(c, x - w / 2, y - h / 2, w, h, h / 2); c.fillStyle = '#fff7e3'; c.fill(); c.strokeStyle = '#eacb9f'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#653616'; c.fillText(text, x, y + 1);
}
/* ---------- 光做的引导：不画手，三步各用一种光 ----------
   ① 没拎：石头中心一个亮点，光环一圈圈往外扩（按这里）
   ② 拎着没过线：上面一个发光的石头轮廓（拎到这儿），光环从石头升上去；过线了没对准：手机上在空地画一个虚的摇杆示范（第二根手指按这里、往哪推）
   ③ 拎高也对准了：石头描一圈绿光，绿光环往下落（松手让它掉）
   不再画横穿屏幕的虚线、也不在画面里写字，界面尽量干净 */
const COIN = '255,211,92', GREEN = '147,232,90';
const easeOut = f => 1 - Math.pow(1 - f, 3);
const easeInOut = f => f < .5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
function glowRing(c, x, y, rx, ry, al, rgb) {   // 发光的环：一道宽的淡光 + 一道细的亮线
  if (al <= .01) return;
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU);
  c.lineWidth = 11; c.strokeStyle = `rgba(${rgb},${.16 * al})`; c.stroke();
  c.lineWidth = 3; c.strokeStyle = `rgba(${rgb},${.9 * al})`; c.stroke();
}
function glowSpot(c, x, y, rx, ry, al, rgb) {   // 一团扁的柔光
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, `rgba(${rgb},${.55 * al})`); g.addColorStop(.5, `rgba(${rgb},${.2 * al})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, TAU); c.fill(); c.restore();
}
function outline(c, b, pad) {   // 石头的轮廓往外放 pad
  const n = b.r.length, dphi = TAU / n; c.beginPath();
  for (let i = 0; i < n; i += 2) { const a = b.a + i * dphi, r = b.r[i] + pad, x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.closePath();
}
function lightPress(c, b, t) {
  const R = b.meanR, g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * 1.3);
  g.addColorStop(0, `rgba(${COIN},.3)`); g.addColorStop(.6, `rgba(${COIN},.08)`); g.addColorStop(1, `rgba(${COIN},0)`);
  c.fillStyle = g; c.beginPath(); c.arc(b.x, b.y, R * 1.3, 0, TAU); c.fill();
  for (let k = 0; k < 2; k++) { const f = (t * .7 + k / 2) % 1, r = R * .2 + (R * .85 + 44) * easeOut(f); glowRing(c, b.x, b.y, r, r, Math.min(1, f * 5) * Math.pow(1 - f, 1.3), COIN); }
  const p = .5 + .5 * Math.sin(t * 4.4); c.fillStyle = `rgba(255,240,190,${.6 + .3 * p})`; c.beginPath(); c.arc(b.x, b.y, 6 + 3 * p, 0, TAU); c.fill();
}
function lightRise(c, b, t) {   // 要拎到的高度上一个发光的石头轮廓（拎到这儿），光环从石头一圈圈升上去
  const d = TUT.lift - b.clear + 6; if (d < 6) return;
  const p = .5 + .5 * Math.sin(t * 4), bx = b.x, by = b.y;
  c.save(); c.translate(0, -d);
  outline(c, b, 2); c.fillStyle = `rgba(${COIN},${.05 + .05 * p})`; c.fill();
  c.lineWidth = 12; c.strokeStyle = `rgba(${COIN},${.1 + .1 * p})`; c.stroke(); c.setLineDash([10, 9]); c.lineDashOffset = -t * 20;
  c.lineWidth = 2.5; c.strokeStyle = `rgba(${COIN},${.5 + .35 * p})`; c.stroke(); c.setLineDash([]);
  c.restore();
  const rx = b.meanR * .8, ry = rx * .24;
  for (let k = 0; k < 2; k++) { const f = (t * .8 + k / 2) % 1; glowRing(c, bx, by - d * easeOut(f), rx, ry, Math.min(1, f * 4) * (1 - f), COIN); }
}
function lightDrop(c, b, t) {
  const p = .5 + .5 * Math.sin(t * 6);
  outline(c, b, 7); c.lineWidth = 12; c.strokeStyle = `rgba(${GREEN},${.12 + .12 * p})`; c.stroke(); c.lineWidth = 3; c.strokeStyle = `rgba(${GREEN},${.55 + .35 * p})`; c.stroke();
  const y0 = FLOOR - b.clear + 6, d = FLOOR - y0, rx = b.meanR * .6; if (d < 10) return;
  for (let k = 0; k < 2; k++) { const f = (t * 1.1 + k / 2) % 1; glowRing(c, b.lowX, y0 + d * f * f, rx * (1 - .25 * f), rx * .22 * (1 - .25 * f), Math.pow(Math.sin(Math.PI * f), .7), GREEN); }
}
/* 摇杆在这块屏幕上的比例：画面单位 / CSS 像素（跟 index.html 里真摇杆一样大） */
const joyScale = v => { const w = cv.getBoundingClientRect().width; return w ? v.VW / w : 1; };
/* 手机、第二根手指还没按下：在石头下面、地板上方那片空地画一只虚的手指来回拨（石头拎过线了，这里一定空着；石头偏到一边时往另一边让）。
   先按下（一圈光），再往该拨的那边滑，刻度跟着走；同时石头身上亮起它会转的方向。一遍遍重复，不写字 */
function ghostJoy(c, v, b, push, t) {
  const s = joyScale(v), kr = X.JOY_KNOB * s, R = 70 * s, half = R + kr + 20, mid = v.CAMX + v.VW / 2;
  const x0 = clamp(mid + (mid - b.x) * .6, v.CAMX + half, v.CAMX + v.VW - half), y = FLOOR - 55;
  const u = (t % 2) / 2, k = u < .15 ? 0 : u < .55 ? easeInOut((u - .15) / .4) : u < .8 ? 1 : 1 - easeOut((u - .8) / .2);
  const x = x0 - push * R / 2 + k * push * R, alpha = u < .8 ? .75 : .75 * (1 - (u - .8) / .2);
  if (u < .2) { const f = u / .2, r = kr * (1 + 1.2 * easeOut(f)); glowRing(c, x0 - push * R / 2, y, r, r, 1 - f, COIN); }
  glowSpot(c, x, y, kr * 1.4, kr * 1.4, .25 + .3 * alpha, COIN);
  X.joyDraw(x, y, k * push * R / s, s, alpha);
  if (u >= .15 && u < .8 && X.turnArc) X.turnArc(b, push * (X.JOY_DIR || 1), .8);
}
/* 第二根手指按下了、但没往对的方向拨：手指旁边一串小箭头往该拨的那头流 */
function joyNudge(c, v, joy, push, t) {
  if (joy.dir * push > 0) return;
  const s = joy.s;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 3.2 * s;
  for (let k = 0; k < 3; k++) {
    const f = (t * 1.3 + k / 3) % 1, x = joy.x + push * (40 + 60 * f) * s;
    c.strokeStyle = `rgba(${COIN},${.95 * Math.sin(Math.PI * f)})`; c.beginPath(); c.moveTo(x - push * 5 * s, joy.y - 7 * s); c.lineTo(x + push * 2 * s, joy.y); c.lineTo(x - push * 5 * s, joy.y + 7 * s); c.stroke();
  }
  c.restore();
}
/* 拎过虚线了没有。过线以后往下掉一点（转的时候手会晃）还算，免得提示来回跳 */
const isHigh = b => b.held && T.high;
function drawHints(b, g, ready) {
  const v = X.view, c = Y.ctx, t = G.time;
  c.save(); c.setTransform(v.scale, 0, 0, v.scale, 0, 0); c.translate(-v.CAMX, v.TOP); c.lineJoin = 'round'; c.lineCap = 'round';
  const bumpy = g.hgt > 7, aligned = !bumpy || Math.abs(g.err) < TUT.aim, high = isHigh(b);
  if (!ready && bumpy) {
    // 凸起上挂一块小牌子
    if (!(b.held && aligned)) tag(c, v, TXT.bump, b.x + Math.cos(g.ang) * (g.rmax + 26), b.y + Math.sin(g.ang) * (g.rmax + 26));   // 对准以后石头描绿光，牌子让开
    // 拎高了、还没对准：从凸起到正下方的弧形箭头
    if (!aligned && high) {
      const dir = g.err > 0 ? 1 : -1, R = b.meanR + 44, a0 = g.ang + dir * .3, a1 = Math.PI / 2 - dir * .05;
      if (dir * wrapPi(a1 - a0) > .12 || Math.abs(g.err) > 2.6) {
        c.strokeStyle = C.coin; c.lineWidth = 4; c.globalAlpha = .9; c.setLineDash([2, 11]); c.lineDashOffset = -dir * t * 40;
        c.beginPath(); c.arc(b.x, b.y, R, a0, a1, dir < 0); c.stroke(); c.setLineDash([]);
        const ex = b.x + Math.cos(a1) * R, ey = b.y + Math.sin(a1) * R, tx = -Math.sin(a1) * dir, ty = Math.cos(a1) * dir;
        c.fillStyle = C.coin; c.beginPath(); c.moveTo(ex + tx * 13, ey + ty * 13); c.lineTo(ex - tx * 7 + ty * 10, ey - ty * 7 - tx * 10); c.lineTo(ex - tx * 7 - ty * 10, ey - ty * 7 + tx * 10); c.closePath(); c.fill(); c.globalAlpha = 1;
      }
    }
  }
  if (!ready && !b.held) lightPress(c, b, t);   // ① 没拎着：按这里
  if (!ready && b.held && !high) lightRise(c, b, t);              // ① 拎着还没过线：拎到这儿
  if (!ready && b.held && aligned && high) lightDrop(c, b, t);     // ③ 拎高了也对准了：松手让它掉
  if (TOUCH && !ready && high && !aligned) {   // ② 手机：第二根手指还没按就画虚手指拨的示范；按下了拨反了就在手指旁指方向
    const joy = X.joy, push = (g.err > 0 ? 1 : -1) * (X.JOY_DIR || 1);   // 凸起要顺时针转（err > 0）手指就往 JOY_DIR 那边拨
    if (joy) joyNudge(c, v, joy, push, t); else ghostJoy(c, v, b, push, t);
  }
  if (!TOUCH && b.held && !ready && X.kit) {   // 电脑：石头两边贴新界面的 A / D 键图标，该按的那个一跳一跳，正在按的压下去
    const gap = b.meanR + 64, lo = v.CAMX + 40, hi = 880 - 40, y = clamp(b.y, 96, FLOOR - 40), need = !aligned ? (g.err > 0 ? 'R' : 'L') : '';
    for (const [k, x, on] of [['L', clamp(b.x - gap, lo, hi), T.keyL], ['R', clamp(b.x + gap, lo, hi), T.keyR]]) {
      const want = need === k && !on, z = on ? .9 : want ? 1.08 + .08 * Math.sin(t * 8) : 1, s2 = 46 * z;
      c.globalAlpha = on || want ? 1 : .55; X.kit(k === 'L' ? 'keyA' : 'keyD', x - s2 / 2, y - s2 / 2, s2, s2); c.globalAlpha = 1;
    }
  }
  c.restore();
}
function tutFrame() {
  raf = requestAnimationFrame(tutFrame);
  const b = G.body; if (phase !== 'tutorial' || G.state !== 'play' || !b || b.id !== 'tutor') return;
  try {
    G.started = false; G.timeLeft = G.timeMax; G.hp = b.mat.hp;   // 不计时、砸不坏
    const g = geom(b), bumpy = g.hgt > 7, aligned = !bumpy || Math.abs(g.err) < TUT.aim, ready = G.round >= G.target;
    if (b.held) {
      if (!T.held) { T.held = true; T.high = false; T.holdT0 = G.time; }
      T.grabbed = true;
      const wasHigh = T.high;
      if (b.clear >= TUT.lift) T.high = true; else if (b.clear < TUT.lift - 40) T.high = false;
      T.rose = T.high && !wasHigh;
      // 拎着往下砸到地板：不算数（armed 拦住了），提示一句
      if (T.prevClear > 20 && b.clear < 1 && T.prevVy > 420 && G.time - T.slamT > 1) { T.slamT = G.time; X.sfx.thud(.25); if (!ready) note(TXT.slam); }
    } else if (T.held) {   // 刚松手
      T.held = false;
      if (!ready && bumpy && G.time - T.holdT0 > .35) {
        if (!aligned) note(TXT.early);
        else if (!T.high) note(TXT.low);
      }
    }
    T.prevVy = b.vy; T.prevClear = b.clear;
    if (G.lastHit && G.lastHit !== T.hit) {   // 刚掉下去砸了一下
      T.hit = G.lastHit; const gain = G.round - T.before;
      if (T.hit.kind === 'light') { if (!ready) note(TXT.low); }
      else if (gain > .02) tutOnce('tut_hit');   // 砸中了（一下就够圆的那下也算）：圆度条自己会涨，不再说话
      else if (!ready && gain < .006) note(TXT.miss);
    }
    T.before = G.round;
    // 现在卡在哪一步（press 没拎 / lift 拎着没过线 / turn 过线没转好 / drop 转好了该松手 / '' 够圆了），第一次走到就上报
    const st = ready ? '' : !b.held ? 'press' : !T.high ? 'lift' : !aligned ? 'turn' : 'drop';
    if (st === 'drop' && T.stage !== 'drop') S('aim'); else if (T.rose && st) S('line');   // 转好了可以松手：一声；只是拎够高了：另一声
    T.rose = false;
    if (st !== T.stage) { T.stage = st; if (st && st !== 'press') tutOnce('tut_' + st); else if (!st) tutOnce('tut_ready'); }
    // 甲方的气泡说这一步该干嘛（游戏自己插的话会被盖掉，新手关里只听这一句）；够圆了不说话，新界面的交货按钮自己会发光
    const flash = T.note && G.time - T.note.t < 2.6 ? T.note.text : '';
    const line = ready ? '' : flash || (st === 'press' ? TXT.grab : st === 'lift' ? TXT.lift : st === 'turn' ? TXT.turn : TXT.drop);
    if (line && (T.grabbed || G.time > T.introUntil)) { if (!G.bubble || G.bubble.text !== line) G.bubble = { text: line, t0: G.time, dur: 900, lines: null, tut: 1 }; }
    else if (!line && G.bubble && G.bubble.tut) G.bubble = null;
    tuneStone(b, g); drawHints(b, g, ready);
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
  let skipped = false;
  const end = () => {
    if (over) return; over = true; cutSkip = null; timers.forEach(clearTimeout); try { if (X.sndHush) X.sndHush('cut'); } catch (e) {}
    track('cut_end', { skip: skipped ? 1 : 0, sec: Math.round((performance.now() - t0) / 100) / 10 });
    if (video) { try { video.pause(); } catch (e) {} }
    el.classList.add('out'); setTimeout(() => el.remove(), 320); done();
  };
  cutSkip = () => { if (performance.now() - t0 > 350) { X.sfx.ui(); skipped = true; end(); } };   // 刚点完封面的那一下不算跳过
  el.querySelector('.fc-skip').addEventListener('click', cutSkip);
  const placeholder = () => {
    if (video) { video.remove(); video = null; }
    const d = clamp(CONFIG.placeholderMs, 900, 5000) / SHOTS.length;
    el.classList.add('fc-bars');
    el.insertAdjacentHTML('afterbegin', SHOTS.map(s => `<div class="fc-shot"><svg viewBox="0 0 960 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="960" height="600" fill="#0a0722"/><g transform="translate(0 -44)">${s.svg}</g></svg><p class="fc-cap">${s.cap}</p></div>`).join('') + `<span class="fc-tag">${L('播片占位', 'Cutscene placeholder')}</span><i class="fc-prog"></i>`);
    const shots = el.querySelectorAll('.fc-shot');
    shots.forEach((s, i) => timers.push(setTimeout(() => { shots.forEach(o => o.classList.toggle('on', o === s)); S('cut', i); }, i * d + 20)));   // 每个镜头一小段声音（换成真视频就用视频自己的声音）
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
/* 随便起一个名字：圆东西 + 三位数。名字就是存档名，撞上别人的名字会接着别人的进度，所以带上数字，撞的概率很小 */
const RND_ZH = [['圆滚滚的', '软乎乎的', '迷糊的', '认真的', '困困的', '胖嘟嘟的', '亮晶晶的', '慢吞吞的', '不太圆的', '倔强的', '咕噜噜的', '没睡醒的'],
  ['汤圆', '土豆', '西瓜', '丸子', '鹅卵石', '月饼', '包子', '豌豆', '弹珠', '毛线球', '橘子', '饭团']];
const RND_EN = [['Wobbly', 'Lumpy', 'Bouncy', 'Squishy', 'Sleepy', 'Shiny', 'Fuzzy', 'Plump', 'Dizzy', 'Stubby', 'Comfy', 'Grumpy'],
  ['Potato', 'Pebble', 'Bagel', 'Melon', 'Muffin', 'Donut', 'Pea', 'Moon', 'Marble', 'Bun', 'Plum', 'Mochi']];
const pick = a => a[Math.floor(Math.random() * a.length)];
function randomName(prev) {
  for (let i = 0; i < 20; i++) {
    const [adj, noun] = EN ? RND_EN : RND_ZH, n = 100 + Math.floor(Math.random() * 900);
    const s = EN ? `${pick(adj)} ${pick(noun)} ${n}` : `${pick(adj)}${pick(noun)}${n}`;
    if ([...s].length <= 16 && s !== prev) return s;
  }
  return EN ? 'Round Bun ' + (100 + Math.floor(Math.random() * 900)) : '汤圆' + (100 + Math.floor(Math.random() * 900));
}
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

// 游戏顺序是「冒险模式 + 剩下的关卡」（index.html 里的 PARTS）；老版本没有 PARTS 时全算冒险模式
const parts = () => { const p = X.PARTS && X.PARTS[0], n = Y.ORDER.length, a = p ? p.to - p.from : n; return { advN: a, restN: n - a }; };
function openContract(round) {
  phase = 'contract'; track('contract');
  const no = contractNo(), now = new Date(), orders = Y.ORDER.length, name0 = X.NAME || FL.name || '';
  const { advN, restN } = parts();
  const date = EN ? now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const trial = round ? L(`乙方试工圆度 ${pct(round)}，甲方决定雇用。`, `Trial order: ${pct(round)} round. The Client decided to hire.`) : L('乙方试工合格，甲方决定雇用。', 'The Artisan passed the trial. The Client decided to hire.');
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
    <p class="fd-lead">${trial}</p>
    <ol class="fd-terms">
      <li><b>${L('第一条　工作', '1. Work.')}</b>${L(`甲方送来什么，乙方就做圆什么。先做冒险模式 ${advN} 单，之后加班到撑不住为止。`, `Make round whatever the Client sends: ${advN} adventure orders, then overtime until you give out.`)}</li>
      <li><b>${L('第二条　酬劳', '2. Pay.')}</b>${L('耐心耗尽前达标就付 ◎，越圆越快给得越多。', 'Hit the target before patience runs out to get paid in ◎. Rounder and faster pays more.')}</li>
      <li><b>${L('第三条　违约', '3. Breach.')}</b>${L('完不成的，<em>乙方本人被做成圆形</em>。', 'Fail, and <em>you will be made round</em>.')}<span class="fd-note">${L('← 认真的', '← we mean it')}</span></li>
      <li><b>${L('第四条　档案', '4. Records.')}</b>${X.CLOUD
        ? L('签名就是存档名，换设备签同一个名字接着干。', 'Your signature is your save name. Sign the same name on any device to continue.')
        : L('签名就是存档名。现在是离线打开，只记在这台设备上。', 'Your signature is your save name. Offline: kept on this device only.')}</li>
    </ol>
    <p class="fd-fine">${L('签字即生效。乙方已在母星，无权拒签。', 'Effective on signature. You are already on the homeworld and may not decline.')}</p>
    <form class="fd-sign" autocomplete="off" novalidate>
      <div class="fd-a"><span>${L('甲方（盖章）：', 'Party A (seal):')}</span>${SEAL()}${SCRAWL}</div>
      <div class="fd-b">
        <label for="fd-name">${L('乙方（签字）：', 'Party B (signature):')}</label>
        <div class="fd-line">
          <input id="fd-name" name="sign" maxlength="16" autocomplete="nickname" enterkeyhint="done" spellcheck="false" autocapitalize="off" placeholder="${L('在这里写下名字', 'Write your name here')}" value="${escH(name0)}">
          <button class="fd-thumb" type="submit" aria-label="${L('按手印，签下合同', 'Press your thumbprint to sign')}"><span>${L('按<br>手印', 'thumb<br>print')}</span>${PRINT}</button>
          <i class="fd-flag" aria-hidden="true">${L('签这里', 'Sign here')}</i>
        </div>
        <div class="fd-alt">
          <button class="fd-dice" type="button">${L('随便起一个', 'Random name')}</button>
          ${X.NAME ? '' : `<button class="fd-guest" type="button">${L('先不签名，当访客 →', 'Continue as guest →')}</button>`}
        </div>
        <p class="fd-msg" role="alert"></p>
      </div>
      <p class="fd-date">${L('签于母星 · ', 'Signed on the homeworld, ')}${date}</p>
    </form>
  </article>`;
  document.body.appendChild(layer);
  const paper = layer.querySelector('.fd-paper'), form = layer.querySelector('form'), input = layer.querySelector('#fd-name'), thumb = layer.querySelector('.fd-thumb');
  const msg = layer.querySelector('.fd-msg'), mirror = layer.querySelector('[data-who-mirror]'), flag = layer.querySelector('.fd-flag'), line = layer.querySelector('.fd-line');
  S('paper');
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
  const dice = layer.querySelector('.fd-dice'), guest = layer.querySelector('.fd-guest');
  const lock = on => { input.disabled = on; thumb.disabled = on; dice.disabled = on; if (guest) guest.disabled = on; };
  dice.addEventListener('click', () => {
    if (busy || signedOff) return;
    X.audioInit(); S('ui');
    input.value = randomName(input.value); mirror.textContent = input.value; msg.textContent = ''; fit();
    dice.classList.remove('roll'); void dice.offsetWidth; dice.classList.add('roll');
    track('rndname');
  });
  // 当访客：不起名字，进度只记在这台设备上（首页随时可以再起名字存到云端）
  if (guest) guest.addEventListener('click', () => {
    if (busy || signedOff) return;
    X.audioInit();
    finish('', 'guest');
  });
  // 手机上点输入框弹出键盘：把签字那块挪到看得见的地方
  if (TOUCH) input.addEventListener('focus', () => setTimeout(() => { try { line.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' }); } catch (e) {} }, 320));
  const finish = (name, how) => {
    signedOff = true; FL.signed = 1; FL.name = name; saveFL(); track('signed', { how });
    const shown = name || L('访客', 'Guest');
    input.value = shown; mirror.textContent = shown; fit(); lock(true); thumb.classList.add('done'); flag.remove(); if (more) { more.remove(); more = null; }
    msg.textContent = '';
    S('press'); setTimeout(() => { S('stamp'); paper.insertAdjacentHTML('beforeend', `<div class="fd-stamp" aria-hidden="true">${L('合同<br>生效', 'IN<br>EFFECT')}</div>`); }, 380);
    setTimeout(() => {
      const an = fly(true); layer.classList.add('out'); S('paper', true);
      const gone = () => { layer.remove(); showChoice(name, how, no); };
      if (an && an.finished) an.finished.then(gone, gone); else setTimeout(gone, 480);
    }, 1750);
  };
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy || signedOff) return;
    X.audioInit();
    const name = cleanName(input.value);
    if (!name) { S('nope'); return refuse(guest ? L('乙方无权拒签。签个名字，或者先当访客。', 'You may not decline. Sign a name, or continue as guest.') : L('乙方无权拒签。请签上名字。', 'The Artisan may not decline. Please sign.')); }
    if ([...name].length > 16 || (NAME_OK && !NAME_OK.test(name))) { S('nope'); return refuse(L('名字只能用文字、数字、空格和 - _ · .，最多 16 个字。', 'Names can use letters, numbers, spaces and - _ · . (16 max).')); }
    if (!X.CLOUD) return finish(name, 'offline');   // file:// 打开：没有云存档，签名只记在本机
    busy = true; lock(true); msg.textContent = L('归档中…', 'Filing…');
    X.WHO.err = '';
    await Promise.race([X.setName(name), new Promise(r => setTimeout(r, 7000))]).catch(() => {});
    busy = false;
    const err = X.WHO.err; X.WHO.err = '';
    if (X.NAME && X.NAME.toLowerCase() === name.toLowerCase()) return finish(X.NAME, 'cloud');
    if (err && /16/.test(err)) { lock(false); S('nope'); return refuse(err); }   // 服务器说名字不合规
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
    : how === 'offline' ? L('现在是离线打开，签名只记在这台设备上。', 'Running offline: your signature is kept on this device only.')
    : how === 'guest' ? L('访客的进度只存在这台设备上。想换设备接着玩，回首页随时起个名字。', 'Guest progress stays on this device. Pick a name on the home screen any time to save it.') : '';
  X.setCard(`
    <p class="eyebrow">${L('合同生效 · 圆字第 ' + no + ' 号', 'Contract R-' + no + ' in effect')}</p>
    <h2>${name ? L(`签好了，${escH(name)}。开工吧`, `Signed, ${escH(name)}. Get to work`) : L('访客，开工吧', 'Get to work, guest')}</h2>
    <p>${(({ advN, restN }) => L(`冒险模式一共 <strong>${advN} 单</strong>，做完前 ${Y.ENDLESS.unlock} 单就解锁无尽模式。完不成会怎样，合同第三条写着。`, `Adventure mode is <strong>${advN} orders</strong>; finish the first ${Y.ENDLESS.unlock} to unlock endless mode. What happens if you fail is in clause 3.`))(parts())}</p>
    <div class="flow-go">
      <button class="btn flow-big" type="button" data-act="resume">${L('下一关', 'Next level')}<small>${L(`第 ${at + 1} 单 · ${mat ? mat.name : ''}`, `Order ${at + 1} · ${mat ? mat.name : ''}`)}</small></button>
      <button class="btn ghost" type="button" data-act="${escH(CONFIG.collectionAct)}">${L('去收藏室看看', 'Collection room')}</button>
    </div>
    ${note ? `<p class="note">${note}</p>` : ''}`);
  const go = card.querySelector('.flow-go');
  if (go) go.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) track('choice', { act: b.dataset.act }); });
}

/* ---------- 开始 ---------- */
/* 第一次来、还没选过语言：先选。浏览器语言那个排前面、高亮。选了就记在 yuan.lang，以后不再问 */
const langChosen = () => { try { return !!localStorage.getItem('yuan.lang') || !!new URLSearchParams(location.search).get('lang'); } catch (e) { return true; } };
function pickLang(then) {
  phase = 'lang'; track('lang');
  const browserZh = /^zh/i.test((navigator.languages && navigator.languages[0]) || navigator.language || '');
  const opts = browserZh ? [['zh', '中文'], ['en', 'English']] : [['en', 'English'], ['zh', '中文']];
  X.setCard(`<p class="eyebrow">语言 · Language</p>
    <div class="flow-go">${opts.map(([v, t], i) => `<button class="btn${i ? ' ghost' : ''}" type="button" data-lang="${v}" lang="${v}">${t}</button>`).join('')}</div>`);
  const first = card.querySelector('[data-lang]'); if (first) first.focus();
  card.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => {
    X.audioInit(); S('ui', 'go');
    const to = btn.dataset.lang;
    try { localStorage.setItem('yuan.lang', to); } catch (e) {}
    if ((to === 'en') === EN) { phase = 'idle'; then(); return; }
    leaving = true; location.href = location.pathname + '?lang=' + to;   // 换语言要重新加载；回来是封面，再点一下就开场（声音要这一下）
  }));
}
function begin(replay) {
  if (!replay && !langChosen()) { X.audioInit(); S('ui', 'go'); pickLang(() => begin(replay)); return; }
  ran = true; replaying = replay ? 1 : 0;
  X.audioInit(); S('ui', 'go');
  card.innerHTML = ''; overlay.hidden = true; stage.classList.remove('cover'); deliverBtn.hidden = true;
  G.idx = 0; G.loop = 0; G.score = 0; G.done = 0; X.setupRound(); G.state = 'flow';   // 游戏不认识的状态：照常画场景，但不能拎、不计时
  track('begin', { resume: !replay && !FORCED && FL.tut && !FL.signed ? 1 : 0 });
  if (!replay && !FORCED && FL.tut && !FL.signed) {   // 上次过了新手关没签字就走了：直接接着签
    phase = 'handoff';
    G.bubble = { text: L('合同还没签呢，地球人。', 'You have not signed yet, Earthling.'), t0: G.time, dur: 3, lines: null }; S('alien', 'grr', .2);
    setTimeout(() => openContract(0), 1100);
    return;
  }
  playCutscene(startTutorial);
}

/* ---------- 抢在游戏前面的事件监听（捕获阶段） ---------- */
/* 游戏嵌在别的页面里（iframe）时：画布上的按下都被 preventDefault 了，键盘焦点一直留在外层页面，
   封面 → 播片 → 新手关一路只点画布，A / D、空格就全没反应。所以每次按下都把焦点要过来。 */
window.addEventListener('pointerdown', () => { try { if (!document.hasFocus()) window.focus(); } catch (e) {} }, true);
window.addEventListener('pointerdown', e => {
  if (phase === 'idle' && G.state === 'cover' && e.target === cv && wantIntro()) { e.preventDefault(); e.stopImmediatePropagation(); begin(false); }
}, true);
/* 新手关里抓石头不自动转：游戏抓的时候会把抓点甩到正上方（抓凸起对面 = 凸起自动朝下），这里抓完立刻把目标角度改回原样，
   只能靠第二根手指 / A、D 转。捕获阶段记下抓之前拎没拎着，冒泡到 window 时游戏已经处理完这次按下 */
window.addEventListener('pointerdown', () => { if (phase === 'tutorial' && T && G.body) T.preHeld = !!G.body.held; }, true);
window.addEventListener('pointerdown', () => {
  const b = G.body; if (phase !== 'tutorial' || !T || !b || T.preHeld || !b.held) return;
  b.targetA = b.a;
});
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
window.addEventListener('pagehide', () => {   // 开场流程走到一半关掉了：记下停在哪（要排在下面那个拦截前面）
  if (phase === 'idle' || leaving) return; leaving = true;
  track('leave', { at: phase, st: phase === 'tutorial' && T ? T.stage || 'ready' : '' });
}, true);
window.addEventListener('pagehide', e => { if (phase === 'tutorial') e.stopImmediatePropagation(); }, true);   // 新手关不算“中途放弃了一单”
window.addEventListener('pageshow', e => { if (e.persisted) leaving = false; });   // 从往返缓存里回来：下次关页面还要记

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

window.__yuanFlowDebug = { CONFIG, TUT, get phase() { return phase; }, begin, geom, openContract };
})();
