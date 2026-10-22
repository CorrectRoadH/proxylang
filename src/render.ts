// @concord-file
// @concord-implements docs/feature/target-compilation/README.md
import { stringify } from "yaml";
import { clashConfig } from "./clash.js";
import { surgeGroup, singboxGroup } from "./strategies.js";
import { isIP } from "node:net";
import type { Compilation, TargetPlan } from "./compiler.js";
import type { Action, Match, Secret } from "./types.js";

import { RenderError, singboxProxy, surgeProxy, type Json } from "./proxies.js";
export { RenderError } from "./proxies.js";
export type Artifact = {
  readonly target: string;
  readonly filename: string;
  readonly content: string;
};
const DIRECT = "pl-direct";
const DNS = "pl-dns";
const actionTag = (action: Action) =>
  action.type === "route" ? action.to : action.type === "direct" ? DIRECT : "pl-reject";

/** Secret resolution is once per token per batch, including across providers. */
export function render(
  compilation: Compilation,
  resolveSecret: (token: Secret) => string | undefined,
): readonly Artifact[] {
  if (!compilation.ok) throw new RenderError("COMPILATION_FAILED");
  const values = new Map<string, string>();
  const secret = (token: Secret): string => {
    if (values.has(token.name)) return values.get(token.name)!;
    let value: string | undefined;
    try {
      value = resolveSecret(token);
    } catch {
      throw new RenderError("SECRET_RESOLUTION_FAILED");
    }
    if (typeof value !== "string" || value.length === 0) throw new RenderError("SECRET_MISSING");
    values.set(token.name, value);
    return value;
  };
  return compilation.plans.map((plan) => ({
    target: plan.target.id,
    filename: `${plan.target.id}.${plan.target.engine === "surge" ? "conf" : plan.target.engine === "sing-box" ? "json" : "yaml"}`,
    content:
      plan.target.engine === "surge"
        ? surge(plan, secret)
        : plan.target.engine === "sing-box"
          ? JSON.stringify(singbox(plan, secret), null, 2) + "\n"
          : stringify(clashConfig(plan, secret)),
  }));
}

function singCondition(condition: Match): Record<string, Json> {
  switch (condition.type) {
    case "ruleSet":
      return singCondition(condition.when);
    case "nativeRuleSet":
      return { rule_set: [condition.id] };
    case "all":
    case "any":
      return {
        type: "logical",
        mode: condition.type === "all" ? "and" : "or",
        rules: condition.conditions.map(singCondition),
      };
    case "not":
      return {
        type: "logical",
        mode: "and",
        rules: [singCondition(condition.condition)],
        invert: true,
      };
    case "domain":
      return { domain: [condition.value] };
    case "domainSuffix":
      return { domain_suffix: [condition.value] };
    case "ipCidr":
      return { ip_cidr: [condition.value] };
    case "sourceIp":
      return { source_ip_cidr: [condition.value] };
    case "network":
      return { network: [condition.value] };
    case "port":
    case "sourcePort": {
      const key = condition.type === "port" ? "port" : "source_port";
      return condition.from === condition.to
        ? { [key]: [condition.from] }
        : { [`${key}_range`]: [`${condition.from}:${condition.to}`] };
    }
  }
}
function singAction(action: Action): Record<string, Json> {
  return action.type === "reject"
    ? { action: "reject", method: "default", no_drop: true }
    : { action: "route", outbound: actionTag(action) };
}
function singbox(plan: TargetPlan, secret: (token: Secret) => string): Json {
  const { program, target } = plan;
  const modern = target.version === "1.12.0";
  const standalone = target.mode === "standalone";
  const outbounds: Json[] = [
    {
      type: "direct",
      tag: DIRECT,
      ...(!modern && standalone ? { domain_strategy: "prefer_ipv4" } : {}),
    },
  ];
  for (const node of program.nodes) outbounds.push(singboxProxy(node, secret));
  for (const group of program.groups) {
    outbounds.push(singboxGroup(group));
  }
  const rules: Json[] = plan.rules.map((rule) => ({
    ...singCondition(rule.when),
    ...singAction(rule.then),
  }));
  const routing: Record<string, Json> = { rules };
  if (plan.nativeRuleSets.length)
    routing.rule_set = plan.nativeRuleSets.map((r) => ({
      type: "remote",
      tag: r.id,
      url: r.url,
      format: r.format,
      update_interval: `${r.intervalSeconds}s`,
      download_detour: DIRECT,
    }));
  if (program.fallback.type === "reject") rules.push(singAction(program.fallback));
  else routing.final = actionTag(program.fallback);
  const config: Record<string, Json> = { log: { level: "warn" }, outbounds, route: routing };
  if (standalone) {
    const listener = program.listener!;
    config.inbounds = [
      { type: "mixed", tag: "pl-listener", listen: "127.0.0.1", listen_port: listener.port },
    ];
    config.dns = {
      servers: [
        modern
          ? { type: "udp", tag: DNS, server: listener.resolver, server_port: 53, detour: DIRECT }
          : {
              tag: DNS,
              address: `udp://${isIP(listener.resolver) === 6 ? `[${listener.resolver}]` : listener.resolver}`,
              detour: DIRECT,
            },
      ],
      final: DNS,
      strategy: "prefer_ipv4",
    };
    if (modern) routing.default_domain_resolver = { server: DNS, strategy: "prefer_ipv4" };
  }
  if (program.endpoints?.length) {
    config.endpoints = program.endpoints.map((endpoint) => ({
      type: "tailscale",
      tag: endpoint.id,
      hostname: endpoint.hostname,
      state_directory: endpoint.stateDirectory,
      accept_routes: endpoint.acceptRoutes,
      domain_resolver: { server: `pl-ts-dns-${endpoint.id}` },
      ...(endpoint.authKey ? { auth_key: secret(endpoint.authKey) } : {}),
      ...(endpoint.exitNode ? { exit_node: endpoint.exitNode } : {}),
      ...(endpoint.exitNodeAllowLanAccess !== undefined
        ? { exit_node_allow_lan_access: endpoint.exitNodeAllowLanAccess }
        : {}),
    }));
    const dns = config.dns as { servers: Json[] };
    for (const endpoint of program.endpoints)
      dns.servers.push({
        type: "udp",
        tag: `pl-ts-dns-${endpoint.id}`,
        server: endpoint.bootstrapResolver,
        server_port: 53,
        detour: DIRECT,
      });
  }
  return config;
}

function surgeCondition(condition: Match): string {
  switch (condition.type) {
    case "ruleSet":
      return surgeCondition(condition.when);
    case "nativeRuleSet":
      return `${condition.format === "domain-set" ? "DOMAIN-SET" : "RULE-SET"},${condition.url}`;
    case "all":
    case "any":
      return `${condition.type === "all" ? "AND" : "OR"},(${condition.conditions.map((c) => `(${surgeCondition(c)})`).join(",")})`;
    case "not":
      return `NOT,((${surgeCondition(condition.condition)}))`;
    case "domain":
      return `DOMAIN,${condition.value}`;
    case "domainSuffix":
      return `DOMAIN-SUFFIX,${condition.value}`;
    case "ipCidr":
      return `${condition.value.includes(":") ? "IP-CIDR6" : "IP-CIDR"},${condition.value},no-resolve`;
    case "sourceIp":
      return `SRC-IP,${condition.value}`;
    case "network":
      return `PROTOCOL,${condition.value.toUpperCase()}`;
    case "port":
    case "sourcePort":
      return `${condition.type === "port" ? "DEST-PORT" : "SRC-PORT"},${condition.from === condition.to ? condition.from : `${condition.from}-${condition.to}`}`;
  }
}
function surge(plan: TargetPlan, secret: (token: Secret) => string): string {
  const policy = (action: Action) =>
    action.type === "route" ? action.to : action.type === "direct" ? "DIRECT" : "REJECT";
  const lines = ["# Generated by proxylang; see manifest for source mapping and preconditions."];
  if (plan.target.mode === "standalone")
    lines.push(
      "[General]",
      "loglevel = warning",
      "allow-wifi-access = false",
      `http-listen = 127.0.0.1:${plan.program.listener!.port}`,
      `dns-server = ${plan.program.listener!.resolver}`,
      "",
    );
  lines.push("[Proxy]");
  for (const node of plan.program.nodes) lines.push(surgeProxy(node, secret));
  lines.push("", "[Proxy Group]");
  for (const group of plan.program.groups) {
    lines.push(surgeGroup(group));
  }
  lines.push("", "[Rule]");
  for (const rule of plan.rules) {
    lines.push(`# ${rule.id}`);
    if (rule.when.type === "ipCidr") {
      const condition = surgeCondition(rule.when).replace(/,no-resolve$/, "");
      lines.push(`${condition},${policy(rule.then)},no-resolve`);
    } else
      lines.push(
        `${surgeCondition(rule.when)},${policy(rule.then)}${rule.when.type === "nativeRuleSet" && rule.when.intervalSeconds !== undefined ? `,update-interval=${rule.when.intervalSeconds}` : ""}`,
      );
  }
  lines.push(`FINAL,${policy(plan.program.fallback)}`);
  return lines.join("\n") + "\n";
}
