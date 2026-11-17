// @concord-file
// @concord-implements docs/feature/profile/library/README.md#引用规则
// @concord-implements docs/feature/targets/README.md#诊断
import { fileURLToPath } from "node:url";
export type Origin = { readonly file: string; readonly line: number; readonly column: number };
export declare const sdkIdentity: unique symbol;
export type SDK<K extends string> = { readonly [sdkIdentity]: K };
export type Kind =
  | "node"
  | "group"
  | "tunnel"
  | "endpoint"
  | "builtin"
  | "secret"
  | "secrets"
  | "ruleSet"
  | "condition"
  | "route"
  | "profile"
  | "build"
  | "algorithm"
  | "dns"
  | "case";
const kinds = new WeakMap<object, Kind>();
const origins = new WeakMap<object, Origin>();
export function kindOf(value: unknown): Kind | undefined {
  return value !== null && typeof value === "object" ? kinds.get(value) : undefined;
}
export function originOf(value: unknown): Origin | undefined {
  return value !== null && typeof value === "object" ? origins.get(value) : undefined;
}
export function captureOrigin(): Origin | undefined {
  for (const frame of (new Error().stack ?? "").split("\n").slice(1)) {
    const match = /(?:at\s+(?:.*?\s+\()?)(file:\/\/\/[^\s)]+|\/[^\s)]+):(\d+):(\d+)\)?$/.exec(
      frame,
    );
    if (!match) continue;
    let file = match[1]!;
    if (file.startsWith("file:")) file = fileURLToPath(file);
    if (/\/(?:src\/(?:authoring|model|build)|dist|node_modules)\//.test(file)) continue;
    return Object.freeze({ file, line: Number(match[2]), column: Number(match[3]) });
  }
}
export function register<T extends object, K extends Kind>(
  value: T,
  kind: K,
  origin = captureOrigin(),
): T & SDK<K> {
  kinds.set(value, kind);
  if (origin) origins.set(value, origin);
  return Object.freeze(value) as T & SDK<K>;
}
