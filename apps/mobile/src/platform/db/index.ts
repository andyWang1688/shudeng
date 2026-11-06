/** 数据层公共入口：类型检查解析到本文件；Metro 在 iOS/Android 走 initialize.native.ts，Web 走 initialize.web.ts。 */
export type { DatabaseInitResult } from './types';
export type { ShudengDataLayer } from './engine';
export { createShudengDataLayer } from './engine';
export { closeDatabase, getDataLayer, initializeDatabase } from './initialize';
