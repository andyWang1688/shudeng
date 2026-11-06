/**
 * Deep Agents' browser barrel eagerly exports its optional LangSmith sandbox.
 * The reader uses StateBackend only; importing a server sandbox must never pull
 * Node filesystem/process APIs into Hermes or pretend to execute locally.
 */
export class LangSmithSandboxError extends Error {}
export class LangSmithResourceNotFoundError extends LangSmithSandboxError {}
export class SandboxClient {
  constructor(..._args: unknown[]) {
    throw new LangSmithSandboxError('LangSmith sandbox is unavailable in the local reading assistant');
  }
}
