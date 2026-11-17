// @concord-file
// @concord-implements docs/feature/profile/library/README.md#秘密
import type { Secrets, SecretRef } from "./profile-types.js";
export type SecretSource = {
  readonly env?: string;
  readonly value?: string;
  readonly validation?: string;
};
export const secretSources = new WeakMap<object, ReadonlyMap<SecretRef, SecretSource>>();
export function sourceFor(secrets: Secrets | undefined, ref: SecretRef): SecretSource | undefined {
  return secrets ? secretSources.get(secrets)?.get(ref) : undefined;
}
