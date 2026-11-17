// @concord-file
// @concord-implements docs/feature/targets/format/stash.md
import type { EnginePlan, ConcreteGroup, Action, Match, Secret } from "../../model/types.js";
import { clashProxy } from "./proxies.js";
export function clashGroup(
  group: ConcreteGroup,
  name: (id: string) => string = (id) => id,
): Record<string, unknown> {
  if (group.type !== "select" && group.type !== "urltest") throw new Error("GROUP_UNSUPPORTED");
  return {
    name: name(group.id),
    type: group.type === "select" ? "select" : "url-test",
    proxies: group.members.map(name),
    ...(group.type === "urltest"
      ? {
          url: group.url,
          interval: group.intervalSeconds ?? 180,
          tolerance: group.toleranceMs ?? 50,
        }
      : {}),
  };
}

function conditionText(condition: Match): string {
  switch (condition.type) {
    case "nativeRuleSet":
      return `RULE-SET,${condition.id}`;
    case "all":
    case "any":
      return `${condition.type === "all" ? "AND" : "OR"},(${condition.conditions.map((c) => `(${conditionText(c)})`).join(",")})`;
    case "not":
      return `NOT,((${conditionText(condition.condition)}))`;
    case "domain":
      return `DOMAIN,${condition.value}`;
    case "domainSuffix":
      return `DOMAIN-SUFFIX,${condition.value}`;
    case "ipCidr":
      return `${condition.value.includes(":") ? "IP-CIDR6" : "IP-CIDR"},${condition.value}${condition.noResolve !== false ? ",no-resolve" : ""}`;
    case "processName":
      return `PROCESS-NAME,${condition.value}`;
    case "sourceIp":
      return `SRC-IP-CIDR,${condition.value.includes("/") ? condition.value : `${condition.value}/${condition.value.includes(":") ? 128 : 32}`}`;
    case "network":
      return `NETWORK,${condition.value}`;
    case "port":
    case "sourcePort":
      return `${condition.type === "port" ? "DST-PORT" : "SRC-PORT"},${condition.from === condition.to ? condition.from : `${condition.from}-${condition.to}`}`;
  }
}
const policy = (action: Action): string =>
  action.type === "route" ? action.to : action.type === "direct" ? "DIRECT" : "REJECT";

export function clashConfig(
  plan: EnginePlan,
  secret: (token: Secret) => string,
): Record<string, unknown> {
  const model = plan.model,
    target = model.target;
  const config: Record<string, unknown> = {
    proxies: model.nodes.map((node) => clashProxy(node, secret)),
    "proxy-groups": model.groups.map((g) => clashGroup(g)),
    rules: [
      ...model.rules.map((rule) =>
        rule.when.type === "ipCidr"
          ? `${conditionText(rule.when).replace(/,no-resolve$/, "")},${policy(rule.then)}${rule.when.noResolve !== false ? ",no-resolve" : ""}`
          : `${conditionText(rule.when)},${policy(rule.then)}`,
      ),
      `MATCH,${policy(model.fallback)}`,
    ],
  };
  if (plan.nativeRuleSets.length)
    config["rule-providers"] = Object.fromEntries(
      plan.nativeRuleSets.map((r) => [
        r.id,
        {
          type: "http",
          url: r.url,
          path: `rule-providers/pl-${r.id}.${r.format === "yaml" ? "yaml" : "txt"}`,
          interval: r.intervalSeconds,
          behavior: "behavior" in r ? r.behavior : "classical",
          format: r.format,
          proxy: "DIRECT",
        },
      ]),
    );
  if (target.mode === "standalone") {
    const listener = model.listener!;
    Object.assign(config, {
      "mixed-port": listener.port,
      "allow-lan": false,
      "bind-address": "127.0.0.1",
      mode: "rule",
      ipv6: false,
      "geo-auto-update": false,
      sniffer: { enable: false },
      dns: {
        enable: true,
        ipv6: false,
        "enhanced-mode": "redir-host",
        nameserver: [listener.resolver],
        "default-nameserver": [listener.resolver],
        "respect-rules": false,
        "use-hosts": false,
        "use-system-hosts": false,
      },
    });
  }
  return config;
}
