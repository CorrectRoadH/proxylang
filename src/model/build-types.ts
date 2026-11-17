import type { Profile, Secrets } from "./profile-types.js";
import type { SDK } from "./identity.js";
export type BuildDefinition = {
  readonly outDir?: string;
  readonly profiles: Readonly<Record<string, Profile>>;
  readonly secrets?: Secrets;
} & SDK<"build">;
