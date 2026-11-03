/**
 * iOS 终版书库数据层（公开入口）。
 *
 * 实现在 ./library/*：旧数据迁移、阅读进度、标注、书架导入、书内对话摘要。
 * 本文件仅做 re-export，保持既有 `../platform/library` import 路径与公开 API 不变。
 */
export * from './library/index';
