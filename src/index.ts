// @concord-file
// @concord-implements docs/feature/rule-composition/README.md
export * from "./types.js";
export * from "./dsl.js";
export { compile, explain, targetCatalog } from "./compiler.js";
export type { Compilation, TargetPlan } from "./compiler.js";
export { render, RenderError } from "./render.js";
export type { Artifact } from "./render.js";
export { buildToDirectory } from "./host.js";
export type { BuildResult } from "./host.js";

export { compileStrategyGroups } from "./strategies.js";
export type { StrategyGroupInput, StrategyGroupCompilation } from "./strategies.js";
