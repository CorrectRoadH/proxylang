// @concord-file
// @concord-implements docs/feature/targets/format/sing-box.md
import { isIP } from "node:net";
import type { NormalizedProfile } from "../../model/types.js";
import type { EngineChecks } from "../../targets/check.js";
import { unsafeTunResolvers } from "../../model/tun.js";
export function engineChecks(model: NormalizedProfile): EngineChecks {
  const t = model.target;
  const modern = model.target.version === "1.14.4";
  return {
    node(node, error) {
      if (!isIP(node.server) && !modern)
        error("PROXY_HOSTNAME_MODE_UNSUPPORTED", `proxies.${node.id}.server`);
    },
    group(group, error) {
      if (
        group.members.some((x) => ["DIRECT", "REJECT"].includes(x)) &&
        (!modern || group.type !== "select")
      )
        error("GROUP_BUILTIN_UNSUPPORTED", `groups.${group.id}`);
    },
    profile(error) {
      if (model.dns?.length && t.mode !== "standalone") error("DNS_MODE_UNSUPPORTED", "dns");
      if (
        !modern &&
        (model.domainMatching !== undefined ||
          model.serverAliases !== undefined ||
          model.cacheFile !== undefined ||
          model.unsupportedUdp !== undefined)
      )
        error("PROGRAM_OPTION_UNSUPPORTED", "singBox");
      if (model.cacheFile !== undefined && t.mode !== "standalone")
        error("PROGRAM_OPTION_UNSUPPORTED", "singBox.cacheFile");
      if (model.tun) {
        if (!modern || t.mode !== "standalone") error("TUN_TARGET_UNSUPPORTED", "singBox.tun");
        if (unsafeTunResolvers(model).length) error("TUN_DNS_LOOP", "singBox.tun");
      }
    },
    match(m, path, nested, error) {
      if (
        "includeSniffed" in m &&
        m.includeSniffed &&
        !(modern && model.domainMatching === "prefer-sniffed")
      )
        error("MATCH_OPTION_UNSUPPORTED", path);
      if (m.type === "ipCidr" && t.engine === "sing-box") {
        if (!modern && m.noResolve !== undefined) error("MATCH_OPTION_UNSUPPORTED", path);
        if (modern && nested && m.noResolve !== true) error("RESOLVE_NESTED", path);
      }
      if (m.type === "nativeRuleSet") {
        if (m.engine === "sing-box" && m.resolve !== undefined && !modern)
          error("MATCH_OPTION_UNSUPPORTED", path);
        if (m.engine === "sing-box" && m.resolve && nested) error("RESOLVE_NESTED", path);
      }
    },
  };
}
