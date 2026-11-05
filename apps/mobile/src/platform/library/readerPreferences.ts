import { getDataLayer } from '../db';
import { parseLegacyJSON } from './legacyMigration';
import { isRecord } from './pure';
import { legacyBookDataDeletedKey } from './bookFileOperations';

export type ReaderPreferences = {
  readonly format: 'epub' | 'pdf';
  readonly theme: 'light' | 'dark';
  readonly fontScale: number;
  readonly flow: 'paginated' | 'scrolled' | 'curl';
};

export async function loadReaderPreferences(bookId: string, defaults: { readonly format: 'epub' | 'pdf'; readonly theme?: 'light' | 'dark'; readonly flow?: ReaderPreferences['flow'] }): Promise<ReaderPreferences> {
  const { driver } = await getDataLayer();
  let [row] = await driver.all('SELECT format, theme, font_scale, flow FROM reader_preferences WHERE book_id = ?', [bookId]);
  if (!row) {
    const library = parseLegacyJSON('library.json');
    const legacy = Array.isArray(library) ? library.find(entry => isRecord(entry) && entry.id === bookId) : undefined;
    const settings = isRecord(legacy) && isRecord(legacy.readingSettings) ? legacy.readingSettings : undefined;
    if (settings) {
      const migrated: ReaderPreferences = {
        format: defaults.format,
        theme: typeof settings.dark === 'boolean' ? settings.dark ? 'dark' : 'light' : defaults.theme ?? 'light',
        fontScale: typeof settings.fontSize === 'number' ? Math.max(.75, Math.min(2, settings.fontSize / 100)) : 1,
        flow: defaults.format === 'pdf'
          ? typeof settings.pdfScroll === 'boolean' ? settings.pdfScroll ? 'scrolled' : 'paginated' : defaults.flow ?? 'paginated'
          : settings.pageCurl === true ? 'curl' : settings.scroll === true ? 'scrolled' : 'paginated',
      };
      const saved = await driver.run(
        `INSERT OR IGNORE INTO reader_preferences (book_id, format, theme, font_scale, flow, updated_at)
         SELECT id, ?, ?, ?, ?, ? FROM books WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM book_file_operations WHERE id = books.id)
           AND NOT EXISTS (SELECT 1 FROM app_preferences WHERE key = ?)`,
        [migrated.format, migrated.theme, migrated.fontScale, migrated.flow, Date.now(), bookId, legacyBookDataDeletedKey(bookId)],
      );
      if (saved.changes > 0) return migrated;
      [row] = await driver.all('SELECT format, theme, font_scale, flow FROM reader_preferences WHERE book_id = ?', [bookId]);
    }
  }
  return {
    format: defaults.format,
    theme: row?.theme === 'dark' ? 'dark' : row?.theme === 'light' ? 'light' : defaults.theme ?? 'light',
    fontScale: typeof row?.font_scale === 'number' ? Math.max(.75, Math.min(2, row.font_scale)) : 1,
    flow: row?.flow === 'scrolled' || row?.flow === 'curl' || row?.flow === 'paginated' ? row.flow : defaults.flow ?? 'paginated',
  };
}

export async function saveReaderPreferences(bookId: string, preferences: ReaderPreferences): Promise<void> {
  if (!Number.isFinite(preferences.fontScale) || preferences.fontScale < .75 || preferences.fontScale > 2) throw new Error('字号超出可保存范围');
  const { driver } = await getDataLayer();
  await driver.run('INSERT INTO reader_preferences (book_id, format, theme, font_scale, flow, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET format=excluded.format, theme=excluded.theme, font_scale=excluded.font_scale, flow=excluded.flow, updated_at=excluded.updated_at', [bookId, preferences.format, preferences.theme, preferences.fontScale, preferences.flow, Date.now()]);
}
