// @concord-file
// @concord-implements docs/feature/targets/README.md
import { ProfileDefinitionError } from "../model/definitions.js";
import { createHash } from "node:crypto";

/** Stable identity independent of engine and mutable metadata. */
export function proxyId(namespace: string, name: string): string {
  if (
    typeof namespace !== "string" ||
    !namespace.length ||
    typeof name !== "string" ||
    !name.length
  )
    throw new ProfileDefinitionError("INVALID_FIELD");
  return `node-${createHash("sha256")
    .update(JSON.stringify([namespace, name]))
    .digest("hex")
    .slice(0, 16)}`;
}
