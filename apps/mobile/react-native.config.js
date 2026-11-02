// onnxruntime-react-native ships an Expo config plugin that adds the Gradle
// dependency but does not contribute an Android ReactPackage to autolinking
// under Expo 58. Add it explicitly so NativeModules.Onnxruntime exists.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
}
