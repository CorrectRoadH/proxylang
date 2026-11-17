// @concord-file
// @concord-implements docs/feature/profile/library/README.md
export * from "./authoring/index.js";
export { runBuild, checkBuild, explainProfile } from "./build/index.js";
export type {
  BuildDefinition,
  CheckResult,
  BuildResult,
  Selection,
  Origin,
} from "./build/index.js";
export type { ProfileDiagnostic as Diagnostic } from "./model/types.js";

export type { Explanation, ExplainResult, CaseResult, Need } from "./model/routing-types.js";
