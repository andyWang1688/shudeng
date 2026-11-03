/**
 * 数据层公开入口（原 platform/library.ts 的 API 不变）：
 * - legacyMigration：旧 Swift 数据迁移
 * - progress：阅读进度
 * - annotations：高亮/笔记/书签
 * - import：书架读取与导入/删除
 * - conversations：书内对话摘要
 */
export * from './types';
export * from './legacyMigration';
export * from './progress';
export * from './annotations';
export * from './import';
export * from './conversations';
