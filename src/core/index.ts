export { createRelaiCoreRuntime } from './runtime.ts';
export type { CoreShutdownResult, RelaiCoreRuntime, RelaiCoreRuntimeOptions } from './runtime.ts';
export {
  getDesktopLocalUsage,
  getDesktopTaskCodeWorkspace,
  getDesktopTaskCodeWorkspacePath,
  markDesktopOnboardingHandoff,
  readDesktopTaskCodeDiff
} from './desktop-operations.ts';
