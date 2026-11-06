// Standalone visual experiment: deliberately bypasses the product router, stores and AI.
import "react-native-gesture-handler";
import { registerRootComponent } from "expo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { VisualDemo } from "./src/ui/visual-demo/VisualDemo";

function DemoRoot() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <VisualDemo />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

registerRootComponent(DemoRoot);
