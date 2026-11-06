import { getDataLayer } from "./db";
import { createAssistantPreferencesStore } from "./settings/assistantPreferences";
export {
  ASSISTANT_INSTRUCTIONS_MAX_LENGTH,
  DEFAULT_ASSISTANT_PREFERENCES,
  type AssistantPreferences,
} from "./settings/assistantPreferences";

const PREFERENCE_KEY = "assistant-preferences:v1";
const store = createAssistantPreferencesStore({
  async read() {
    const layer = await getDataLayer();
    const rows = await layer.driver.all<{ value_json: string }>(
      "SELECT value_json FROM app_preferences WHERE key=?",
      [PREFERENCE_KEY],
    );
    return rows[0]?.value_json ?? null;
  },
  async write(json) {
    const layer = await getDataLayer();
    await layer.driver.run(
      "INSERT INTO app_preferences (key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
      [PREFERENCE_KEY, json],
    );
  },
});

export const loadAssistantPreferences = store.load;
export const saveAssistantPreferences = store.save;
/** Only AI-catalog migration may consume this historical value. */
export const loadLegacyAssistantWebSearchEnabled =
  store.loadLegacyWebSearchEnabled;
