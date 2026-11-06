// Export one portable review file with all images and frames included.
import {readFile, readdir, writeFile, rename, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, extname} from 'node:path';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const mime = {'.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg'};
const safeJSON = value => JSON.stringify(value).replaceAll('<', '\u003c');
const escapeHTML = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function installEmbeddedFrames() {
  const bundle = JSON.parse(document.querySelector('#design-bundle').textContent);
  document.querySelector('[data-design-spec]').addEventListener('click', () => { document.querySelector('#design-spec').open = true; });
  document.querySelectorAll('iframe[data-preview]').forEach(frame => {
    const query = new URL(frame.dataset.preview, 'https://design.invalid/').search;
    const appScript = bundle.script.replace('new URLSearchParams(location.search)', 'new URLSearchParams(' + JSON.stringify(query) + ')');
    const childScript = 'const designAssets = ' + JSON.stringify(bundle.assets) + ';\n' + appScript;
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + bundle.css + '</style></head><body>' + bundle.body + '<scr' + 'ipt>' + childScript + '</scr' + 'ipt></body></html>';
  });
}

export async function exportPreview({root = sourceRoot, output = resolve(root, 'standalone.html')} = {}) {
  const [index, app, css, originalScript, spec, license, names] = await Promise.all([
    readFile(resolve(root, 'index.html'), 'utf8'),
    readFile(resolve(root, 'app.html'), 'utf8'),
    readFile(resolve(root, 'app.css'), 'utf8'),
    readFile(resolve(root, 'app.js'), 'utf8'),
    readFile(resolve(root, 'spec.md'), 'utf8'),
    readFile(resolve(root, 'assets/PHOSPHOR-LICENSE'), 'utf8'),
    readdir(resolve(root, 'assets'))
  ]);
  const assets = Object.fromEntries(await Promise.all(names.filter(name => mime[extname(name)]).sort().map(async name => {
    const data = await readFile(resolve(root, 'assets', name));
    return [name, 'data:' + mime[extname(name)] + ';base64,' + data.toString('base64')];
  })));
  const required = new Set(['app-icon.png', 'pride-and-prejudice.jpg']);
  for (const [,name] of originalScript.matchAll(/(?:icon|btn)\('([a-z-]+)'/g)) required.add(name + '.svg');
  for (const [,name] of originalScript.matchAll(/\['(?:library|notes|chats|profile)','([a-z-]+)','[^']+'\]/g)) required.add(name + '.svg');
  for (const name of required) if (!assets[name]) throw new Error('设计资源缺失：' + name);
  const interpolation = '$' + '{';
  const script = originalScript
    .replaceAll('src="assets/' + interpolation + 'name}.svg"', 'src="' + interpolation + 'designAssets[name + \'.svg\']}"')
    .replace(/src="assets\/([^"$]+)"/g, (_, name) => 'src="' + interpolation + "designAssets['" + name + "']}\"");
  if (script.includes('src="assets/')) throw new Error('存在未内嵌的图片路径');
  const body = app.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const payload = safeJSON({assets, css, script, body});
  const bootstrap = '<script id="design-bundle" type="application/json">' + payload + '</script>\n<script>(' + installEmbeddedFrames.toString() + ')();</script>';
  const portable = index
    .replaceAll('href="assets/app-icon.png"', 'href="' + assets['app-icon.png'] + '"')
    .replaceAll('src="assets/app-icon.png"', 'src="' + assets['app-icon.png'] + '"')
    .replace(/(<iframe\b[^>]*?)\bsrc="/g, '$1data-preview="')
    .replace('href="spec.md" target="_blank" rel="noopener"', 'href="#design-spec" data-design-spec')
    .replace('    <footer class="footer">', '<details id="design-spec"><summary>完整设计说明与图标许可</summary><pre style="white-space:pre-wrap;font:13px/1.8 -apple-system,sans-serif">' + escapeHTML(spec + '\n\nPhosphor Icons Core 2.1.1\n' + license) + '</pre></details>\n    <footer class="footer">')
    .replace('  <script>\n    const screenNotes', bootstrap + '\n  <script>\n    const screenNotes');
  if (!portable.includes('id="design-bundle"')) throw new Error('设计总览入口已改变，请更新导出位置');
  if (Buffer.byteLength(portable) > 3 * 1024 * 1024) throw new Error('设计稿超过3 MiB保留上限');
  const temporary = output + '.tmp-' + process.pid;
  try {
    await writeFile(temporary, portable);
    await rename(temporary, output);
  } finally {
    await rm(temporary, {force:true});
  }
  return {output, bytes:Buffer.byteLength(portable), assets:Object.keys(assets).length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(await exportPreview());
