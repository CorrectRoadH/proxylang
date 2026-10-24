import {
  defineConfig,
  direct,
  group,
  match,
  policy,
  route,
  rule,
  secret,
  slot,
  strategy,
  surge,
  use,
  type Engine,
  type Program,
  type ProxyNode,
} from "proxylang";

// One rule template, four explicitly chosen platform implementations.
const browsing = policy({
  id: "browsing",
  exits: ["proxy"],
  rules: [
    rule("intranet", match.domainSuffix("internal.example"), direct()),
    rule("web", match.all(match.network("tcp"), match.port(443)), slot("proxy")),
  ],
});
const nodes: readonly ProxyNode[] = [
  {
    id: "edge",
    type: "trojan",
    server: "192.0.2.10",
    port: 443,
    password: secret("DEMO_PASSWORD"),
    serverName: "edge.example",
  },
];
const adaptive = strategy({
  id: "adaptive",
  members: ["edge"],
  implementations: {
    surge: surge.smart(),
    "sing-box": group.urltest({ url: "https://www.gstatic.com/generate_204" }),
    mihomo: group.urltest({ url: "https://www.gstatic.com/generate_204" }),
    // Stash benchmarks are node-scoped; select is an explicit choice, not a fallback.
    stash: group.select(),
  },
});
const program = (engine: Engine): Program => ({
  engine,
  nodes,
  groups: [adaptive],
  routing: [use(browsing, { id: "web", bindings: { proxy: route("adaptive") } })],
  fallback: direct(),
});
export default defineConfig({
  outDir: "../../out/clients",
  programs: {
    surge: program("surge"),
    singbox: program("sing-box"),
    mihomo: program("mihomo"),
    stash: program("stash"),
  },
  targets: [
    { id: "surge", program: "surge", engine: "surge", platform: "macos", version: "6.10.0" },
    { id: "singbox", program: "singbox", engine: "sing-box", platform: "linux", version: "1.12.0" },
    { id: "mihomo", program: "mihomo", engine: "mihomo", platform: "linux", version: "1.19.32" },
    { id: "stash", program: "stash", engine: "stash", platform: "macos", version: "4.2.1" },
  ],
});
