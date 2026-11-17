// @concord-file
// @concord-implements docs/feature/targets/format/stash.md
import { isIP } from "node:net";
import type { NormalizedProfile } from "../../model/types.js";
import type { EngineChecks } from "../../targets/check.js";
export function engineChecks(model: NormalizedProfile): EngineChecks {
  const t = model.target;
  return {
    node(node, error) {
      if (!isIP(node.server)) error("PROXY_HOSTNAME_MODE_UNSUPPORTED", `proxies.${node.id}.server`);
    },
    group(group, error) {
      if (group.members.some((x) => ["DIRECT", "REJECT"].includes(x)))
        error("GROUP_BUILTIN_UNSUPPORTED", `groups.${group.id}`);
    },
    profile(error) {
      if (t.mode !== "fragment") error("MODE_UNSUPPORTED", "mode");
      if (model.dns?.length) error("DNS_MODE_UNSUPPORTED", "dns");
      if (
        model.domainMatching !== undefined ||
        model.serverAliases !== undefined ||
        model.cacheFile !== undefined ||
        model.unsupportedUdp !== undefined
      )
        error("PROGRAM_OPTION_UNSUPPORTED", "singBox");
      if (model.cacheFile !== undefined && t.mode !== "standalone")
        error("PROGRAM_OPTION_UNSUPPORTED", "singBox.cacheFile");
      if (model.tun) error("TUN_TARGET_UNSUPPORTED", "singBox.tun");
    },
    match(m, path, _nested, error) {
      if (
        m.type === "sourceIp" ||
        m.type === "sourcePort" ||
        (m.type === "port" && m.from !== m.to)
      )
        error("MATCH_UNSUPPORTED", path);
      if ("includeSniffed" in m && m.includeSniffed) error("MATCH_OPTION_UNSUPPORTED", path);
    },
  };
}
