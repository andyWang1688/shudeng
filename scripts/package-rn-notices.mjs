#!/usr/bin/env node
/**
 * Package licenses for the actual Metro bundle, native Pods and inlined reader.
 * Run after the Release build and before codesign. No network or new dependency.
 * Usage: node scripts/package-rn-notices.mjs <app.app> <metro-source-map>
 *        node scripts/package-rn-notices.mjs --check <app.app>
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'apps/mobile');
const TEXT_NAME = 'ThirdPartyNotices.txt';
const MANIFEST_NAME = 'ThirdPartyNotices.manifest.json';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const read = path => readFileSync(path, 'utf8');
const fail = message => { throw new Error(message); };
const licenseName = /^(licen[cs]e|copying|notice|copyright)(?:$|[._-])/i;

function licenseFiles(directory) {
  const result = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && licenseName.test(entry.name)) result.push(path);
    }
  }
  walk(directory);
  return result.sort();
}

function packageOf(source, mapDirectory, sourceRoot = '') {
  if (!source.includes('node_modules/')) return null;
  const path = source.startsWith('file://') ? fileURLToPath(source) : source;
  const projectRelative = /^\/(?:node_modules|apps|packages)\//.test(path);
  const candidates = isAbsolute(path) ? [path, ...(projectRelative ? [join(ROOT, path.slice(1))] : [])] : [
    resolve(mapDirectory, sourceRoot, path), resolve(MOBILE, sourceRoot, path), resolve(ROOT, sourceRoot, path),
  ];
  const existing = candidates.find(existsSync);
  if (!existing) fail('Cannot resolve bundled source: ' + source);
  for (let directory = dirname(realpathSync(existing)); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (!existsSync(manifest)) continue;
    const metadata = JSON.parse(read(manifest));
    if (metadata.name && metadata.version) {
      if (metadata.name.startsWith('@shudeng/')) return null;
      return { directory, metadata };
    }
  }
  fail('Cannot find package owner of ' + source);
}

function bundledPackages(sourceMapPath) {
  const packages = new Map();
  function visit(map) {
    if (map.sections) { for (const section of map.sections) visit(section.map); return; }
    for (const source of map.sources ?? []) {
      const owner = packageOf(source, dirname(sourceMapPath), map.sourceRoot);
      if (owner) packages.set(owner.directory, owner);
    }
  }
  visit(JSON.parse(read(sourceMapPath)));
  if (!packages.size) fail('Metro source map contains no npm packages');
  return packages;
}

function fallbackLicense(metadata, overrides) {
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url ?? '';
  const monorepo = [
    [/github.com[/:](?:facebook|react)\/react-native(?:\.git)?$/, 'react-native'],
    [/github.com[/:]expo\/expo(?:\.git)?$/, 'expo'],
    [/github.com[/:]facebook\/react(?:\.git)?$/, 'react'],
  ].find(([pattern]) => pattern.test(repository));
  if (monorepo && metadata.license === 'MIT') {
    const path = join(MOBILE, 'node_modules', monorepo[1], 'LICENSE');
    return [{ source: relative(ROOT, path), text: read(path) }];
  }
  if (/github.com[/:]microsoft\/onnxruntime(?:\.git)?$/i.test(repository) && metadata.license === 'MIT') {
    const path = join(MOBILE, 'ios/Pods/onnxruntime-c/LICENSE');
    return [{ source: relative(ROOT, path), text: read(path) }];
  }
  const override = overrides.find(item => item.packages.includes(metadata.name) && item.license === metadata.license && item.versions.includes(metadata.version));
  if (override) return [{ source: override.source, text: override.text }];
  fail('Missing full license text for ' + metadata.name + '@' + metadata.version + '; add a verified upstream license to scripts/rn-license-overrides.json');
}

function generate(app, sourceMapPath) {
  const overrides = JSON.parse(read(join(ROOT, 'scripts/rn-license-overrides.json')));
  const packages = bundledPackages(sourceMapPath);
  const reader = realpathSync(join(ROOT, 'packages/reader-web/node_modules/foliate-js'));
  packages.set(reader, { directory: reader, metadata: JSON.parse(read(join(reader, 'package.json'))) });
  const polyfill = realpathSync(join(dirname(reader), 'construct-style-sheets-polyfill'));
  packages.set(polyfill, { directory: polyfill, metadata: JSON.parse(read(join(polyfill, 'package.json'))) });
  const ackPath = join(MOBILE, 'ios/Pods/Target Support Files/Pods-app/Pods-app-acknowledgements.markdown');
  const acknowledgements = read(ackPath);
  const onnxVersion = read(join(MOBILE, 'ios/Podfile.lock')).match(/^  - onnxruntime-c \(([^)]+)\)/m)?.[1];
  if (!onnxVersion) fail('Cannot determine distributed native ONNX Runtime version');
  const onnxNotices = read(join(ROOT, 'scripts/rn-licenses/onnxruntime-v' + onnxVersion + '-ThirdPartyNotices.txt'));
  for (const required of ['React-Core', 'Expo', 'ReadiumZIPFoundation', 'onnxruntime-c']) {
    if (!acknowledgements.includes('## ' + required + '\n')) fail('Native acknowledgements missing ' + required);
  }
  const patches = [...read(join(ROOT, 'pnpm-workspace.yaml')).matchAll(/^  ([^:\n]+): (patches\/[^\n]+)$/gm)]
    .filter(([, dependency]) => [...packages.values()].some(({ metadata }) => metadata.name + '@' + metadata.version === dependency))
    .map(([, dependency, path]) => dependency + '\n' + [...read(join(ROOT, path)).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(([, file]) => '  Modified by Shudeng: ' + file).join('\n'));
  const sections = ['Shudeng React Native third-party notices',
    'Generated from the distributed Metro bundle, CocoaPods acknowledgements and inlined Foliate reader.\n' +
    'The inlined reader uses the pinned Readest Foliate fork. Local modifications:\n' + patches.join('\n') + '\n',
    '=== Native CocoaPods acknowledgements ===\n' + acknowledgements,
    '=== Native ONNX Runtime third-party notices ===\n' + onnxNotices];
  const manifestPackages = [];
  const sorted = [...packages.values()].sort((a, b) => (a.metadata.name + '@' + a.metadata.version).localeCompare(b.metadata.name + '@' + b.metadata.version));
  for (const { directory, metadata } of sorted) {
    const files = metadata.name === 'foliate-js' ? [join(directory, 'LICENSE')] : licenseFiles(directory);
    const rootLicense = files.some(path => dirname(path) === directory && /^(licen[cs]e|copying)(?:$|[._-])/i.test(path.slice(directory.length + 1)));
    const notices = files.map(path => ({ source: relative(directory, path), text: read(path) }));
    if (!rootLicense) notices.unshift(...fallbackLicense(metadata, overrides));
    if (notices.some(notice => !notice.text.trim())) fail('Empty license for ' + metadata.name);
    sections.push('=== npm: ' + metadata.name + '@' + metadata.version + ' (' + metadata.license + ') ===\n' +
      notices.map(notice => '--- ' + notice.source + ' ---\n' + notice.text.trim()).join('\n\n'));
    manifestPackages.push({ name: metadata.name, version: metadata.version, license: metadata.license,
      notices: notices.map(({ source, text }) => ({ source, sha256: sha256(text) })) });
  }
  const zip = overrides.find(item => item.packages.includes('@zip.js/zip.js'));
  if (!zip) fail('Missing license for Foliate vendored zip.js');
  sections.push('=== Foliate vendored zip.js ===\n' + zip.source + '\n' + zip.text);
  sections.push(read(join(ROOT, 'scripts/rn-licenses/zip-js-2.7.52-inflate-notice.txt')));
  const fflateLicense = join(MOBILE, 'node_modules/fflate/LICENSE');
  sections.push('=== Foliate vendored fflate ===\n' + read(fflateLicense));
  const text = sections.join('\n\n') + '\n';
  const manifest = { format: 1, generator: 'scripts/package-rn-notices.mjs',
    metroSourceMapSha256: sha256(readFileSync(sourceMapPath)),
    bundleSha256: sha256(readFileSync(join(app, 'main.jsbundle'))),
    nativeAcknowledgementsSha256: sha256(acknowledgements),
    noticesSha256: sha256(text), packages: manifestPackages };
  writeFileSync(join(app, TEXT_NAME), text);
  writeFileSync(join(app, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Packaged full notices for ' + manifestPackages.length + ' bundled npm packages, Pods and reader vendors');
}

function check(app) {
  const manifest = JSON.parse(read(join(app, MANIFEST_NAME)));
  if (manifest.format !== 1 || manifest.generator !== 'scripts/package-rn-notices.mjs') fail('Unknown RN license manifest');
  if (manifest.noticesSha256 !== sha256(readFileSync(join(app, TEXT_NAME)))) fail('ThirdPartyNotices.txt does not match license manifest');
  if (manifest.bundleSha256 !== sha256(readFileSync(join(app, 'main.jsbundle')))) fail('Bundle changed after license packaging');
  for (const required of ['react-native', 'expo', 'foliate-js']) {
    if (!manifest.packages?.some(item => item.name === required && item.notices?.length)) fail('Missing bundled package license: ' + required);
  }
  console.log('PASS: RN license manifest and distributed bundle match');
}

try {
  const args = process.argv.slice(2);
  if (args[0] === '--check' && args.length === 2) check(resolve(args[1]));
  else if (args.length === 2) generate(resolve(args[0]), resolve(args[1]));
  else fail('Usage: node scripts/package-rn-notices.mjs <app.app> <metro-source-map> | --check <app.app>');
} catch (error) {
  console.error('FAIL: ' + error.message);
  process.exitCode = 1;
}
