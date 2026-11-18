// @concord-file
// @concord-implements docs/feature/targets/format/sing-box.md
import type { NormalizedProfile } from "../../model/types.js";
import type { EngineChecks } from "../../targets/check.js";
import { unsafeTunResolvers } from "../../model/tun.js";
export function engineChecks(model: NormalizedProfile): EngineChecks {
  const t = model.target;
  return {
    node() {},
    group(group, error) {
      if (group.members.some((x) => ["DIRECT", "REJECT"].includes(x)) && group.type !== "select")
        error("GROUP_BUILTIN_UNSUPPORTED", `groups.${group.id}`);
    },
    profile(error) {
      if (model.dns?.length && t.mode !== "standalone") error("DNS_MODE_UNSUPPORTED", "dns");
      if (model.cacheFile !== undefined && t.mode !== "standalone")
        error("PROGRAM_OPTION_UNSUPPORTED", "singBox.cacheFile");
      if (model.tun) {
        if (t.mode !== "standalone") error("TUN_TARGET_UNSUPPORTED", "singBox.tun");
        if (unsafeTunResolvers(model).length) error("TUN_DNS_LOOP", "singBox.tun");
      }
    },
    match(m, path, nested, error) {
      if ("includeSniffed" in m && m.includeSniffed && model.domainMatching !== "prefer-sniffed")
        error("MATCH_OPTION_UNSUPPORTED", path);
      if (m.type === "ipCidr" && nested && m.noResolve !== true) error("RESOLVE_NESTED", path);
      if (m.type === "nativeRuleSet" && m.engine === "sing-box" && m.resolve && nested)
        error("RESOLVE_NESTED", path);
    },
  };
}
