/** 移动端数据层初始化结果类型（平台无关，Web stub 与 native 共用）。 */
export interface DatabaseInitResult {
  readonly ok: boolean;
  /** 'expo-sqlite'（iOS/Android）或 'web-stub'。 */
  readonly engine: 'expo-sqlite' | 'web-stub';
  readonly detail: string;
  /** 建表完成后 sqlite_master 中的业务表数量（native 成功时）。 */
  readonly tableCount?: number;
  /** 本次迁移实际应用的迁移 id（幂等重跑为空）。 */
  readonly appliedMigrations?: readonly string[];
}
