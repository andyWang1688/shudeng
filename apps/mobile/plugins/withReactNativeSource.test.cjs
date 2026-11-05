const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { sourceProperties, sourcePodfile } = require('./withReactNativeSource.cjs');

test('source build properties survive repeated prebuild and preserve unrelated settings', () => {
  const original = { 'expo.jsEngine': 'hermes', 'ios.buildReactNativeFromSource': 'false', EXPO_USE_PRECOMPILED_MODULES: 'true' };
  const once = sourceProperties(original);
  assert.deepEqual(sourceProperties(once), once);
  assert.equal(once['ios.buildReactNativeFromSource'], 'true');
  assert.equal(once.EXPO_USE_PRECOMPILED_MODULES, 'false');
  assert.equal(once['expo.jsEngine'], 'hermes');
  assert.equal(original['ios.buildReactNativeFromSource'], 'false');
});

test('Podfile enforces one source block before helpers, including inherited binary overrides', () => {
  const original = "require 'react_native_pods'\nENV['RCT_USE_PREBUILT_RNCORE'] ||= '1'\nuse_react_native!()\n";
  const once = sourcePodfile(original);
  assert.equal(sourcePodfile(once), once);
  assert.equal((once.match(/@generated begin/g) || []).length, 1);
  assert(once.indexOf("ENV['RCT_USE_PREBUILT_RNCORE'] = '0'") < once.indexOf('require'));
  assert(once.includes(original));
  assert.throws(() => sourcePodfile('platform :ios'), /no use_react_native!/);
});

test('registered Expo plugin applies both mods to the real project configuration', () => {
  const source = fs.readFileSync(require.resolve('./withReactNativeSource.cjs'), 'utf8');
  const exports = {};
  const recorded = [];
  const module = { exports };
  vm.runInNewContext(source, {
    module, exports,
    require(name) {
      assert.equal(name, 'expo/config-plugins');
      return {
        withPodfileProperties(config, action) { recorded.push(['properties', action]); return config; },
        withPodfile(config, action) { recorded.push(['podfile', action]); return config; },
      };
    },
  });
  const config = JSON.parse(fs.readFileSync(require.resolve('../app.json'), 'utf8'));
  assert(config.expo.plugins.includes('./plugins/withReactNativeSource.cjs'));
  assert.equal(module.exports(config), config);
  assert.deepEqual(recorded.map(([kind]) => kind), ['properties', 'podfile']);
  const props = recorded[0][1]({ modResults: { kept: 'yes' } }).modResults;
  assert.equal(props.kept, 'yes');
  assert.equal(props['ios.buildReactNativeFromSource'], 'true');
  const pod = recorded[1][1]({ modResults: { contents: 'use_react_native!()\n' } }).modResults.contents;
  assert(pod.startsWith('# shudeng-react-native-source'));
});
