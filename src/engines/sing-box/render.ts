// @concord-file
// @concord-implements docs/feature/targets/format/sing-box.md
import { dnsCondition, dohUrl } from "../../model/dns.js";
import { needsResolve, singboxMemberTag } from "../../model/semantics.js";
import { singboxGroup } from "./groups.js";
import { aliasProxyServer } from "../../model/proxy-values.js";
import { singboxProxy } from "./proxies.js";
import type { Json } from "../../model/errors.js";
import type { EnginePlan, Match, Action, Secret } from "../../model/types.js";
import { isIP } from "node:net";
const DIRECT = "pl-direct",
  DNS = "pl-dns";
const actionTag = (a: Action, name: (id: string) => string) =>
  a.type === "route" ? name(a.to) : a.type === "direct" ? DIRECT : "pl-reject";
function singCondition(condition: Match): Record<string, Json> {
  switch (condition.type) {
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
    case "processName":
      return { process_name: [condition.value] };
    case "sourceIp":
      return {
        source_ip_cidr: [
          condition.value.includes("/")
            ? condition.value
            : `${condition.value}/${isIP(condition.value) === 6 ? 128 : 32}`,
        ],
      };
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
function singAction(action: Action, name: (id: string) => string): Record<string, Json> {
  return action.type === "reject"
    ? { action: "reject", method: "default", no_drop: true }
    : { action: "route", outbound: actionTag(action, name) };
}
export function singbox(plan: EnginePlan, secret: (token: Secret) => string): Json {
  const model = plan.model,
    target = model.target;
  const name = (id: string) => plan.names?.get(id) ?? id;
  const standalone = target.mode === "standalone";
  const routedDns = standalone && !!model.dns?.length;
  const domainResolver = routedDns ? "pl-routed-dns" : DNS;
  const outbounds: Json[] = [{ type: "direct", tag: DIRECT }];
  if (model.groups.some((group) => group.members.includes("REJECT")))
    outbounds.push({ type: "block", tag: "pl-reject" });
  for (const node of model.nodes)
    outbounds.push({
      ...(singboxProxy(aliasProxyServer(node, model.serverAliases), secret) as Record<
        string,
        Json
      >),
      tag: name(node.id),
      ...(node.via ? { detour: name(node.via) } : {}),
      ...(routedDns
        ? { domain_resolver: { server: domainResolver, strategy: "prefer_ipv4" } }
        : {}),
    });
  for (const group of model.groups) {
    outbounds.push(singboxGroup(group, (id) => singboxMemberTag(name(id))));
  }
  const rules: Json[] = model.rules.flatMap((rule) => [
    ...(needsResolve(rule.when)
      ? [{ ip_cidr: ["0.0.0.0/0", "::/0"], invert: true, action: "resolve" }]
      : []),
    { ...singCondition(rule.when), ...singAction(rule.then, name) },
  ]);
  const routing: Record<string, Json> = { rules };
  if (model.domainMatching === "prefer-sniffed")
    rules.unshift({ action: "sniff", sniffer: ["http", "tls"] });
  if (model.tun) {
    rules.unshift({ inbound: ["pl-tun"], port: 53, action: "hijack-dns" });
    if (model.tun.autoRoute) routing.auto_detect_interface = true;
  }
  if (routedDns) rules.unshift({ inbound: ["pl-dns-listener"], action: "hijack-dns" });
  if (plan.nativeRuleSets.length)
    routing.rule_set = plan.nativeRuleSets.map((r) => ({
      type: "remote",
      tag: r.id,
      url: r.url,
      format: r.format,
      update_interval: `${r.intervalSeconds}s`,
      http_client: {
        version: 2,
        // Rule sets are fetched before the loopback DNS inbound can serve requests.
        ...(standalone ? { domain_resolver: { server: DNS, strategy: "prefer_ipv4" } } : {}),
      },
    }));
  if (model.fallback.type === "reject") rules.push(singAction(model.fallback, name));
  else routing.final = actionTag(model.fallback, name);
  const config: Record<string, Json> = { log: { level: "warn" }, outbounds, route: routing };
  if (model.cacheFile) config.experimental = { cache_file: { enabled: true } };
  if (standalone) {
    const listener = model.listener!;
    config.inbounds = [
      { type: "mixed", tag: "pl-listener", listen: "127.0.0.1", listen_port: listener.port },
      ...(routedDns
        ? [
            {
              type: "direct",
              tag: "pl-dns-listener",
              listen: "127.0.0.1",
              listen_port: listener.port,
              network: "udp",
            },
          ]
        : []),
      ...(model.tun
        ? [
            {
              type: "tun",
              tag: "pl-tun",
              address: [...model.tun.address],
              stack: model.tun.stack,
              auto_route: model.tun.autoRoute,
              strict_route: model.tun.strictRoute,
              dns_mode: model.tun.dnsMode,
              ...(model.tun.routeExcludeAddress
                ? { route_exclude_address: [...model.tun.routeExcludeAddress] }
                : {}),
            },
          ]
        : []),
    ];
    config.dns = {
      servers: [{ type: "udp", tag: DNS, server: listener.resolver, server_port: 53 }],
      final: DNS,
      strategy: "prefer_ipv4",
      ...(model.domainMatching ? { reverse_mapping: true } : {}),
    };
    routing.default_domain_resolver = { server: domainResolver, strategy: "prefer_ipv4" };
  }
  if (model.dns?.length) {
    const dns = config.dns as { servers: Json[]; rules?: Json[] };
    if (routedDns)
      dns.servers.push({
        type: "udp",
        tag: "pl-routed-dns",
        server: "127.0.0.1",
        server_port: model.listener!.port,
      });
    dns.rules = model.dns.map((rule, index) => {
      const tag = `pl-domain-dns-${index}`;
      if (isIP(rule.server)) {
        dns.servers.push({ type: "udp", tag, server: rule.server, server_port: 53 });
      } else {
        const url = dohUrl(rule.server);
        dns.servers.push({
          type: "https",
          tag,
          server: url.hostname.replace(/^\[|\]$/g, ""),
          server_port: Number(url.port || 443),
          path: url.pathname,
          tls: { enabled: true },
          domain_resolver: { server: DNS, strategy: "prefer_ipv4" },
        });
      }
      return { ...dnsCondition(rule), server: tag };
    });
  }
  if (model.endpoints?.length) {
    config.endpoints = model.endpoints.map((endpoint) => ({
      type: "tailscale",
      tag: name(endpoint.id),
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
    for (const endpoint of model.endpoints)
      dns.servers.push({
        type: "udp",
        tag: `pl-ts-dns-${endpoint.id}`,
        server: endpoint.bootstrapResolver,
        server_port: 53,
      });
  }
  return config;
}
