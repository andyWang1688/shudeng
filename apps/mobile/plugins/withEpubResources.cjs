const { withPodfile } = require('expo/config-plugins');
const BEGIN = '  # shudeng-epub-resources @generated begin';
const END = '  # shudeng-epub-resources @generated end';
const PIN = "  pod 'ReadiumZIPFoundation', :git => 'https://github.com/readium/ZIPFoundation.git', :commit => 'adb49c8bfe060cc187370b12fa081012a6440b86'";

function pinEpubPod(contents) {
  const block = [BEGIN, PIN, END].join('\n');
  const generated = /  # shudeng-epub-resources @generated begin[\s\S]*?  # shudeng-epub-resources @generated end/;
  if (generated.test(contents)) return contents.replace(generated, block);
  if (/^\s*pod\s+['"]ReadiumZIPFoundation['"]/m.test(contents)) throw new Error('ReadiumZIPFoundation already has a source declaration; remove the conflicting declaration before prebuild');
  const target = /^target\s+['"][^'"]+['"]\s+do\s*$/m;
  if (!target.test(contents)) throw new Error('Cannot pin EPUB ZIP dependency: iOS app target is missing');
  return contents.replace(target, line => line + '\n' + block);
}

module.exports = config => withPodfile(config, mod => { mod.modResults.contents = pinEpubPod(mod.modResults.contents); return mod; });
module.exports.pinEpubPod = pinEpubPod;
