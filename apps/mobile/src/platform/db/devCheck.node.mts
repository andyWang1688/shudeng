/**
 * Node dev 入口（无 Expo 运行时）：用 node:sqlite 驱动跑与移动端相同的装配逻辑，
 * 验证 schema/迁移/store/LangGraph checkpoint。运行：
 *   pnpm --filter @shudeng/eval exec tsx ../../apps/mobile/src/platform/db/devCheck.node.mts
 *
 * 该文件扩展名 .mts 不进入 apps/mobile 的 tsc include（node:sqlite 类型只在 Node 环境）。
 */
import { createNodeSQLiteDriver } from '@shudeng/core/db/testing';
import { runDataLayerDevCheck } from './devCheck';
import { createShudengDataLayer } from './engine';

const driver = createNodeSQLiteDriver();
try {
  const layer = await createShudengDataLayer(driver);
  const report = await runDataLayerDevCheck(layer, 'node:sqlite');
  console.log(`[db-dev-check] engine=${report.engine} ok=${report.ok}`);
  for (const step of report.steps) {
    console.log(`  ${step.ok ? 'PASS' : 'FAIL'} ${step.name}: ${step.detail}`);
  }
  if (!report.ok) process.exitCode = 1;
} finally {
  await driver.close();
}
