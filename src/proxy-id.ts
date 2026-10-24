// @concord-file
// @concord-implements docs/feature/target-compilation/README.md
import { createHash } from "node:crypto";

/** Stable identity independent of engine and mutable metadata. */
export function proxyId(namespace: string, label: string): string {
  if (
    typeof namespace !== "string" ||
    !namespace.length ||
    typeof label !== "string" ||
    !label.length
  )
    throw new Error("INVALID_PROXY_ID_INPUT");
  return `node-${createHash("sha256")
    .update(JSON.stringify([namespace, label]))
    .digest("hex")
    .slice(0, 16)}`;
}
