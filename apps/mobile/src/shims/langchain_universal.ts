/** langchain/chat_models/universal 的 Metro 桩：该入口含非字面量动态 import，spike 不使用。 */
export function initChatModel(): never {
  throw new Error('initChatModel 未在本 spike 使用；请使用 providers.createChatModel 或 testing.createScriptedModel');
}
export async function getChatModelByClassName(): Promise<undefined> {
  return undefined;
}
export default { initChatModel, getChatModelByClassName };
