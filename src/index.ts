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

export { StaticRuleSetUnknownError } from "./rules.js";
export type { CaseResult } from "./compiler.js";
export type { ProxyBuilder } from "./proxy-builder.js";
export { compileProxyNodes, renderProxyNodes } from "./proxy-fragments.js";
export type { ProxyNodeInput, ProxyNodeCompilation, ProxyNodeArtifact } from "./proxy-fragments.js";
export { compileSurgeProfile, renderSurgeProfile, renderSurgeProfiles } from "./surge-profile.js";
export type {
  SurgeProfileInput,
  SurgeProfileCompilation,
  SurgeProfileArtifact,
  SurgeCondition,
  SurgePolicy,
  SurgeRule,
  SurgeGeneral,
  SurgeHost,
  SurgeGroup,
  SurgeTunnel,
} from "./surge-profile.js";

export { surgeProfile, surgeMembers } from "./surge-compose.js";
export { buildSurgeProfilesToDirectory } from "./surge-host.js";

export {
  defineProxyGroup,
  defineRoute,
  defineRoutes,
  defineSurgeProfile,
  selectProxies,
  outbound,
  ProfileDefinitionError,
} from "./surge-definitions.js";
export type {
  ProxyGroupDefinition,
  RouteDefinition,
  SurgeProfileDefinition,
  Destination,
} from "./surge-definitions.js";

export { defineSurgeBuild, runSurgeBuild } from "./surge-build.js";
export type { SurgeBuildDefinition, SurgeBuildResult, SurgeBuildContext } from "./surge-build.js";

export {
  defineProfile,
  compileProfile,
  type Profile,
  type ProfileDefinition,
  type ProfileCondition,
  type ProfileDestination,
  type ProfileCompilation,
  type SurgeConfig,
  type DeepReadonly,
} from "./profile.js";

export {
  defineBuild,
  runBuild,
  type BuildDefinition,
  type BuildContext,
  type ProfileBuildResult,
} from "./profile-build.js";
