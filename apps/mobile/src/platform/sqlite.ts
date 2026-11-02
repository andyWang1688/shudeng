/** 类型检查入口；Metro 在 iOS/Android 走 sqlite.native.ts，Web 走 sqlite.web.ts。 */
export { initializeDatabase } from './sqlite.native';
