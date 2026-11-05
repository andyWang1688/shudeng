const test = require('node:test');
const assert = require('node:assert/strict');
const { pinEpubPod } = require('./withEpubResources.cjs');
test('pins the exact ZIP source commit and survives repeated Expo prebuild', () => {
  const input = "target 'app' do\n  use_expo_modules!\nend\n";
  const once = pinEpubPod(input);
  assert.match(once, /:commit => 'adb49c8bfe060cc187370b12fa081012a6440b86'/);
  assert.equal(pinEpubPod(once), once);
  assert.match(once, /use_expo_modules!/);
});
test('refuses an ambiguous manual ZIP source and a missing app target', () => {
  assert.throws(() => pinEpubPod("target 'app' do\n  pod 'ReadiumZIPFoundation', '2.0.0'\nend"), /conflicting/);
  assert.throws(() => pinEpubPod('platform :ios'), /target/);
});
