// Expo + workspace(@shudeng/core) + LangChain/LangGraph on Hermes.
// 目标：让核心包的纯 TS 源码与少量 Node 内置依赖可以在 Metro 里打包；
// 运行时行为尽量贴近浏览器/单线程 JS（AsyncLocalStorage 用同步栈模拟）。
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// monorepo：能解析 workspace 源码与根 node_modules（pnpm 隔离布局）
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

const shim = (name) => path.resolve(projectRoot, 'src/shims', `${name}.ts`);
const aliases = {
  async_hooks: shim('async_hooks'),
  'node:async_hooks': shim('async_hooks'),
  path: shim('path'),
  'node:path': shim('path'),
  util: shim('util'),
  'node:util': shim('util'),
  events: shim('events'),
  'node:events': shim('events'),
  stream: shim('stream'),
  'node:stream': shim('stream'),
  buffer: shim('buffer'),
  'node:buffer': shim('buffer'),
  crypto: shim('crypto'),
  'node:crypto': shim('crypto'),
  fs: shim('fs'),
  'node:fs': shim('fs'),
  os: shim('os'),
  'node:os': shim('os'),
  url: shim('url'),
  'node:url': shim('url'),
  'node:process': shim('process'),
  diagnostics_channel: shim('diagnostics_channel'),
  'node:diagnostics_channel': shim('diagnostics_channel'),
  perf_hooks: shim('perf_hooks'),
  'node:perf_hooks': shim('perf_hooks'),
  undici: shim('undici'),
};

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const mapped = aliases[moduleName];
  if (mapped) {
    return { type: 'sourceFile', filePath: mapped };
  }
  // langchain 的 universal chat model 入口含 `import(config.package)`（非字面量动态 import），
  // Metro/Babel 无法静态解析；本 spike 不使用 initChatModel，直接用桩替代该模块。
  if (moduleName.includes('chat_models/universal')) {
    return { type: 'sourceFile', filePath: shim('langchain_universal') };
  }
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    // packages/core 是 ESM TS，源码里的相对 import 带 .js 后缀；Metro 需要回退到无后缀解析 .ts。
    if (moduleName.endsWith('.js') && (moduleName.startsWith('./') || moduleName.startsWith('../'))) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
