// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/clash-backends.md
import type { TargetPlan } from "./compiler.js";
import type {
  Action,
  ConcreteGroup,
  Diagnostic,
  ExpandedRule,
  Match,
  Secret,
  Target,
} from "./types.js";

/** Shared syntax is not a shared capability declaration: validate each exact target first. */
export function validateClashTarget(
  target: Target,
  rules: readonly ExpandedRule[],
  diagnostics: Diagnostic[],
): void {
  if (target.engine !== "stash") return;
  if (target.mode === "standalone")
    diagnostics.push({
      severity: "error",
      code: "MODE_UNSUPPORTED",
      path: `targets.${target.id}.mode`,
      target: target.id,
      message: "Stash 仅支持 fragment；系统接管不能等价为本机显式代理",
    });
  const visit = (condition: Match, path: string): void => {
    if (
      condition.type === "sourceIp" ||
      condition.type === "sourcePort" ||
      (condition.type === "port" && condition.from !== condition.to)
    )
      diagnostics.push({
        severity: "error",
        code: "MATCH_UNSUPPORTED",
        path,
        target: target.id,
        message: "Stash 4.2.1 不支持来源匹配或端口范围；不会省略条件",
      });
    if (condition.type === "all" || condition.type === "any")
      condition.conditions.forEach((child, i) => visit(child, `${path}.conditions.${i}`));
    if (condition.type === "not") visit(condition.condition, `${path}.condition`);
  };
  for (const rule of rules) visit(rule.when, `${rule.id}.when`);
}

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
      return `${condition.value.includes(":") ? "IP-CIDR6" : "IP-CIDR"},${condition.value},no-resolve`;
    case "sourceIp":
      return `SRC-IP-CIDR,${condition.value}`;
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
  plan: TargetPlan,
  secret: (token: Secret) => string,
): Record<string, unknown> {
  const { program, target } = plan;
  const config: Record<string, unknown> = {
    proxies: program.nodes.map((node) => ({
      name: node.id,
      type: node.type,
      server: node.server,
      port: node.port,
      password: secret(node.password),
      ...(node.username ? { username: secret(node.username) } : {}),
      ...(node.serverName ? { sni: node.serverName } : {}),
      ...(node.type === "trojan" ? { udp: true } : {}),
      ...(target.engine === "stash" ? { "block-quic": "off" } : {}),
      ...(node.via ? { "dialer-proxy": node.via } : {}),
    })),
    "proxy-groups": program.groups.map((g) => clashGroup(g)),
    rules: [
      ...plan.rules.map((rule) =>
        rule.when.type === "ipCidr"
          ? `${conditionText(rule.when).replace(/,no-resolve$/, "")},${policy(rule.then)},no-resolve`
          : `${conditionText(rule.when)},${policy(rule.then)}`,
      ),
      `MATCH,${policy(program.fallback)}`,
    ],
  };
  if (target.mode === "standalone") {
    const listener = program.listener!;
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
