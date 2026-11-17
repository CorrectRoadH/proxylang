// @concord-file
// @concord-implements docs/feature/routing-cases/README.md#求值规则
import ipaddr from "ipaddr.js";
import type { RoutingModel, RoutingCondition } from "../model/routing-model.js";
import type { RouteRequest, Explanation, Need } from "../model/routing-types.js";
export type Truth =
  | { readonly matched: boolean }
  | { readonly matched: null; readonly needs: Need };
const yes: Truth = { matched: true },
  no: Truth = { matched: false };
const unknown = (needs: Need): Truth => ({ matched: null, needs });
export function combine(type: "all" | "any", children: readonly Truth[]): Truth {
  if (type === "all" && children.some((c) => c.matched === false)) return no;
  if (type === "any" && children.some((c) => c.matched === true)) return yes;
  return children.find((c) => c.matched === null) ?? (type === "all" ? yes : no);
}
function ipMatches(value: string, cidr: string): boolean {
  const address = ipaddr.parse(value);
  if (!cidr.includes("/")) {
    const other = ipaddr.parse(cidr);
    return (
      address.kind() === other.kind() && address.toNormalizedString() === other.toNormalizedString()
    );
  }
  const [network, bits] = ipaddr.parseCIDR(cidr);
  return address.kind() === network.kind() && address.match(network, bits);
}
export function evaluate(
  model: RoutingModel,
  request: RouteRequest,
  assumptions: ReadonlyMap<string, boolean>,
): Explanation {
  let resolved = false;
  const trace: Explanation["trace"][number][] = [];
  const currentIp = () => request.ip ?? (resolved ? request.resolvedIp : undefined);
  const atom = (condition: RoutingCondition, nested: boolean): Truth => {
    if (condition.type === "all" || condition.type === "any")
      return combine(
        condition.type,
        condition.conditions.map((c) => atom(c, true)),
      );
    if (condition.type === "not") {
      const result = atom(condition.condition, true);
      return result.matched === null ? result : { matched: !result.matched };
    }
    if (condition.resolves && !currentIp() && nested && !resolved) return unknown({ kind: "dns" });
    switch (condition.type) {
      case "ruleSet":
        return assumptions.has(condition.canonical)
          ? { matched: assumptions.get(condition.canonical)! }
          : unknown({ kind: "ruleSet", id: condition.id });
      case "domain":
      case "domainSuffix": {
        const effective =
          model.target.engine === "sing-box" && model.domainMatching === "prefer-sniffed";
        const candidates = effective
          ? [request.sniffedDomain ?? request.domain]
          : model.target.engine === "surge" && condition.includeSniffed
            ? [request.domain, request.sniffedDomain]
            : [request.domain];
        return {
          matched: candidates.some(
            (v) =>
              v !== undefined &&
              (v === condition.value ||
                (condition.type === "domainSuffix" && v.endsWith("." + condition.value))),
          ),
        };
      }
      case "ipCidr":
      case "ipCidr6":
      case "ipAsn": {
        const ip = currentIp();
        if (!ip) return resolved ? unknown({ kind: "dns" }) : no;
        if (condition.type === "ipAsn")
          return request.asn === undefined
            ? unknown({ kind: "asn" })
            : { matched: request.asn === condition.value };
        return { matched: ipMatches(ip, condition.value) };
      }
      case "sourceIp":
        return {
          matched: request.sourceIp !== undefined && ipMatches(request.sourceIp, condition.value),
        };
      case "network":
        return { matched: (request.network ?? "tcp") === condition.value };
      case "processName":
        return { matched: request.processName === condition.value };
      case "macAddress":
        return { matched: request.macAddress?.toLowerCase() === condition.value.toLowerCase() };
      case "port":
      case "sourcePort": {
        const port = condition.type === "port" ? request.port : request.sourcePort;
        return {
          matched:
            port !== undefined &&
            port >= condition.from &&
            port <= (condition.to ?? condition.from),
        };
      }
    }
  };
  for (const rule of model.rules) {
    if (!request.ip && "resolves" in rule.when && rule.when.resolves) resolved = true;
    const result = atom(rule.when, false);
    trace.push({
      index: rule.index,
      matched: result.matched,
      ...(rule.origin ? { origin: rule.origin } : {}),
    });
    if (result.matched === null) return { outcome: "indeterminate", needs: result.needs, trace };
    if (result.matched)
      return {
        outcome: "matched",
        exit: rule.exit,
        route: { index: rule.index, ...(rule.origin ? { origin: rule.origin } : {}) },
        trace,
      };
  }
  return { outcome: "fallback", exit: model.fallback, trace };
}
