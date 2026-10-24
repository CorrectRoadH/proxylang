// @concord-file
// @concord-implements docs/feature/target-compilation/README.md
import { createHash } from "node:crypto";

/** Stable identity independent of engine and mutable metadata. */
export function proxyId(provider: string, label: string): string {
  if (
    typeof provider !== "string" ||
    !provider.length ||
    typeof label !== "string" ||
    !label.length
  )
    throw new Error("INVALID_PROXY_ID_INPUT");
  return `node-${createHash("sha256")
    .update(JSON.stringify([provider, label]))
    .digest("hex")
    .slice(0, 16)}`;
}
