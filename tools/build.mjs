// 部署时用：把 index.html 里的脚本和样式、flow.js 压缩（去注释、去空白），再预先压好 .br 和 .gz。
//   node tools/build.mjs <源目录（有 index.html、flow.js）> <输出目录>
// 输出目录放到服务器的 public/dist/，collector.py 优先发这里的文件（按浏览器支持挑 br / gzip）。
// 源文件 public/index.html 照旧上传，后台（admin.py）还要从里面读关卡顺序。
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as esbuild from 'esbuild';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node tools/build.mjs <src> <out>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const js = async code => (await esbuild.transform(code, { minify: true, legalComments: 'none', target: 'es2020' })).code;
const css = async code => (await esbuild.transform(code, { loader: 'css', minify: true })).code;

// 按出现顺序一段段处理：<script>（不带 src 的）和 <style>，字符串里出现的标签已经被外层那段吃掉了
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const parts = []; let last = 0;
for (const m of html.matchAll(/(<script>)([\s\S]*?)(<\/script>)|(<style>)([\s\S]*?)(<\/style>)/g)) {
  parts.push(html.slice(last, m.index));
  parts.push(m[1] ? m[1] + (await js(m[2])).replace(/<\/script/gi, '<\\/script') + m[3] : m[4] + await css(m[5]) + m[6]);
  last = m.index + m[0].length;
}
parts.push(html.slice(last));
const files = { 'index.html': parts.join(''), 'flow.js': await js(fs.readFileSync(path.join(src, 'flow.js'), 'utf8')) };

for (const [name, text] of Object.entries(files)) {
  const buf = Buffer.from(text, 'utf8');
  fs.writeFileSync(path.join(out, name), buf);
  const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(out, name + '.br'), br);
  fs.writeFileSync(path.join(out, name + '.gz'), gz);
  console.log(`${name}: ${buf.length} bytes, br ${br.length}, gz ${gz.length}`);
}
