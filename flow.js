/* 甲方要圆 · 开场流程
   封面 → 播片 → 新手关 → 甲方递合同 → 签名（就是原来的起名字存档）→ 下一关 / 收藏室选关

   整段流程都在这个文件里，index.html 只多了两行：递出内部函数的 window.__yuanFlow，和引入本文件的 <script>。
   这个文件没加载、或者 index.html 里没有那一行，游戏就按原来的流程走（封面 → 首页）。
   不改游戏本身的函数：靠捕获阶段的事件监听抢在游戏前面接管封面和新手关的按键，提示画在游戏那一帧之后。

   谁会看到：这台设备上没过新手关的人（有没有存档都一样）。过了新手关的照旧直接进首页，首页卡片底部有「重看开场和新手关」。
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
  placeholderMs: 7500,  // 三个镜头一共放多久（每个 2.5 秒；能跳过）
};
/* 新手关：一块只有一个凸起的石头。砸不碎、不计时。只教两件事，限制得很死：
   ① 手势：一根手指按住往上拎，另一根手指左右滑把凸起转到朝下（电脑上是 A / D），然后松手。
      抓的时候石头不会自己转（游戏里抓凸起对面会自动把凸起甩到下面，这里关掉了），只能用第二根手指转。
   ② 靠「松手让它自己掉下去」来改形状。拿着往下砸（进阶手法）在新手关里不算数：不触发敲击，只提示一句。
   变形量不走石头原本的数值，而是每一帧按“朝下那一面凸出来多少”现算（见 tuneStone）：
   凸起朝下、从虚线以上掉下去，一下基本就平了；砸在圆的那一面只蹭掉一点点，所以不会越砸越糟。
   lift = 要拎到多高（石头最低点离地板），从这个高度掉下去力度大约 55。 */
const TUT = { R: 84, bump: 34, width: .22, hard: 20, brittle: 150, accel: 24000, target: .85, weak: .65, over: 1.3, aim: .33, lift: 200, nudge: 4 };   // nudge：够圆了几秒还没点交货就提醒

const G = Y.G, EN = document.documentElement.lang === 'en', L = (zh, en) => EN ? en : zh;
const TOUCH = document.documentElement.classList.contains('touch');
const XHS = window.YUAN_PLATFORM === 'xhs';   // 小红书小工具版：不联网、不换语言（见 index.html 的 XHS）
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
/* 要不要放开场：这台设备没过新手关就放（有没有存档都一样）；过了新手关但没签合同、也没存档的，接着去签合同 */
const wantIntro = () => !OFF && !ran && (FORCED || !FL.tut || (!FL.signed && !hasProgress()));

/* ---------- 样式 ---------- */
const HAND = `"Long Cang", "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", cursive`;
const SERIF = `"Noto Serif SC", "Songti SC", "STSong", "SimSun", "Source Han Serif SC", Georgia, serif`;
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .18 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E")`;
const style = document.createElement('style');
style.textContent = `
/* 新玩家封面上的语言选择：「开始」正下方一排两颗，English | 中文，各用自己的语言写，现在用的那颗是亮的。
   以前只在右下角放一颗小「中文」，后台看到中国来的玩家大多没发现、一直在玩英文版 */
#stage #flow-lang { position: absolute; right: 3.6%; width: 33.2%; top: calc(50% + var(--u) * 78); display: flex; justify-content: center; gap: calc(var(--u) * 12); z-index: 3; }
#stage:not(.cover) #flow-lang { display: none; }
#stage #flow-lang button { font: 400 max(14px, calc(var(--u) * 21))/1 var(--display); padding: .55em 1.1em .62em; min-width: 5.6em; border-radius: 999px; cursor: pointer;
  border: .12em solid rgb(255 255 255 / .55); background: rgb(28 18 92 / .5); color: #f1eaff; transition: transform .18s, background .15s; }
#stage #flow-lang button:hover { transform: translateY(-.08em); background: rgb(48 34 130 / .65); }
#stage #flow-lang button[aria-pressed="true"] { background: linear-gradient(#fff8e0, #ffe3aa); border-color: #fff; color: #33246e; box-shadow: 0 .18em 0 rgb(58 42 140 / .6); cursor: default; transform: none; }
#stage #flow-lang button:focus-visible { outline: 3px solid var(--coin); outline-offset: 3px; }
#stage.port #flow-lang { left: 0; right: 0; width: auto; top: calc(62% + var(--u) * 150); gap: calc(var(--u) * 16); }
#stage.port #flow-lang button { font-size: max(15px, calc(var(--u) * 27)); }
#stage.flow-lock #home { display: none !important; }
.flow-tut-on #help, .flow-tut-on #replay { visibility: hidden !important; }   /* 新手关：页面底下那行说明和「重来」都收起来 */

/* 播片 */
#flow-cut { position: absolute; inset: 0; z-index: 4; overflow: hidden; background: #07051a; color: var(--ink); animation: fcIn .25s ease-out both; }
#flow-cut.out { animation: fcOut .3s ease-in both; pointer-events: none; }
@keyframes fcIn { from { opacity: 0; } }
@keyframes fcOut { to { opacity: 0; } }
#flow-cut video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.fc-shot { position: absolute; inset: 0; opacity: 0; transition: opacity .3s ease; }
.fc-shot.on { opacity: 1; }
.fc-shot svg { position: absolute; inset: 0; width: 100%; height: 100%; }
#flow-cut .o { stroke: #3b1c78; stroke-width: 7; stroke-linejoin: round; stroke-linecap: round; }
#flow-cut .pop, #flow-cut .rise, #flow-cut .bob, #flow-cut .spin, #flow-cut .tw { transform-box: fill-box; transform-origin: 50% 50%; }
.fc-shot.on .pop { animation: fcPop .6s cubic-bezier(.3, 1.6, .5, 1) both; }
.fc-shot.on .pop.d1 { animation-delay: .18s; } .fc-shot.on .pop.d2 { animation-delay: .34s; } .fc-shot.on .pop.d3 { animation-delay: .5s; }
.fc-shot.on .bob { animation: fcBob 1.8s ease-in-out infinite alternate; }
.fc-shot.on .rise { animation: fcRise 1.7s cubic-bezier(.5, 0, .7, .6) both; }
.fc-shot.on .spin { animation: fcSpin 5s linear infinite; }
.fc-shot.on .beam { animation: fcBeam .5s ease-out both; transform-box: fill-box; transform-origin: 50% 0; }
#flow-cut .tw { animation: fcTw 1.3s ease-in-out infinite alternate; }
#flow-cut .tw.b { animation-delay: .5s; } #flow-cut .tw.c { animation-delay: .9s; }
@keyframes fcPop { from { transform: scale(0); } }
@keyframes fcBob { from { transform: translateY(-7px); } to { transform: translateY(7px); } }
@keyframes fcRise { from { transform: translateY(170px) rotate(-14deg); } to { transform: translateY(-70px) rotate(16deg) scale(.55); } }
@keyframes fcSpin { to { transform: rotate(360deg); } }
@keyframes fcBeam { from { transform: scaleY(0); opacity: 0; } }
@keyframes fcTw { from { transform: scale(.55); opacity: .5; } to { transform: scale(1.1); opacity: 1; } }
.fc-cap { position: absolute; left: 5%; right: 5%; bottom: 7.5%; z-index: 2; margin: 0; text-align: center; font: 400 max(18px, calc(var(--u) * 50))/1.2 var(--display); letter-spacing: .03em; color: #fff3c4; -webkit-text-stroke: .34em #3b1c78; paint-order: stroke fill; text-shadow: 0 .09em 0 #3b1c78; text-wrap: balance; }
.fc-cap b { font-weight: 400; color: #ffc928; }
.fc-shot.on .fc-cap { animation: fcCap .5s cubic-bezier(.3, 1.5, .5, 1) .25s both; }
@keyframes fcCap { from { transform: translateY(40%) scale(.8); opacity: 0; } }
.fc-skip { position: absolute; right: 2.4%; top: 3.6%; z-index: 3; font: 400 max(12px, calc(var(--u) * 20))/1 var(--display); padding: .6em 1.1em .7em; border: 0; border-radius: 999px; color: #653616; background: linear-gradient(#fff6dc, #f6dfae); box-shadow: 0 0 0 .16em #fff, 0 .28em 0 .16em #c9a25e, 0 .5em .7em rgb(18 12 84 / .45); cursor: pointer; }
.fc-skip kbd { font: 400 .8em var(--num); opacity: .65; margin-left: .45em; }
.touch .fc-skip kbd { display: none; }
.fc-skip:focus-visible { outline: 3px solid var(--coin); outline-offset: 3px; }
.fc-dots { position: absolute; left: 0; right: 0; bottom: 2.6%; z-index: 3; display: flex; justify-content: center; gap: calc(var(--u) * 12); pointer-events: none; }
.fc-dots i { width: calc(var(--u) * 21); height: calc(var(--u) * 21); background: #8f8cf5; clip-path: polygon(50% 0, 62% 35%, 100% 38%, 70% 60%, 80% 100%, 50% 77%, 20% 100%, 30% 60%, 0 38%, 38% 35%); opacity: .55; transition: .25s; }
.fc-dots i.on { background: #ffd23e; opacity: 1; transform: scale(1.35); }
/* 竖屏：用竖着摆的那一版画（600×1000，铺满），字幕放在画面主体下面 */
#stage.port .fc-cap { bottom: 17%; font-size: max(20px, calc(var(--u) * 46)); left: 7%; right: 7%; }
#stage.port .fc-skip { font-size: max(12px, calc(var(--u) * 24)); top: 2.4%; }

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
.fd-line { position: relative; display: flex; align-items: flex-end; min-height: 2.7em; margin-top: .5em; border-bottom: 1.5px solid #2b2622; }
/* 签名一笔一笔写出来：从左往右露出来 */
.fd-sig { flex: 1 1 0; min-width: 0; padding: .1em 3.4em 0 .25em; font: 400 1.9em/1.25 ${HAND}; color: #1d2c6e; white-space: nowrap; clip-path: inset(-.3em 100% -.3em 0); }
.fd-who { clip-path: inset(-.3em 100% -.3em 0); }
.fd-sig.on, .fd-who.on { animation: fdWrite var(--wt, .9s) cubic-bezier(.45, .1, .55, .9) both; }
@keyframes fdWrite { from { clip-path: inset(-.3em 100% -.3em 0); } to { clip-path: inset(-.3em 0 -.3em 0); } }
.fd-thumb { position: absolute; right: -.3em; bottom: -1.1em; width: 4.3em; height: 4.3em; transform: rotate(-8deg); mix-blend-mode: multiply; opacity: 0; pointer-events: none; }
.fd-thumb svg { display: block; width: 100%; height: 100%; }
.fd-thumb.on { opacity: 1; animation: fdPress .3s cubic-bezier(.2, 1.4, .4, 1) both; }
@keyframes fdPress { from { opacity: 0; transform: rotate(-8deg) scale(1.9); } }
.fd-date { grid-column: 1 / -1; margin-top: .2em !important; text-align: right; font-size: .88em; color: #4a433c; }
.fd-stamp { position: absolute; left: 50%; top: 43%; width: 8.6em; height: 8.6em; margin: -4.3em 0 0 -4.3em; display: grid; place-items: center; border: 4px solid #c0281c; border-radius: 50%; outline: 1.5px solid #c0281c; outline-offset: -9px; color: #c0281c; font: 700 1.75em/1.2 ${SERIF}; letter-spacing: .12em; text-align: center; transform: rotate(-14deg); opacity: .86; mix-blend-mode: multiply; pointer-events: none; animation: fdStamp .32s cubic-bezier(.2, 1.4, .4, 1) both; }
html[lang="en"] .fd-stamp { font-size: 1.25em; letter-spacing: .08em; width: 11em; height: 11em; margin: -5.5em 0 0 -5.5em; }
@keyframes fdStamp { from { transform: rotate(-14deg) scale(2.4); opacity: 0; } }
.fd-hand { position: absolute; left: -64px; top: -50px; width: 120px; height: 104px; pointer-events: none; animation: fdHand .5s 1.15s ease-in both; }
@keyframes fdHand { to { transform: translate(-90px, -70px); opacity: 0; } }
#flow-deal { cursor: pointer; -webkit-tap-highlight-color: transparent; padding-bottom: 104px; }   /* 底下留给「点一下开工」 */
/* 播完以后底下的「点一下开工」 */
.fd-next { position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom, 0px)); z-index: 9; transform: translateX(-50%); display: grid; gap: .3em; justify-items: center; width: max-content; max-width: calc(100vw - 32px); padding: .6em 1.3em .65em; border-radius: 999px; background: rgb(17 13 43 / .82); box-shadow: inset 0 0 0 1px #5143a0, 0 4px 14px rgb(0 0 0 / .4); color: #f4f0ff; text-align: center; pointer-events: none; opacity: 0; transition: opacity .3s; }
.fd-next.on { opacity: 1; }
.fd-next b { font: 400 19px/1.1 ${DISPLAY}; letter-spacing: .04em; animation: fdNext 1s ease-in-out infinite alternate; }
@keyframes fdNext { to { opacity: .55; } }
.fd-next small { font: 500 12px/1.35 ${BODY}; color: #a9a1d6; }
.fd-next small:empty { display: none; }
/* 横着拿手机：屏幕矮，纸放宽一点（行数少就不用缩那么小），底下的提示也收小 */
@media (max-height: 520px) and (min-width: 561px) {
  #flow-deal { padding-top: 8px; padding-bottom: 58px; }
  .fd-paper { width: min(100%, 800px); padding: 18px 34px 16px; }
  .fd-sub { padding: .4em 0 .6em; }
  .fd-parties { margin: .6em 0 .3em; }
  .fd-a, .fd-b { min-height: 5.6em; }
  .fd-next { bottom: max(8px, env(safe-area-inset-bottom, 0px)); padding: .4em 1.1em .45em; gap: .15em; }
  .fd-next b { font-size: 16px; }
  .fd-next small { font-size: 11px; }
}

/* 签合同之前的起名字（游戏自己的卡片里） */
.flow-name h2 { margin-top: .1em; }
/* 手机 Safari 上整张表单会被输入框的默认宽度（size=20）撑出卡片：网格只给一列、可以缩到 0，里面每一块都不许撑宽 */
#card .flow-name { grid-template-columns: minmax(0, 1fr); min-width: 0; max-width: 100%; box-sizing: border-box; }
#card .flow-name > * { min-width: 0; max-width: 100%; }
#card .flow-name .note { overflow-wrap: anywhere; }
.flow-name .who-row { min-width: 0; width: 100%; }
.flow-name .who-row input { flex: 1 1 0; width: 0; min-width: 0; box-sizing: border-box; font-size: max(16px, 1em); }
.flow-name .flow-go { flex-wrap: wrap; min-width: 0; }
.flow-name .flow-go .btn { min-width: 0; max-width: 100%; }
.flow-name .fd-dice { flex: 0 0 auto; align-self: center; width: 2.7em; height: 2.7em; min-height: 0; padding: 0; font-size: 1.15em; line-height: 1; }
.flow-name .fd-dice.roll { animation: fdRoll .35s ease-out; }
@keyframes fdRoll { from { transform: rotate(-200deg) scale(.7); } }
.flow-name .flow-go { margin-top: .5em; }
.flow-name .flow-go .btn:not(.ghost) { flex: 1 1 10em; }
.flow-name .err:empty { display: none; }
.fd-shake { animation: fdShake .32s linear; }
@keyframes fdShake { 20% { transform: translateX(-7px); } 45% { transform: translateX(6px); } 70% { transform: translateX(-4px); } 90% { transform: translateX(2px); } }
@media (max-width: 560px) {
  .fd-paper { padding: 22px 20px 20px; font-size: 14px; line-height: 1.62; transform: none; }   /* 手机上纸不歪：字更清楚 */
  .fd-title { font-size: 1.8em; }
  /* 签字那一栏占满整行，甲方的章挪到下面跟日期一排 */
  .fd-sign { grid-template-columns: minmax(0, 1fr); gap: 0; margin-top: 1.1em; }
  .fd-b { order: 1; min-height: 0; }
  .fd-a { order: 2; min-height: 6.4em; margin-top: 1.4em; }
  .fd-date { order: 3; margin-top: -1.7em !important; }
  .fd-seal { left: .2em; top: 1.2em; width: 5.4em; height: 5.4em; }
  .fd-scrawl { left: 2.6em; top: 1.9em; width: 5.4em; }
  .fd-sig { font-size: 2em; }
  .fd-note { margin-left: .2em; }
}
@media (prefers-reduced-motion: reduce) { .fd-stamp, .fd-hand, .fd-next b, .fc-shot.on .pop, .fc-shot.on .bob, .fc-shot.on .rise, .fc-shot.on .spin, .fc-shot.on .beam, #flow-cut .tw, .fc-shot.on .fc-cap { animation: none; } .fd-hand { display: none; } }

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
    held: false, holdT0: 0, preHeld: false, prevVy: 0, prevClear: 0, slamT: -9, high: false, stage: '', introUntil: 0, readyT: -1 };
}
const note = text => { T.note = { text, t: G.time }; };
function startTutorial() {
  phase = 'tutorial'; newStone(); G.state = 'play'; tutSeen = {}; tutT0 = performance.now(); track('tut');
  stage.classList.add('flow-tut'); stage.classList.toggle('flow-lock', !(FL.signed || hasProgress()));
  G.tutUI = true; document.documentElement.classList.add('flow-tut-on');   // 新手关的界面极简：index.html 不画力度表、底部提示和顶栏的小字   // 第一次来不给回首页，重看的时候可以走
  G.mood = 'calm'; G.moodT = 0;
  G.bubble = { text: L('先试工：把它弄圆。', 'Trial run: make it round.'), t0: G.time, dur: 4, lines: null }; T.introUntil = G.time + 2.4; S('alien', 'hi', .2);   // 先说一句，再换成第一步
  cancelAnimationFrame(raf); raf = requestAnimationFrame(tutFrame); addTutSkip();
  try { document.fonts.load(`600 17px 'Maoken Assorted Sans'`, HINT_TEXT); } catch (e) {}
}
function stopTutorial() { cancelAnimationFrame(raf); raf = 0; G.tutUI = false; deliverBtn.classList.remove('nudge'); document.documentElement.classList.remove('flow-tut-on'); stage.classList.remove('flow-tut', 'flow-lock'); const k = $('flow-tskip'); if (k) k.remove(); }
/* 新手关右上角的「跳过教程」：算过了新手关。没签合同的接着去签，签过的直接开工；重看的时候回首页 */
function addTutSkip() {
  if ($('flow-tskip')) return;
  const k = document.createElement('button'); k.id = 'flow-tskip'; k.className = 'fc-skip'; k.type = 'button'; k.textContent = L('跳过教程', 'Skip tutorial');
  k.addEventListener('click', skipTutorial); stage.appendChild(k);
}
function skipTutorial() {
  if (phase !== 'tutorial') return;
  X.sfx.ui(); track('tut_skip', { sec: Math.round((performance.now() - tutT0) / 100) / 10, st: T && T.stage || '' });
  if (replaying) { quitTutorial(); return; }
  if (G.body && G.body.held) Y.release();
  stopTutorial(); phase = 'handoff'; G.state = 'flow'; deliverBtn.hidden = true;
  FL.tut = 1; saveFL();
  if (FL.signed) { startWork(); return; }
  G.mood = 'calm'; G.moodT = 0;
  setTimeout(() => openContract(0), 300);
}
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
   这句话由甲方在左上角的气泡里说（新界面的奶油色气泡）：手机上底部那条会被两个大拇指挡住，顶上没人挡。
   够圆了先不说话，交货按钮自己会发光；过了 TUT.nudge 秒还没点（后台看到有人在这儿愣一两分钟），甲方才说一句、按钮放大闪 */
const TXT = {
  grab: L('按住，往上拎', 'Hold & lift'),
  lift: L('往上拎', 'Lift it up'),
  turn: L('把凸起转到下面', 'Turn the bump down'),
  drop: L('松手！', 'Let go!'),
  deliver: L('够圆了！点「交货」', TOUCH ? 'Round enough! Tap Deliver' : 'Round enough! Click Deliver'),
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
    const joy = X.joy, push = (g.err > 0 ? 1 : -1) * ((joy && joy.sg) || X.JOY_DIR || 1);   // 凸起要顺时针转（err > 0）手指往哪拨：看手指按在石头上面还是下面（joy.sg），示范的虚手指在下面（JOY_DIR）
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
    // 甲方的气泡说这一步该干嘛（游戏自己插的话会被盖掉，新手关里只听这一句）；够圆了先不说话（交货按钮自己会发光），过几秒还没点才提醒
    if (!ready) T.readyT = -1; else if (T.readyT < 0) T.readyT = G.time;
    const late = ready && G.time - T.readyT > TUT.nudge;   // 够圆了好几秒还没点交货
    if (deliverBtn.classList.contains('nudge') !== late) deliverBtn.classList.toggle('nudge', late);
    if (late) tutOnce('tut_nudge');
    const flash = T.note && G.time - T.note.t < 2.6 ? T.note.text : '';
    const line = ready ? (late ? TXT.deliver : '') : flash || (st === 'press' ? TXT.grab : st === 'lift' ? TXT.lift : st === 'turn' ? TXT.turn : TXT.drop);
    if (line && (T.grabbed || G.time > T.introUntil)) { if (!G.bubble || G.bubble.text !== line) G.bubble = { text: line, t0: G.time, dur: 900, lines: null, tut: 1 }; }
    else if (!line && G.bubble && G.bubble.tut) G.bubble = null;
    tuneStone(b, g); drawHints(b, g, ready);
  } catch (e) { console.error('[flow] tutorial frame', e); }
}

/* ---------- 播片 ---------- */
let cutSkip = null;
/* 三个镜头：地球上的工匠 → 被飞碟吸走 → 甲方只要圆。都是内联 SVG（960×600），各有自己的背景；动画在上面样式里（#flow-cut .pop / .bob / .rise…）。
   字幕里 <b> 包着的词是金色的 */
const SHOTS = (() => {
  const DEFS = `<defs>
    <radialGradient id="gEarth" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#9be4ff"/><stop offset=".6" stop-color="#4c9cf2"/><stop offset="1" stop-color="#3566d8"/></radialGradient>
    <radialGradient id="gLime" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#e2ff7a"/><stop offset=".65" stop-color="#a6ec3a"/><stop offset="1" stop-color="#6fc522"/></radialGradient>
    <radialGradient id="gBall" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#ffd98a"/><stop offset=".6" stop-color="#ff9d2e"/><stop offset="1" stop-color="#ee6f14"/></radialGradient>
    <linearGradient id="gPurple" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4b6ff"/><stop offset="1" stop-color="#8d5bf0"/></linearGradient>
    <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset="1" stop-color="#ffb21e"/></linearGradient>
    <linearGradient id="gBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff9a8" stop-opacity=".95"/><stop offset="1" stop-color="#c8ff7a" stop-opacity=".15"/></linearGradient>
    <radialGradient id="gGlow"><stop offset="0" stop-color="#fff6c9" stop-opacity=".55"/><stop offset="1" stop-color="#fff6c9" stop-opacity="0"/></radialGradient>
    <clipPath id="cEarth"><circle cx="480" cy="262" r="138"/></clipPath><clipPath id="cBall"><circle cx="668" cy="290" r="72"/></clipPath>
    <linearGradient id="b1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a66"/><stop offset=".55" stop-color="#2b55cc"/><stop offset="1" stop-color="#6fc3ff"/></linearGradient>
    <linearGradient id="b2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#160c4a"/><stop offset=".6" stop-color="#4a2aa6"/><stop offset="1" stop-color="#9a62ea"/></linearGradient>
    <radialGradient id="b3" cx="400" cy="262" r="640" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffc2e2"/><stop offset=".4" stop-color="#d568e8"/><stop offset="1" stop-color="#43209c"/></radialGradient>
    <path id="star" d="M0-30 8.5-11 29-9 13.5 5 18 25 0 14.500-18 25-13.500 5-29-9-8.500-11Z"/>
    <path id="spark" d="M0-20Q0 0 20 0 0 0 0 20 0 0-20 0 0 0 0-20Z"/>
  </defs>`;
  const star = (x, y, s, c, r) => `<g transform="translate(${x} ${y}) rotate(${r || 0}) scale(${s})"><g class="${c || ''}"><use href="#star" fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/><use href="#star" class="o" fill="url(#gGold)" style="stroke-width:5"/></g></g>`;
  const spark = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})"><use href="#spark" class="tw ${c || ''}" fill="#fff6c9"/></g>`;
  const skyDots = n => Array.from({ length: 46 }, (_, i) => `<circle cx="${(i * 197 + n * 91) % 960}" cy="${(i * 113 + n * 57) % 440}" r="${1 + (i % 3) * .8}" fill="#fff" opacity="${.3 + (i % 4) * .15}"/>`).join('');
  const rays = (cx, cy) => `<g class="spin" style="transform-origin:${cx}px ${cy}px;transform-box:view-box;animation-duration:40s">` + Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, b = a + Math.PI / 12; return `<path d="M${cx} ${cy}L${cx + 1200 * Math.cos(a)} ${cy + 1200 * Math.sin(a)}L${cx + 1200 * Math.cos(b)} ${cy + 1200 * Math.sin(b)}Z" fill="#fff" opacity=".1"/>`; }).join('') + '</g>';
  const BACK = [
    `<rect width="960" height="600" fill="url(#b1)"/>${skyDots(1)}<g fill="#fff" opacity=".2"><ellipse cx="150" cy="590" rx="260" ry="90"/><ellipse cx="520" cy="620" rx="300" ry="90"/><ellipse cx="860" cy="580" rx="240" ry="100"/></g><g fill="#fff" opacity=".28"><ellipse cx="60" cy="620" rx="200" ry="70"/><ellipse cx="760" cy="630" rx="260" ry="70"/></g>`,
    `<rect width="960" height="600" fill="url(#b2)"/>${skyDots(2)}<path d="M0 520q120-70 250-30t250-20 230 20 230-30v140H0Z" fill="#2c1a78"/><path d="M0 560q160-50 330-20t320-10 310-10v80H0Z" fill="#3a2494"/>`,
    `<rect width="960" height="600" fill="url(#b3)"/>${rays(400, 262)}`
  ];
  const SHOTS = [
    { cap: L('你是<b>地球</b>上手艺最好的工匠。', 'You are the finest artisan on <b>Earth</b>.'),
      svg: `<circle cx="480" cy="262" r="250" fill="url(#gGlow)"/>
        <g class="pop"><g class="bob">
          <circle cx="480" cy="262" r="150" fill="#fff"/>
          <circle cx="480" cy="262" r="138" fill="url(#gEarth)"/>
          <g clip-path="url(#cEarth)"><path d="M372 190c40-44 104-30 118 6s-22 60-62 62-92-28-56-68zM520 300c36-20 96-8 100 26s-44 62-84 48-52-54-16-74zM350 318c22-8 44 6 42 28s-26 34-44 24-22-42 2-52zM560 150c22-10 50 0 60 20l-30 16c-18 4-40-22-30-36z" fill="#86e04f"/><path d="M372 190c40-44 104-30 118 6M520 300c36-20 96-8 100 26" fill="none" stroke="#c9f77a" stroke-width="8" stroke-linecap="round" opacity=".7"/></g>
          <path d="M388 172a120 120 0 0 1 96-42" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" opacity=".75"/>
          <circle cx="480" cy="262" r="138" fill="none" class="o"/>
          <ellipse cx="440" cy="270" rx="15" ry="20" fill="#2a1750"/><ellipse cx="520" cy="270" rx="15" ry="20" fill="#2a1750"/><circle cx="445" cy="262" r="6" fill="#fff"/><circle cx="525" cy="262" r="6" fill="#fff"/>
          <ellipse cx="410" cy="300" rx="16" ry="10" fill="#ff8fb0" opacity=".8"/><ellipse cx="550" cy="300" rx="16" ry="10" fill="#ff8fb0" opacity=".8"/>
          <path d="M462 300q18 16 36 0" fill="none" stroke="#2a1750" stroke-width="7" stroke-linecap="round"/>
        </g></g>
        <g class="pop d2"><g transform="rotate(-24 640 170)"><rect x="628" y="150" width="18" height="96" rx="8" fill="#c98a4b" class="o" style="stroke-width:5"/><rect x="596" y="118" width="84" height="46" rx="12" fill="url(#gPurple)" class="o" style="stroke-width:5"/><path d="M608 130h40" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".7"/></g></g>
        ${star(302, 150, 1.5, 'pop d1', -14)}${star(700, 330, .9, 'pop d3', 12)}${spark(250, 300, 1)}${spark(730, 120, .8, 'b')}${spark(650, 400, .6, 'c')}${spark(330, 400, .7, 'b')}` },
    { cap: L('所以，你被外星人<b>绑走了</b>。', 'So the aliens <b>abducted</b> you.'),
      svg: `<g class="beam"><path d="M420 190 310 560h340L540 190Z" fill="url(#gBeam)"/><path d="M420 190 310 560M540 190l110 370" stroke="#fff9a8" stroke-width="5" stroke-linecap="round" opacity=".6"/></g>
        <g class="rise"><g>
          <ellipse cx="480" cy="392" rx="40" ry="44" fill="#fff"/>
          <ellipse cx="480" cy="392" rx="32" ry="36" fill="#ffe2b8" class="o" style="stroke-width:5"/>
          <path d="M450 372q30-34 60 0" fill="#ffb21e" class="o" style="stroke-width:5"/>
          <circle cx="468" cy="392" r="5.500" fill="#2a1750"/><circle cx="492" cy="392" r="5.500" fill="#2a1750"/><ellipse cx="480" cy="408" rx="6" ry="8" fill="#2a1750"/>
          <path d="M450 404l-22-16M510 404l24-18M468 426l-8 22M492 426l8 22" stroke="#3b1c78" stroke-width="8" stroke-linecap="round" fill="none"/>
          <g transform="rotate(30 548 372)"><rect x="544" y="362" width="8" height="34" rx="4" fill="#c98a4b" stroke="#3b1c78" stroke-width="3"/><rect x="532" y="350" width="32" height="18" rx="5" fill="url(#gPurple)" stroke="#3b1c78" stroke-width="3"/></g>
        </g></g>
        <g class="pop"><g class="bob">
          <ellipse cx="480" cy="160" rx="196" ry="74" fill="#fff"/><path d="M398 150a82 80 0 0 1 164 0Z" fill="#fff" stroke="#fff" stroke-width="16"/>
          <path d="M398 150a82 80 0 0 1 164 0Z" fill="#bfeaff" class="o"/><path d="M424 118a60 58 0 0 1 44-36" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".85"/>
          <circle cx="462" cy="122" r="7" fill="#2a1750"/><circle cx="498" cy="122" r="7" fill="#2a1750"/><path d="M468 138q12 9 24 0" fill="none" stroke="#2a1750" stroke-width="5" stroke-linecap="round"/><ellipse cx="480" cy="128" rx="34" ry="30" fill="url(#gLime)" opacity=".0"/>
          <ellipse cx="480" cy="168" rx="184" ry="52" fill="url(#gPurple)" class="o"/>
          <path d="M312 160q168-44 336 0" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".55"/>
          <ellipse cx="480" cy="204" rx="92" ry="20" fill="#6a3fd0" class="o" style="stroke-width:5"/>
          <g class="o" style="stroke-width:4" fill="url(#gGold)"><circle cx="350" cy="180" r="12"/><circle cx="414" cy="192" r="12"/><circle cx="546" cy="192" r="12"/><circle cx="610" cy="180" r="12"/></g>
        </g></g>
        ${star(236, 150, 1.1, 'pop d2', -18)}${star(742, 250, .8, 'pop d3', 14)}${spark(200, 330, .9)}${spark(760, 110, .8, 'b')}${spark(690, 420, .6, 'c')}` },
    { cap: L('甲方只有一个需求：<b>圆</b>。', 'The Client wants one thing: <b>round</b>.'),
      svg: `<circle cx="400" cy="262" r="250" fill="url(#gGlow)"/>
        <g class="pop"><path d="M400 262 150 190l110 70-130 60 150 6-60 110 120-70 60 120 60-120 120 70-60-110 150-6-130-60 110-70Z" fill="#ff5fa5" stroke="#fff" stroke-width="10" stroke-linejoin="round" opacity=".95" transform="translate(0 6)"/></g>
        <g class="pop d1"><g class="bob">
          <g class="o" fill="#b6f03c"><path d="M352 150q-12-50-30-60" fill="none" stroke-width="16"/><path d="M448 150q12-50 30-60" fill="none" stroke-width="16"/><circle cx="318" cy="84" r="20"/><circle cx="482" cy="84" r="20"/></g>
          <path d="M352 150q-12-50-30-60M448 150q12-50 30-60" fill="none" stroke="#b6f03c" stroke-width="8" stroke-linecap="round"/>
          <circle cx="400" cy="262" r="134" fill="#fff"/>
          <circle cx="400" cy="262" r="122" fill="url(#gLime)" class="o"/>
          <path d="M286 220a122 122 0 0 1 228 0q-114-44-228 0Z" fill="url(#gPurple)" class="o"/>
          <path d="M322 172a100 100 0 0 1 70-30" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" opacity=".75"/>
          <rect x="262" y="212" width="34" height="78" rx="17" fill="url(#gPurple)" class="o" style="stroke-width:6"/><rect x="504" y="212" width="34" height="78" rx="17" fill="url(#gPurple)" class="o" style="stroke-width:6"/>
          <ellipse cx="356" cy="268" rx="27" ry="31" fill="#2a1750"/><ellipse cx="444" cy="268" rx="27" ry="31" fill="#2a1750"/>
          <g transform="translate(358 266) scale(.85)"><use href="#spark" fill="#ffe84a"/></g><g transform="translate(446 266) scale(.85)"><use href="#spark" fill="#ffe84a"/></g>
          <circle cx="343" cy="252" r="6" fill="#fff"/><circle cx="431" cy="252" r="6" fill="#fff"/>
          <ellipse cx="316" cy="310" rx="18" ry="11" fill="#ff8fb0" opacity=".85"/><ellipse cx="484" cy="310" rx="18" ry="11" fill="#ff8fb0" opacity=".85"/>
          <path d="M384 312q16 34 32 0Z" fill="#ff6fa0" class="o" style="stroke-width:5"/>
        </g></g>
        <g class="pop d2"><g class="bob" style="animation-delay:.4s">
          <circle cx="668" cy="290" r="84" fill="#fff"/><circle cx="668" cy="290" r="74" fill="url(#gBall)" class="o"/>
          <g clip-path="url(#cBall)" fill="none" stroke="#ffd98a" stroke-width="8" opacity=".75"><path d="M590 270q78 26 156 0M592 310q76 24 152 0M604 344q64 18 128 0"/></g>
          <path d="M618 248a62 62 0 0 1 44-28" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".85"/>
          <g class="spin" style="transform-origin:668px 290px;transform-box:view-box"><circle cx="668" cy="290" r="100" fill="none" stroke="#fff6c9" stroke-width="5" stroke-dasharray="4 22" stroke-linecap="round"/></g>
        </g></g>
        ${star(776, 168, 1.1, 'pop d3', 14)}${star(180, 330, .8, 'pop d3', -16)}${spark(214, 140, .9)}${spark(790, 400, .7, 'b')}${spark(590, 130, .6, 'c')}` }
  ];
  /* 竖屏（手机）：同一套画重新摆在 600×1000 的竖画布上。背景按比例放大铺满（第三幕的放射光另画，圆心对着甲方）；
     画面主体放大一点、移到上半屏正中，下面留给字幕。PL[i] = [缩放, 主体中心 x, 主体中心 y] */
  const PL = [[1.08, 480, 262], [1.02, 480, 330], [.8, 462, 262]], PY = 410;
  const pBack = i => i === 2
    ? (([s, cx, cy]) => { const ax = 300 + (400 - cx) * s, ay = PY + (262 - cy) * s; return `<g transform="translate(${ax - 400} ${ay - 262})"><rect x="-500" y="-500" width="1600" height="1800" fill="url(#b3)"/></g>${rays(ax, ay)}`; })(PL[2])
    : `<g transform="translate(-500 0) scale(${1000 / 600})">${BACK[i]}</g>`;
  const pBody = (svg, [s, cx, cy]) => `<g transform="translate(${300 - cx * s} ${PY - cy * s}) scale(${s})">${svg}</g>`;
  return SHOTS.map((s, i) => ({ cap: s.cap, svg: DEFS + BACK[i] + s.svg, psvg: DEFS + pBack(i) + pBody(s.svg, PL[i]) }));
})();
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
    const d = clamp(CONFIG.placeholderMs, 900, 9000) / SHOTS.length;
    const port = stage.classList.contains('port');   // 手机竖屏用竖着摆的那一版
    el.insertAdjacentHTML('afterbegin', SHOTS.map(s => `<div class="fc-shot">${port ? `<svg viewBox="0 0 600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${s.psvg}</svg>` : `<svg viewBox="0 0 960 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${s.svg}</svg>`}<p class="fc-cap">${s.cap}</p></div>`).join('') + `<div class="fc-dots">${SHOTS.map(() => '<i></i>').join('')}</div>`);
    const shots = el.querySelectorAll('.fc-shot');
    const dots = el.querySelectorAll('.fc-dots i');
    shots.forEach((s, i) => timers.push(setTimeout(() => { shots.forEach(o => o.classList.toggle('on', o === s)); dots.forEach((o, k) => o.classList.toggle('on', k === i)); S('cut', i); }, i * d + 20)));   // 每个镜头一小段声音（换成真视频就用视频自己的声音）
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
/* 签合同分两步：先在游戏自己的卡片里起名字（甲方在舷窗里问），再放合同的过场：纸飞进来，名字自己写上，按手印、盖章，点一下直接开工 */
function openContract(round) {
  phase = 'naming'; track('naming'); stage.classList.add('flow-lock');   // 起名字的时候不给回首页
  G.mood = 'calm'; G.moodT = 0; S('alien', 'hi', .2);
  G.bubble = { text: L('地球人，你叫什么？', 'Earthling, what is your name?'), t0: G.time, dur: 600, lines: null };
  // 没起过名字的：输入框里先放一个随机名字（原来的「帮我起一个」跟骰子重复，合成这一个）。懒得想就直接点「就叫这个」，想换点骰子或者直接改
  const name0 = X.NAME || FL.name || '', pre = name0 || randomName('');
  X.setCard(`
    <form class="who flow-name" autocomplete="off" novalidate>
      <p class="eyebrow">${L('签合同之前', 'Before you sign')}</p>
      <h2>${L('你叫什么名字？', 'What is your name?')}</h2>
      <p class="note">${X.CLOUD ? L('名字就是存档名。换设备输同一个名字，就能接着玩。', 'Your name is your save. Use the same name on any device to continue.') : (XHS ? L('名字只记在这台手机的小红书里。', 'Your name is kept in Xiaohongshu on this phone.') : L('现在是离线打开，名字只记在这台设备上。', 'Running offline: your name is kept on this device only.'))}</p>
      <span class="who-row">
        <input id="fd-name" name="sign" maxlength="16" autocomplete="nickname" enterkeyhint="done" spellcheck="false" autocapitalize="off" placeholder="${L('你的名字', 'Your name')}" value="${escH(pre)}" aria-label="${L('你的名字', 'Your name')}">
        <button class="btn ghost small fd-dice" type="button" title="${L('随便起一个', 'Random name')}" aria-label="${L('随便起一个', 'Random name')}">🎲</button>
      </span>
      ${name0 ? '' : `<p class="note fd-hint">${L('先帮你起了一个，点 🎲 换，或者直接改。', 'Here’s one to start with. Tap 🎲 to reroll, or type your own.')}</p>`}
      <span class="note err" role="alert"></span>
      <div class="flow-go">
        <button class="btn" type="submit">${L('就叫这个', 'That’s me')}</button>
      </div>
    </form>`);
  const form = card.querySelector('.flow-name'), input = form.querySelector('#fd-name'), msg = form.querySelector('.err');
  const dice = form.querySelector('.fd-dice'), row = form.querySelector('.who-row');
  const btns = [...form.querySelectorAll('button')];
  const lock = on => { input.disabled = on; btns.forEach(b => { b.disabled = on; }); };
  let busy = false, done = false, rolled = name0 ? '' : pre;   // rolled：随机出来的名字（预填的或骰子掷的），原样提交就当新名字认领（不能跟别人的存档合并）
  if (!TOUCH) setTimeout(() => { if (phase === 'naming') try { input.focus({ preventScroll: true }); input.select(); } catch (e) {} }, 350);   // 手机上不自动弹键盘；电脑上全选，直接打字就换掉
  const refuse = text => {
    S('nope'); msg.textContent = text; row.classList.remove('fd-shake'); void row.offsetWidth; row.classList.add('fd-shake');
    try { input.focus(); } catch (e) {}
  };
  input.addEventListener('input', () => { msg.textContent = ''; });
  dice.addEventListener('click', () => {
    if (busy || done) return;
    X.audioInit(); S('ui');
    input.value = rolled = randomName(input.value); msg.textContent = '';
    dice.classList.remove('roll'); void dice.offsetWidth; dice.classList.add('roll');
    track('rndname');
  });
  const go = (name, how) => {
    done = true; FL.signed = 1; FL.name = name; saveFL(); track('signed', { how });
    G.bubble = null; S('ui', 'go'); stage.classList.remove('flow-lock');
    card.innerHTML = ''; overlay.hidden = true;
    playContract(round, name, how);
  };
  // 不再有访客：不想起名字就随机发一个，而且只发没人用过的（服务器查重，被占了就再掷，最多 6 次）
  const claim = async (name, fresh) => {
    X.WHO.err = ''; X.WHO.code = '';
    await Promise.race([X.setName(name, fresh), new Promise(r => setTimeout(r, 7000))]).catch(() => {});
    const code = X.WHO.code; X.WHO.err = ''; X.WHO.code = '';
    if (X.NAME && X.NAME.toLowerCase() === name.toLowerCase()) return 'ok';
    return code || 'net';
  };
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy || done) return;
    X.audioInit();
    const name = cleanName(input.value);
    if (!name) return refuse(L('起个名字，或者点 🎲 随机一个。', 'Pick a name, or tap 🎲 for a random one.'));
    if ([...name].length > 16 || (NAME_OK && !NAME_OK.test(name))) return refuse(L('名字只能用文字、数字、空格和 - _ · .，最多 16 个字。', 'Names can use letters, numbers, spaces and - _ · . (16 max).'));
    const fresh = !!rolled && name === rolled;
    if (!X.CLOUD) return go(name, fresh ? 'random' : 'offline');   // file:// 打开：没有云存档，名字只记在本机
    busy = true; lock(true); msg.textContent = '';
    const submit = form.querySelector('[type=submit]'), label = submit.textContent; submit.textContent = L('归档中…', 'Filing…');
    let res = await claim(name, fresh), final = name;
    // 随机的名字被别人占了：自己再掷、再认领（最多再试 5 次），不让玩家多点一下
    for (let i = 0; fresh && res === 'taken' && i < 5; i++) { final = rolled = randomName(final); input.value = final; res = await claim(final, true); }
    busy = false; submit.textContent = label;
    if (res === 'ok') return go(X.NAME, fresh ? 'random' : 'cloud');
    if (res === 'bad-name') { lock(false); return refuse(L('名字只能用文字、数字、空格和 - _ · .，最多 16 个字。', 'Names can use letters, numbers, spaces and - _ · . (16 max).')); }
    if (res === 'taken') { lock(false); if (!fresh) input.value = rolled = randomName(name); return refuse(fresh ? L('一连几个名字都被人用了，再点一次试试。', 'Those names were all taken. Try again.') : L('这个名字刚被人用了，给你换了一个。', 'That one was just taken. Here is another.')); }
    // 存档服务连不上：先在本机记下，名字留在 yuan.name 里，下次打开时游戏会自己补存
    try { localStorage.setItem('yuan.name', final); } catch (e2) {}
    go(final, 'later');
  });
}

function playContract(round, name, how) {
  phase = 'contract'; track('contract');
  const no = contractNo(), now = new Date(), shown = name || L('访客', 'Guest');
  const { advN } = parts();
  const date = EN ? now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const trial = round ? L(`乙方试工圆度 ${pct(round)}，甲方决定雇用。`, `Trial: ${pct(round)} round. Hired.`) : L('乙方试工合格，甲方决定雇用。', 'Trial passed. Hired.');
  const note = how === 'later' ? L('存档服务这会儿连不上，名字先记在这台设备上，下次打开会自动补存。', 'The save server is unreachable. Your name is kept here and will sync next time.')
    : how === 'offline' ? L('离线打开：名字只记在这台设备上。', 'Offline: your name is kept on this device only.')
    : how === 'random' ? L('名字是随机起的，回首页随时可以换。', 'Your name was picked at random. Change it on the home screen any time.') : '';
  const layer = document.createElement('div'); layer.id = 'flow-deal'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-labelledby', 'fd-title');
  layer.innerHTML = `
  <article class="fd-paper">
    ${HANDSVG}
    <p class="fd-no">${L('合同编号：圆字第 ' + no + ' 号', 'Contract No. R-' + no)}</p>
    <h2 class="fd-title" id="fd-title">${L('劳务合同', 'Employment Contract')}</h2>
    <p class="fd-sub">${L('EMPLOYMENT CONTRACT', '劳 务 合 同')}</p>
    <div class="fd-parties">
      <p><b>${L('甲方（雇主）：', 'Party A: ')}</b>${L('母星甲方', 'The Client')}</p>
      <p><b>${L('乙方（工匠）：', 'Party B: ')}</b><span class="fd-who">${escH(shown)}</span>${L('，地球', ', Earth')}</p>
    </div>
    <p class="fd-lead">${trial}</p>
    <ol class="fd-terms">
      <li><b>${L('第一条　工作', '1. Work.')}</b>${L(`甲方送来什么，乙方就做圆什么。先做冒险模式 ${advN} 单，之后加班到撑不住为止。`, `Make round whatever the Client sends. ${advN} orders, then overtime.`)}</li>
      <li><b>${L('第二条　酬劳', '2. Pay.')}</b>${L('耐心耗尽前达标就付 ◎，越圆越快给得越多。', 'Hit the target in time, get paid in ◎.')}</li>
      <li><b>${L('第三条　违约', '3. Breach.')}</b>${L('完不成的，<em>乙方本人被做成圆形</em>。', 'Fail, and <em>you get made round</em>.')}<span class="fd-note">${L('← 认真的', '← we mean it')}</span></li>
      <li><b>${L('第四条　档案', '4. Records.')}</b>${L('签名就是存档名，换设备签同一个名字接着干。', 'Your signature is your save name.')}</li>
    </ol>
    <p class="fd-fine">${L('签字即生效。乙方已在母星，无权拒签。', 'Effective on signature. No take-backs.')}</p>
    <div class="fd-sign">
      <div class="fd-a"><span>${L('甲方（盖章）：', 'Party A (seal):')}</span>${SEAL()}${SCRAWL}</div>
      <div class="fd-b">
        <span>${L('乙方（签字）：', 'Party B (signature):')}</span>
        <div class="fd-line"><span class="fd-sig">${escH(shown)}</span><span class="fd-thumb" aria-hidden="true">${PRINT}</span></div>
      </div>
      <p class="fd-date">${L('签于母星 · ', 'Signed on the homeworld · ')}${date}</p>
    </div>
  </article>
  <p class="fd-next" aria-live="polite"><b>${L('点一下，开工 ▸', 'Tap to start work ▸')}</b><small>${escH(note)}</small></p>`;
  document.body.appendChild(layer);
  const paper = layer.querySelector('.fd-paper'), who = layer.querySelector('.fd-who'), sig = layer.querySelector('.fd-sig'), thumb = layer.querySelector('.fd-thumb'), next = layer.querySelector('.fd-next');
  // 纸比屏幕高（横着拿手机）：整张按比例缩小，过场里不用滚
  const fitPaper = () => { paper.style.zoom = ''; const cs = getComputedStyle(layer), h = paper.offsetHeight, room = innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 6; if (h > room) paper.style.zoom = String(Math.max(.5, room / h)); };
  fitPaper(); addEventListener('resize', fitPaper);
  // 名字越长写得越久
  const wt = REDUCED ? .01 : clamp(.35 + [...shown].length * .07, .5, 1.3);
  sig.style.setProperty('--wt', wt + 's'); who.style.setProperty('--wt', wt * .8 + 's');
  S('paper');
  const fly = (out) => {
    const a = alienPoint(), rc = paper.getBoundingClientRect(), dx = a.x - (rc.left + rc.width / 2), dy = a.y - (rc.top + rc.height * .4);
    const far = { transform: `translate(${dx}px, ${dy}px) rotate(-34deg) scale(.05)`, opacity: .3 }, near = { transform: getComputedStyle(paper).transform === 'none' ? 'none' : 'rotate(-.7deg)', opacity: 1 };
    try { return paper.animate(out ? [near, far] : [far, near], { duration: REDUCED ? 1 : out ? 520 : 760, easing: out ? 'cubic-bezier(.5,0,.9,.4)' : 'cubic-bezier(.16,.9,.3,1)', fill: out ? 'forwards' : 'none' }); } catch (e) { return null; }
  };
  fly(false);
  // 过场的几拍：写名字 → 按手印 → 盖章 → 出「点一下」。点一下跳到最后，再点一下开工
  const timers = [], at = (ms, fn) => timers.push(setTimeout(fn, ms));
  let step = 0;
  const beats = [
    () => { sig.classList.add('on'); who.classList.add('on'); S('ui'); },
    () => { thumb.classList.add('on'); S('press'); },
    () => { S('stamp'); paper.insertAdjacentHTML('beforeend', `<div class="fd-stamp" aria-hidden="true">${L('合同<br>生效', 'IN<br>EFFECT')}</div>`); },
    () => { next.classList.add('on'); }
  ];
  const run = i => { while (step <= i && step < beats.length) beats[step++](); };
  const t0 = REDUCED ? 300 : 1000, w = wt * 1000;
  at(t0, () => run(0)); at(t0 + w + 250, () => run(1)); at(t0 + w + 750, () => run(2)); at(t0 + w + 1450, () => run(3));
  let leavingDeal = false;
  const advance = () => {
    if (leavingDeal) return;
    X.audioInit();
    if (step < beats.length) {   // 还在播：直接跳到盖好章
      timers.forEach(clearTimeout);
      if (step === 0) { sig.style.setProperty('--wt', '.01s'); who.style.setProperty('--wt', '.01s'); }
      run(beats.length - 1); return;
    }
    leavingDeal = true; removeEventListener('resize', fitPaper);
    const an = fly(true); layer.classList.add('out'); S('paper', true);
    const gone = () => { layer.remove(); startWork(); };
    if (an && an.finished) an.finished.then(gone, gone); else setTimeout(gone, 480);
  };
  layer.addEventListener('click', advance);
  dealKey = advance;
}
let dealKey = null;   // 合同过场里按空格 / 回车 / Esc：跟点一下一样

/* 签完：直接接第一单（没交过的第一单） */
function startWork() {
  phase = 'idle'; dealKey = null;
  G.idx = 0; G.loop = 0; G.score = 0; G.done = 0; X.setupRound(); G.state = 'menu'; G.mood = 'happy'; G.moodT = G.time + 4;
  track('choice', { act: 'resume' });
  Y.act('resume');
}

/* ---------- 开始 ---------- */
/* 第一次来、还没选过语言：先选。浏览器语言那个排前面、高亮。选了就记在 yuan.lang，以后不再问 */
const langChosen = () => { try { return !!localStorage.getItem('yuan.lang') || !!new URLSearchParams(location.search).get('lang'); } catch (e) { return true; } };
function pickLang(then) {
  phase = 'lang'; track('lang');
  const browserZh = /^zh/i.test((navigator.languages && navigator.languages[0]) || navigator.language || '');
  const opts = [['en', 'English'], ['zh', '中文']];   // 游戏默认英文：English 一律排前面、高亮（browserZh 只留着备用）
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
  // 不再先弹语言选择：开场直接跟着开始界面的语言放（没选过就跟浏览器语言：中文浏览器用中文、其他英文；封面「开始」下面能换）。pickLang 留着没删
  try { if (!langChosen()) localStorage.setItem('yuan.lang', EN ? 'en' : 'zh'); } catch (e) {}
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
    if (langBtn && langBtn.contains(document.activeElement)) { e.stopImmediatePropagation(); return; }   // 焦点在语言按钮上：让按钮自己响应
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
  if (phase === 'contract' && dealKey && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) { e.preventDefault(); if (!e.repeat) dealKey(); }
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
if (wantIntro()) stage.classList.add('flow-new');   // 新玩家的封面：只留「开始」（index.html 的样式看这个 class，旧内核不认 :has）
if (wantIntro() && !XHS) {   // 小红书版固定中文，不放换语言
  langBtn = document.createElement('div'); langBtn.id = 'flow-lang'; langBtn.setAttribute('role', 'group'); langBtn.setAttribute('aria-label', 'Language · 语言');
  langBtn.innerHTML = [['en', 'English'], ['zh', '中文']].map(([v, t]) => `<button type="button" lang="${v}" data-to="${v}" aria-pressed="${(v === 'en') === EN}">${t}</button>`).join('');
  langBtn.addEventListener('click', e => {   // 点现在用的那颗不动；点另一颗就换（页面重新加载，回到封面）
    const b = e.target && e.target.closest ? e.target.closest('[data-to]') : null; if (!b || (b.dataset.to === 'en') === EN) return;
    S('ui', 'go'); leaving = true; Y.act('lang');
  });
  stage.appendChild(langBtn);
  // 刚切完语言回来时游戏会直接开首页；新玩家退回封面，从点一下开始（声音和播片都要这一下）
  if (G.state === 'menu') { G.state = 'cover'; card.innerHTML = ''; overlay.hidden = true; deliverBtn.hidden = true; stage.classList.add('cover'); }
}

window.__yuanFlowDebug = { CONFIG, TUT, get phase() { return phase; }, begin, geom, openContract };
})();
