import { useRouter } from "expo-router";
import { SemanticSettingsScreen } from "../../../src/ui/settings/SemanticSettingsScreen";

export default function SemanticSettingsRoute() {
  const router = useRouter();
  return <SemanticSettingsScreen onBack={() => router.back()} />;
}
