const { withPodfile, withPodfileProperties } = require('expo/config-plugins');

const BEGIN = '# shudeng-react-native-source @generated begin';
const END = '# shudeng-react-native-source @generated end';

// This source-build contract accompanies patches/react-native@0.88.1.patch,
// which changes TextAttributes ABI. Remove this plugin only with that patch.
function sourceProperties(properties) {
  return {
    ...properties,
    'ios.buildReactNativeFromSource': 'true',
    // Consumers of the patched TextAttributes layout must use the same headers
    // and source-built ReactCore, rather than precompiled Expo modules.
    EXPO_USE_PRECOMPILED_MODULES: 'false',
  };
}

function sourcePodfile(contents) {
  // The generated Podfile defaults use ||=, so inherited environment variables
  // can otherwise silently restore a binary with the old TextAttributes ABI.
  const block = [
    BEGIN,
    "ENV['RCT_USE_RN_DEP'] = '0'",
    "ENV['RCT_USE_PREBUILT_RNCORE'] = '0'",
    "ENV['EXPO_USE_PRECOMPILED_MODULES'] = '0'",
    END,
  ].join('\n');
  const generated = /# shudeng-react-native-source @generated begin[\s\S]*?# shudeng-react-native-source @generated end\n?/;
  const withoutPrevious = contents.replace(generated, '');
  if (!/use_react_native!/.test(withoutPrevious)) {
    throw new Error('Cannot enforce source React Native: generated Podfile has no use_react_native! entry');
  }
  // Set these before requiring React Native's CocoaPods helpers: some helpers
  // inspect the environment as they load.
  return block + '\n' + withoutPrevious;
}

module.exports = config => {
  config = withPodfileProperties(config, mod => {
    mod.modResults = sourceProperties(mod.modResults);
    return mod;
  });
  return withPodfile(config, mod => {
    mod.modResults.contents = sourcePodfile(mod.modResults.contents);
    return mod;
  });
};
module.exports.sourceProperties = sourceProperties;
module.exports.sourcePodfile = sourcePodfile;
