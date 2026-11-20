// 小红书小工具版打包：同一套源码（index.html、flow.js、assets/）→ build/xhs/ 目录 + build/fullcircle-xhs.zip
//   node tools/build-xhs.mjs
// 规则来自 minitool-zip-builder Skill 和小工具在线文档（https://miniapp-sandbox.xiaohongshu.com/minitool/doc），要点：
//   - zip 根目录就是 index.html；脚本全部外置成经典脚本（不能有页面内 <script>），样式可以留在页面里
//   - 不能联网：网页版的「检查新版本」那段整段删掉；游戏里的 fetch / sendBeacon 换成直接失败的替身（游戏里本来也按 XHS 关掉了）
//   - 本地数据走容器 Storage：游戏里的 localStorage / sessionStorage 换成 bootstrap.js 提供的替身
//   - 包里只许 html / css / js / 图片 / 字体 / json：背景音乐 mp3、分享预览图 jpg 不带
//   - 根目录 assets/ 会被平台挪到包外按需取、不保证离线，所以素材放 res/
//   - JS 转成 ES2017 / Chrome 61；CSS 给 max() / min() / clamp() / inset 补旧内核能认的前一条写法
// 网页版的打包（tools/build.mjs，树莓派部署用）不受影响。
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FINAL = path.join(ROOT, 'build', 'xhs');
const OUT = FINAL + '.tmp';   // 先在这里做完、自查通过再换成 build/xhs：模拟器盯着那个目录，别让它读到做了一半的
const ZIP = path.join(ROOT, 'build', 'fullcircle-xhs.zip');
const RES = 'res/';
const TARGET = ['es2017', 'chrome61'];
const SKIP_ASSETS = /\.(mp3|jpg)$/i;   // 白名单外的音频；jpg 只是网页分享预览图

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(ZIP, { force: true });

let build = 'dev';
try { build = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch (e) {}

/* ---------- CSS：给旧内核补前一条能认的写法 ---------- */
// 找到值里最里层的 max( / min( / clamp(，换成其中一个参数：优先跟着舞台缩放的（var(--u)），其次百分比 / 视口单位，否则 clamp 取中间、max/min 取第一个
function splitArgs(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function pickArg(fn, args) {
  if (fn === 'clamp' && args.length === 3) return args[1];
  return args.find(a => /var\(--u\)/.test(a)) || args.find(a => /%|v[wh]|vmin|vmax/.test(a)) || args[0];
}
function lowerFns(value) {
  let v = value, guard = 0;
  for (;;) {
    const m = /\b(max|min|clamp)\(/g; let hit = null, x;
    while ((x = m.exec(v))) hit = x;   // 最后一个起始位置 = 最里层的那个（嵌套时内层在后）
    if (!hit || guard++ > 50) return v;
    const start = hit.index, open = start + hit[0].length - 1;
    let depth = 0, end = -1;
    for (let i = open; i < v.length; i++) { if (v[i] === '(') depth++; else if (v[i] === ')') { depth--; if (!depth) { end = i; break; } } }
    if (end < 0) return value;
    const arg = pickArg(hit[1], splitArgs(v.slice(open + 1, end)));
    v = v.slice(0, start) + (/^[\d.]+[a-z%]*$|^var\(|^calc\(/.test(arg) ? arg : `calc(${arg})`) + v.slice(end + 1);
  }
}
function expandInset(value) {
  const p = value.trim().split(/\s+/);
  if (p.length < 1 || p.length > 4 || p.some(x => /[(),]/.test(x))) return null;
  const [t, r = t, b = t, l = r] = p;
  return `top:${t};right:${r};bottom:${b};left:${l}`;
}
const stats = { fn: 0, inset: 0 };
function cssFallbacks(css) {
  return css.replace(/([{;]\s*|\*\/\s*)([a-z-]+)\s*:\s*([^;{}]+?)(\s*)(?=[;}])/g, (all, pre, prop, value, ws) => {
    if (value.includes('${')) return all;   // flow.js 模板字符串里的插值，不碰
    if (prop === 'inset') { const e = expandInset(value.replace(/!important/, '')); if (!e) return all; stats.inset++; return `${pre}${e};${prop}:${value}${ws}`; }
    if (!/\b(max|min|clamp)\(/.test(value) || prop.startsWith('--')) return all;
    const fb = lowerFns(value);
    if (fb === value || /\b(max|min|clamp)\(/.test(fb)) return all;
    stats.fn++;
    return `${pre}${prop}:${fb};${prop}:${value}${ws}`;
  });
}

/* ---------- JS ---------- */
const DEFINE = { localStorage: '__yuanStore', sessionStorage: '__yuanSession', fetch: '__yuanNoNet', 'navigator.sendBeacon': 'undefined' };
const js = async (code, name) => (await esbuild.transform(code, { minify: true, legalComments: 'none', target: TARGET, define: DEFINE, sourcefile: name })).code;
const css = async (code) => (await esbuild.transform(code, { loader: 'css', minify: true, target: TARGET })).code;

/* ---------- index.html ---------- */
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [];
html = html.replace(/<script>([\s\S]*?)<\/script>\n?/g, (m, code) => {
  if (code.includes('yuan-web-only')) return '';   // 网页版专用（检查新版本、刷新）：整段不要
  scripts.push(code); return '';
});
if (scripts.length !== 2) throw new Error(`期望 2 段页面内脚本（语言 + 游戏主体），实际 ${scripts.length} 段：index.html 结构变了，先看看这里`);
html = html.replace(/<script src="flow\.js\?v=[^"]*"[^>]*><\/script>\n?/, '');
html = html.replace(/<!--[\s\S]*?-->\n?/g, '')   // 注释全去掉（有的注释里写着 <script> 字样）
  .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\n?/g, '')
  .replace(/<link rel="icon"[^>]*>\n?/, '')
  .replace(/<meta charset="utf-8">/i, '<meta charset="UTF-8">')
  .replace(/<meta name="viewport" content="[^"]*">/, '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">');
if (!/<html lang="zh-CN">/.test(html)) html = html.replace(/<html[^>]*>/, '<html lang="zh-CN">');
// 样式块：补回退写法、压缩
const styles = [];
html = html.replace(/<style>([\s\S]*?)<\/style>/g, (m, code) => { styles.push(code); return `<style>@@STYLE${styles.length - 1}@@</style>`; });
for (let i = 0; i < styles.length; i++) html = html.replace(`@@STYLE${i}@@`, await css(cssFallbacks(styles[i])));
// 启动画面（脚本没跑起来时看到的就是它）+ 小工具专用样式 + 唯一的入口脚本
const bootCss = await css(`
html.xhs-win body { padding-top: var(--xhs-top); padding-bottom: var(--xhs-bottom); }
html.xhs-win #overlay, html.xhs-win #flow-deal { top: var(--xhs-top); bottom: var(--xhs-bottom); }   /* 铺满屏幕的卡片层（合同、菜单）也让开胶囊 */
html.xhs-win #stage #toast.menu, html.xhs-win #stage.port #toast.menu { top: var(--xhs-top); }
html.xhs-win .fd-next { bottom: var(--xhs-bottom); }   /* 拿到容器窗口信息时：让开顶部胶囊和底部安全区；拿不到就用页面原来的安全区留白 */
body { -webkit-box-sizing: border-box; box-sizing: border-box; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
#xhs-boot { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 50; display: -webkit-box; display: flex; -webkit-box-orient: vertical; flex-direction: column; -webkit-box-align: center; align-items: center; -webkit-box-pack: center; justify-content: center; padding: 24px; text-align: center; background: #1e1747; color: #fff7e3; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; transition: opacity .3s; }
#xhs-boot h1 { margin: 0 0 12px; font-size: 34px; letter-spacing: 4px; color: #ffd35c; }
#xhs-boot p { margin: 0 0 10px; max-width: 320px; font-size: 15px; line-height: 1.6; opacity: .9; }
#xhs-boot .s { font-size: 13px; opacity: .7; }
#xhs-boot.gone, .xhs-note.gone { opacity: 0; pointer-events: none; }
.xhs-note { position: fixed; left: 16px; right: 16px; bottom: 24px; z-index: 60; margin: 0 auto; max-width: 360px; padding: 10px 14px; border-radius: 12px; background: rgba(20, 14, 52, .92); color: #fff7e3; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; text-align: center; transition: opacity .5s; }
`);
html = html.replace('</head>', `<style>${bootCss}</style>\n</head>`);
html = html.replace(/<body([^>]*)>/, `<body$1>
<div id="xhs-boot" aria-busy="true">
  <h1>甲方要圆</h1>
  <p>外星甲方只要圆的东西：拎起来、把凸起转到下面、松手砸圆它。</p>
  <p id="xhs-boot-status" class="s" role="status">正在准备第一单…如果一直没反应，请退出后重新打开。</p>
</div>`);
html = html.replace('</body>', '<script defer src="./bootstrap.js"></script>\n</body>');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

/* ---------- 脚本 ---------- */
const names = [];
for (let i = 0; i < scripts.length; i++) {
  const name = `game${i + 1}.js`;
  fs.writeFileSync(path.join(OUT, name), await js(scripts[i], name));
  names.push('./' + name);
}
let flow = fs.readFileSync(path.join(ROOT, 'flow.js'), 'utf8');
flow = flow.replace(/(style\.textContent = `)([\s\S]*?)(`;)/, (m, a, body, b) => a + cssFallbacks(body) + b);
fs.writeFileSync(path.join(OUT, 'flow.js'), await js(flow, 'flow.js'));
names.push('./flow.js');
const boot = fs.readFileSync(path.join(ROOT, 'tools', 'xhs', 'bootstrap.js'), 'utf8')
  .replace('__SCRIPTS__', JSON.stringify(names)).replace('__BUILD__', build);
fs.writeFileSync(path.join(OUT, 'bootstrap.js'), (await esbuild.transform(boot, { minify: true, legalComments: 'none', target: TARGET })).code);

/* ---------- 素材：assets/ → res/ ---------- */
fs.mkdirSync(path.join(OUT, 'res'));
const copied = [];
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
  if (f.startsWith('.') || SKIP_ASSETS.test(f)) continue;
  fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'res', f));
  copied.push(f);
}
// 颜色的新写法 rgb(255 211 92 / .55) Chrome 61 不认（整条声明会被丢掉），换成 rgba(255,211,92,.55)；只认纯数字的，模板插值不碰
let colorFixes = 0;
const pct = x => x.endsWith('%') ? String(parseFloat(x) / 100) : x;
const lowerColors = t => t.replace(/\brgba?\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?)\s*)?\)/g, (m, r, g, b, a) => { colorFixes++; return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${pct(a)})`; });
// 文本里的素材路径改到 res/；不带的 mp3 / jpg 的路径清空，免得留下包里没有的引用
for (const f of fs.readdirSync(OUT).filter(f => /\.(html|js)$/.test(f))) {
  const p = path.join(OUT, f);
  let t = lowerColors(fs.readFileSync(p, 'utf8'));
  t = t.replace(/https:\/\/fullcircle\.roosterwho\.com[^'"`\s)]*/g, '')   // 网页版的埋点 / 存档接口地址：小工具里用不上，也别让审核看到外部地址
    .replace(/assets\/[\w.-]+\.(mp3|jpg)/g, '').replace(/(["'(`=\s,])(?:\.\/)?assets\//g, `$1${RES}`);
  fs.writeFileSync(p, t);
}

/* ---------- 自查：违规写法、缺的素材 ---------- */
const problems = [], notes = [];
const outFiles = fs.readdirSync(OUT).filter(f => /\.(html|js)$/.test(f));
const all = Object.fromEntries(outFiles.map(f => [f, fs.readFileSync(path.join(OUT, f), 'utf8')]));
const page = all['index.html'];
if (!page) { console.log('  ✗ 没有生成 index.html'); process.exit(1); }
for (const n of names) if (!all[n.slice(2)]) problems.push(`缺脚本 ${n}`);
if (!all['bootstrap.js'] || !page.includes('src="./bootstrap.js"')) problems.push('入口没有引用 bootstrap.js');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(page)) problems.push('index.html 里还有页面内 <script>');
if (/\son[a-z]+=["']/i.test(page)) problems.push('index.html 里有行内事件（onclick= 之类）');
if (/type=["']module["']/.test(page)) problems.push('有 module 脚本');
for (const [f, t] of Object.entries(all)) {
  for (const [re, what] of [[/\beval\(/, 'eval('], [/new Function\(/, 'new Function('], [/javascript:/, 'javascript:'], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bfetch\(/, 'fetch('], [/sendBeacon/, 'sendBeacon'], [/WebSocket/, 'WebSocket'], [/window\.open\(/, 'window.open('], [/requestFullscreen/, 'requestFullscreen'], [/\bimport\(/, 'import('], [/<iframe/, '<iframe'], [/target=["']?_blank/, 'target=_blank']]) {
    if (re.test(t)) problems.push(`${f}: ${what}`);
  }
  if (f !== 'bootstrap.js' && /\blocalStorage\b|\bsessionStorage\b/.test(t)) problems.push(`${f}: 还在直接用浏览器存储`);
  if (/https?:\/\//.test(t)) notes.push(`${f}: 含 http(s):// 字样（${(t.match(/https?:\/\/[^\s"'`)<]*/g) || []).slice(0, 3).join(', ')}）`);
  for (const m of t.matchAll(/res\/[\w.-]+\.\w+/g)) if (!fs.existsSync(path.join(OUT, m[0]))) problems.push(`${f}: 引用了包里没有的 ${m[0]}`);
  for (const [re, what] of [[/\.replaceAll\(/, 'replaceAll'], [/\.at\(-?\d/, '.at()'], [/Object\.hasOwn\(/, 'Object.hasOwn'], [/structuredClone/, 'structuredClone'], [/Object\.fromEntries/, 'Object.fromEntries'], [/\.matchAll\(/, 'matchAll'], [/\.finally\(/, 'Promise.finally'], [/globalThis/, 'globalThis'], [/queueMicrotask/, 'queueMicrotask'], [/\.findLast/, 'findLast'], [/\.roundRect\(/, 'roundRect']]) {
    if (re.test(t)) notes.push(`${f}: 用了 Chrome 61 之后才有的 ${what}（要确认有判断或替代）`);
  }
}
const cssAll = page + all['flow.js'];
if (/\brgba?\(\s*[\d.]+%?\s+[\d.]/.test(cssAll)) notes.push('还有空格分隔的 rgb() 没改写');
for (const [re, what] of [[/:has\(/, ':has()'], [/[;{]translate:/, 'translate 属性'], [/:focus-visible/, ':focus-visible（只影响键盘焦点样式）'], [/[;{](?:row-|column-)?gap:/, 'flex gap（旧内核上间距会没有）'], [/text-wrap/, 'text-wrap（只影响换行美观）'], [/\bd?vh\b/, 'vh/dvh']]) {
  if (re.test(cssAll)) notes.push(`CSS 用到 ${what}`);
}

/* ---------- 打包 ---------- */
if (problems.length) { for (const p of problems) console.log('  ✗ ' + p); process.exit(1); }
fs.rmSync(FINAL, { recursive: true, force: true });
fs.renameSync(OUT, FINAL);
execFileSync('zip', ['-r', '-X', '-q', ZIP, '.', '-x', '*.DS_Store'], { cwd: FINAL });
const size = f => fs.statSync(f).size;
const dirSize = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? dirSize(path.join(d, e.name)) : size(path.join(d, e.name))), 0);
console.log(`版本 ${build}`);
console.log(`目录 ${path.relative(ROOT, FINAL)}：${(dirSize(FINAL) / 1024).toFixed(0)} KB；zip ${path.relative(ROOT, ZIP)}：${(size(ZIP) / 1024).toFixed(0)} KB`);
console.log(`脚本（按顺序）：${names.join(' → ')}；素材 ${copied.length} 个（不带 mp3 / jpg）`);
console.log(`CSS 回退：max/min/clamp ${stats.fn} 处，inset ${stats.inset} 处；颜色写法改写 ${colorFixes} 处`);
for (const n of notes) console.log('  注意 ' + n);
if (problems.length) { for (const p of problems) console.log('  ✗ ' + p); process.exit(1); }
console.log('自查通过');
