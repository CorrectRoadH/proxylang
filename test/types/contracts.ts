import {
  defineSecrets,
  defineBuild,
  defineProfile,
  defineProxyGroup,
  defineRoutes,
  checkBuild,
  runBuild,
  proxy,
  match,
  group,
  surge,
  singbox,
  ruleSet,
  outbound,
  type Target,
  type Exit,
  type Condition,
  type SecretRef,
  type Secrets,
  type Profile,
  type ProxyNode,
  type Route,
} from "proxylang";
// @feature docs/feature/profile/library/README.md
const secrets = defineSecrets({
  TEST_PASSWORD: { value: "test", validation: "test-valid" },
  TEST_UUID: { env: "TEST_UUID", validation: "11111111-2222-4333-8444-555555555555" },
});
const edge = proxy.trojan({
  id: "edge",
  name: "Edge",
  server: "192.0.2.10",
  port: 443,
  password: secrets.TEST_PASSWORD,
});
const relay = defineProxyGroup({
  id: "relay",
  algorithm: group.select(),
  members: [[edge], outbound.direct],
});
const chained = proxy.http({
  id: "chained",
  server: "192.0.2.20",
  port: 8080,
  password: secrets.TEST_PASSWORD,
  via: relay,
});
const conditions: Condition[] = match.domainSuffix(["one.example", "two.example"], {
  includeSniffed: true,
});
const routes: Route[] = defineRoutes({
  when: [conditions, match.not(match.network("udp"))],
  to: edge,
});
const profile: Profile = defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  proxies: [edge, chained],
  groups: [relay],
  routes,
  fallback: outbound.direct,
});
const build = defineBuild({ profiles: { laptop: profile }, secrets });
checkBuild(build);
void runBuild(build, { validation: true });
const ref: SecretRef = secrets.TEST_PASSWORD;
const collection: Secrets = secrets;
const exit: Exit = relay;
const node: ProxyNode = edge;
void [ref, collection, exit, node];
const source = ruleSet({
  id: "external",
  surge: { url: "https://rules.example.com/list.txt" },
  singBox: { url: "https://rules.example.com/list.srs", format: "binary", intervalSeconds: 86400 },
});
defineRoutes({ when: source, to: outbound.direct });
proxy.builder(edge).via(relay).name("Named").tcpFastOpen(true).build();
// @ts-expect-error unknown secret names fail before runtime
void secrets.TEST_MISSING;
// @ts-expect-error raw values cannot stand in for secret handles
proxy.trojan({ id: "edge", server: "192.0.2.10", port: 443, password: "test" });
// @ts-expect-error secret handle shape cannot be forged
const forged: SecretRef = { type: "env", name: "TEST_PASSWORD" };
void forged;
// @ts-expect-error destinations are objects only
defineRoutes({ when: match.domain("example.com"), to: "edge" });
// @ts-expect-error group members are objects only
defineProxyGroup({ id: "invalid", algorithm: group.select(), members: ["edge"] });
// @ts-expect-error via is a node or group, not an id
proxy.trojan({ ...edge, via: "relay" });
// @ts-expect-error builtins are not valid via resources
proxy.builder(edge).via(outbound.direct);
const tunnel = surge.tailscale({
  id: "mesh",
  sectionName: "Example",
  authKey: secrets.TEST_PASSWORD,
  hostname: "example-device",
});
// @ts-expect-error tunnels are not valid via resources
proxy.builder(edge).via(tunnel);
// @ts-expect-error label is replaced by name
proxy.builder(edge).label("Old");
// @ts-expect-error application metadata is not protocol data
proxy.trojan({ ...edge, region: "TEST" });
proxy.http({
  id: "http",
  server: "192.0.2.10",
  port: 443,
  password: secrets.TEST_PASSWORD,
  // @ts-expect-error HTTP does not accept UUID
  uuid: secrets.TEST_UUID,
});
// @ts-expect-error exact versions only
const badTarget: Target = { engine: "surge", platform: "macos", version: "0.0.0" };
void badTarget;
// @ts-expect-error Stash only supports macOS
const badPlatform: Target = { engine: "stash", platform: "linux", version: "4.2.1" };
void badPlatform;
// @ts-expect-error nested target selects the engine-specific extension
defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
  singBox: { mode: "fragment" },
});
// @ts-expect-error Stash has no engine-specific extension
defineProfile({
  target: { engine: "stash", platform: "macos", version: "4.2.1" },
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
  mihomo: { mode: "fragment" },
});
const smart = defineProxyGroup({ id: "smart", algorithm: surge.smart(), members: edge });
// @ts-expect-error Surge-only algorithms cannot be used in sing-box Profiles
defineProfile({
  target: { engine: "sing-box", platform: "linux", version: "1.14.4" },
  proxies: [edge],
  groups: [smart],
  routes: [],
  fallback: edge,
});
// @ts-expect-error includeSniffed is not an IP condition option
match.ipCidr("192.0.2.0/24", { includeSniffed: false });
// @ts-expect-error noResolve is not a domain condition option
match.domain("example.com", { noResolve: false });
// @ts-expect-error source IP has no matching options
match.sourceIp("192.0.2.1", { noResolve: false });
// @ts-expect-error source and validation values have strict types
defineSecrets({ TEST_PASSWORD: { value: "test", env: "TEST_PASSWORD" } });
// @ts-expect-error rule sets need a stable id
ruleSet({ surge: { url: "https://rules.example.com/list.txt" } });
// @ts-expect-error cross-engine rule sets do not accept destinations
ruleSet({ id: "test", surge: { url: "https://rules.example.com/list.txt" }, to: edge });
// @ts-expect-error build accepts a declared collection, not a resolver callback
defineBuild({ profiles: { one: profile }, secrets: () => "" });
import {
  // @ts-expect-error removed public API
  compile,
  // @ts-expect-error removed public API
  render,
  // @ts-expect-error removed public API
  secret,
  // @ts-expect-error removed public API
  secrets as oldSecrets,
  // @ts-expect-error removed public API
  mihomo,
  // @ts-expect-error removed public API
  defineRoute,
  // @ts-expect-error removed public API
  defineConfig,
} from "proxylang";
void [compile, render, secret, oldSecrets, mihomo, defineRoute, defineConfig, singbox];

defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
  // @ts-expect-error case expectations are object references
  cases: [{ name: "invalid", request: {}, expect: "edge" }],
});

defineProxyGroup({
  id: "tested",
  algorithm: group.select(),
  members: [edge],
  surge: { url: "https://test.example.com/probe", intervalSeconds: 300, timeoutSeconds: 10 },
});
defineProxyGroup({
  id: "invalid",
  algorithm: group.select(),
  members: [edge],
  // @ts-expect-error select availability test fields live inside the surge branch
  url: "https://test.example.com/probe",
});

// @feature docs/feature/profile/library/README.md#资源与-profile
const flattened = defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  proxies: [[edge]],
  groups: [[relay]],
  routes: [[routes]],
  dns: [],
  cases: [[{ name: "example", request: { domain: "example.com" }, expect: edge }]],
  fallback: edge,
});
flattened.proxies.forEach((resource) => {
  const id: string = resource.id;
  void id;
});
flattened.groups.forEach((resource) => {
  const members: readonly Exit[] = resource.members;
  void members;
});
flattened.routes.forEach((route) => {
  const to: Exit = route.to;
  const when: Condition = route.when;
  void [to, when];
});
flattened.dns.forEach((rule) => {
  const pattern: string = rule.pattern;
  void pattern;
});
flattened.cases.forEach((routeCase) => {
  const expect: Exit = routeCase.expect;
  void expect;
});
// @ts-expect-error returned resource lists are readonly
flattened.proxies.push(edge);
// @ts-expect-error returned group lists are readonly
flattened.groups.push(relay);
// @ts-expect-error returned routes are readonly
flattened.routes.push(routes[0]!);
// @ts-expect-error returned DNS rules are readonly
flattened.dns.push({ pattern: "example.com", server: "192.0.2.53" });
// @ts-expect-error returned case lists are readonly
flattened.cases.push({ name: "invalid", request: {}, expect: edge });
// @ts-expect-error concrete Profile target still narrows extension fields after a spread
defineProfile({ ...flattened, singBox: { mode: "fragment" } });

// @feature docs/feature/routing-cases/library.md#explainprofile
import {
  explainProfile,
  type RouteRequest,
  type Assumptions,
  type Explanation,
  type CaseResult,
} from "proxylang";
const request: RouteRequest = { domain: "example.com", resolvedIp: "192.0.2.7", network: "tcp" };
const assumptions: Assumptions = { hit: [] };
const explained = explainProfile(flattened, request, assumptions);
if (explained.ok) {
  const value: Explanation = explained.explanation;
  const exit: string | undefined = value.exit;
  void exit;
} else
  explained.diagnostics.forEach((d) => {
    const code: string = d.code;
    void code;
  });
// @ts-expect-error requests use the supported transport union
explainProfile(flattened, { network: "icmp" });
// @ts-expect-error assumptions reference SDK objects, not IDs
explainProfile(flattened, {}, { hit: ["external"] });
// @ts-expect-error cases expect SDK exits, not IDs
const invalidCase: RouteCase = { name: "invalid", request: {}, expect: "edge" };
void invalidCase;
const caseResult: CaseResult = {
  profile: "example",
  name: "example",
  ok: false,
  outcome: "indeterminate",
  expected: "edge",
  needs: { kind: "dns" },
};
void caseResult;

// @feature docs/feature/profile/library/surge.md#不支持-udp-的出口
const surgeUdpGeneral: import("proxylang").SurgeGeneral = {
  "udp-policy-not-supported-behaviour": "REJECT",
};
const surgeDirectGeneral: import("proxylang").SurgeGeneral = {
  "udp-policy-not-supported-behaviour": "DIRECT",
};
defineProfile({
  target: { engine: "surge", platform: "ios", version: "5.21.0" },
  proxies: [],
  groups: [],
  routes: [],
  fallback: outbound.direct,
  surge: { general: [[surgeUdpGeneral], surgeDirectGeneral] },
});
const invalidUdpGeneral: import("proxylang").SurgeGeneral = {
  // @ts-expect-error the Surge option uses an uppercase literal union
  "udp-policy-not-supported-behaviour": "reject",
};
void invalidUdpGeneral;
