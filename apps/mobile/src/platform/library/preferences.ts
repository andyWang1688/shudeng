/** Small persisted UI preferences; values are validated by each owning screen. */
import { getDataLayer } from '../db';

export async function loadAppPreference(key: string): Promise<unknown> {
  const layer = await getDataLayer();
  const rows = await layer.driver.all<{ value_json: string }>(
    'SELECT value_json FROM app_preferences WHERE key=?',
    [key],
  );
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].value_json) as unknown;
  } catch {
    return null;
  }
}

export async function saveAppPreference(key: string, value: unknown): Promise<void> {
  const layer = await getDataLayer();
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('无法保存空白偏好');
  await layer.driver.run(
    'INSERT INTO app_preferences (key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',
    [key, json],
  );
}
