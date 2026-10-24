import {
  defineConfig,
  direct,
  route,
  secret,
  selectNodes,
  use,
  type Group,
  type Program,
  type ProxyNode,
  type PolicyCase,
} from "proxylang";
import { homePolicy } from "../policies.js";

// Reserved documentation addresses, never real subscription data or credentials.
const nodes: readonly ProxyNode[] = [
  {
    id: "sg",
    type: "trojan",
    server: "192.0.2.10",
    port: 443,
    password: secret("DEMO_PASSWORD"),
    serverName: "sg.example",
    region: "SG",
    provider: "demo",
  },
  {
    id: "us",
    type: "trojan",
    server: "192.0.2.11",
    port: 443,
    password: secret("DEMO_PASSWORD"),
    serverName: "us.example",
    region: "US",
    provider: "demo",
  },
  {
    id: "residential",
    type: "http",
    server: "192.0.2.12",
    port: 8080,
    username: secret("DEMO_USER"),
    password: secret("DEMO_PASSWORD"),
    via: "relay",
    region: "US",
    provider: "residential",
  },
];
const groups: readonly Group[] = [
  { id: "proxy", type: "select", members: selectNodes(nodes, { providers: ["demo"] }) },
  {
    id: "ai",
    type: "select",
    members: selectNodes(nodes, { providers: ["demo"], regions: ["SG", "US"] }),
  },
  { id: "relay", type: "select", members: ["sg"] },
];
const shared = {
  nodes,
  groups,
  routing: [
    use(homePolicy, {
      id: "home",
      bindings: {
        proxy: route("proxy"),
        ai: route("ai"),
        dev: route("proxy"),
        residential: route("residential"),
      },
    }),
  ],
  fallback: route("proxy"),
  listener: { port: 16152, resolver: "1.1.1.1" },
};
const programs: Record<string, Program> = {
  macmini: { ...shared, engine: "surge" },
  zimacube: { ...shared, engine: "sing-box" },
};
const cases: PolicyCase[] = Object.keys(programs).flatMap((program) => [
  {
    id: `${program}-lark`,
    program,
    request: { network: "tcp", domain: "www.larksuite.com" },
    expect: { action: route("proxy"), rule: `${program}/home/work-before-block/lark` },
  },
  {
    id: `${program}-home-before-dev`,
    program,
    request: { network: "tcp", domain: "nas.home.example", sourceIp: "192.168.0.42" },
    expect: { action: direct(), rule: `${program}/home/home/services` },
  },
  {
    id: `${program}-lan-before-dev`,
    program,
    request: { network: "udp", ip: "192.168.0.8", sourceIp: "192.168.0.42" },
    expect: { action: direct() },
  },
  {
    id: `${program}-steam-store`,
    program,
    request: { network: "tcp", domain: "store.steampowered.com" },
    expect: { action: route("proxy"), rule: `${program}/home/custom/steam-store` },
  },
  {
    id: `${program}-steam-download`,
    program,
    request: { network: "tcp", domain: "cdn.steampowered.com" },
    expect: { action: direct() },
  },
  {
    id: `${program}-residential`,
    program,
    request: { network: "tcp", domain: "residential.example" },
    expect: { action: route("residential") },
  },
  {
    id: `${program}-residential-udp`,
    program,
    request: { network: "udp", domain: "residential.example" },
    expect: { action: route("proxy"), rule: "$fallback" },
  },
  {
    id: `${program}-ssh`,
    program,
    request: { network: "tcp", domain: "github.com", port: 22 },
    expect: { action: route("proxy"), rule: [program, "home", "ssh", "github"].join("/") },
  },
  {
    id: `${program}-https-not-ssh`,
    program,
    request: { network: "tcp", domain: "github.com", port: 443 },
    expect: { action: route("proxy"), rule: "$fallback" },
  },
  {
    id: `${program}-ai`,
    program,
    request: { network: "tcp", domain: "openai.com" },
    expect: { action: route("ai") },
  },
  {
    id: `${program}-tracker-web`,
    program,
    request: { network: "tcp", domain: "www.tracker.example" },
    expect: { action: route("proxy"), rule: [program, "home", "custom", "tracker-web"].join("/") },
  },
]);

export default defineConfig({
  outDir: "../../out/home",
  programs,
  targets: [
    {
      id: "macmini",
      program: "macmini",
      engine: "surge",
      version: "6.10.0",
      platform: "macos",
      mode: "standalone",
    },
    {
      id: "zimacube-legacy",
      program: "zimacube",
      engine: "sing-box",
      version: "1.11.0",
      platform: "linux",
      mode: "standalone",
    },
    {
      id: "zimacube",
      program: "zimacube",
      engine: "sing-box",
      version: "1.12.0",
      platform: "linux",
      mode: "standalone",
    },
  ],
  cases,
});
