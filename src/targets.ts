// @concord-file
// @concord-implements docs/feature/target-compilation/README.md
import { deepFreeze } from "./schema.js";
export const targetCatalog = deepFreeze([
  {
    engine: "sing-box",
    version: "1.11.0",
    platforms: ["linux", "macos"],
    protocols: ["trojan", "http"],
    groups: ["select", "urltest"],
    dns: "legacy",
  },
  {
    engine: "sing-box",
    version: "1.12.0",
    platforms: ["linux", "macos"],
    protocols: ["trojan", "http", "anytls"],
    groups: ["select", "urltest"],
    dns: "typed",
  },
  {
    engine: "surge",
    version: "6.10.0",
    platforms: ["macos"],
    protocols: ["trojan", "http", "anytls"],
    groups: ["select", "surge-smart"],
    dns: "general",
  },
  {
    engine: "mihomo",
    version: "1.19.32",
    platforms: ["linux", "macos"],
    protocols: ["trojan", "http", "anytls"],
    groups: ["select", "urltest"],
    dns: "clash",
  },
  {
    engine: "stash",
    version: "4.2.1",
    platforms: ["macos"],
    protocols: ["trojan", "http", "anytls"],
    groups: ["select"],
    dns: "external",
  },
] as const);
