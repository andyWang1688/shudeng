import { Tabs } from 'expo-router';
import { BottomBar } from '../../src/ui/BottomBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <BottomBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: '书架' }} />
      <Tabs.Screen name="notes" options={{ title: '笔记' }} />
      <Tabs.Screen name="conversations" options={{ title: '对话' }} />
      <Tabs.Screen name="profile" options={{ title: '我的' }} />
    </Tabs>
  );
}
