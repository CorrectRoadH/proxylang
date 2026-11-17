import type { Profile, ProfileDefinition } from "./profile-types.js";
import type { Secret } from "./types.js";
export type BuildContext = { readonly validation: boolean };
export type BuildDefinition = {
  readonly outDir?: string;
  readonly profiles: Readonly<Record<string, Profile | ProfileDefinition>>;
  readonly secrets?: (token: Secret, context: BuildContext) => string | undefined;
};
