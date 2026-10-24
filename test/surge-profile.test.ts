/// <reference types="node" />
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  compileSurgeProfile,
  renderSurgeProfile,
  renderSurgeProfiles,
  proxy,
  secret,
  type SurgeProfileInput,
  type SurgeCondition,
} from "../src/index.js";

const base = (): SurgeProfileInput => ({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  managed: {
    url: "https://example.com/device.conf",
    query: { token: secret("TOKEN") },
    intervalSeconds: 3600,
    strict: false,
  },
  general: {
    loglevel: "notify",
    "dns-server": ["223.5.5.5"],
    "http-api": { password: secret("CONTROL"), listen: "0.0.0.0:6170" },
  },
  hosts: [{ pattern: "*.example.org", server: "https://dns.example.com/query" }],
  nodes: [
    proxy.trojan({
      id: "edge",
      server: "edge.example.com",
      port: 443,
      password: secret("PASS"),
      surge: { udpRelay: true },
    }),
  ],
  groups: [
    { id: "select", type: "select", members: [{ ref: "smart" }, { builtin: "DIRECT" }] },
    { id: "smart", type: "smart", members: [{ ref: "edge" }] },
  ],
  names: { edge: "🇭🇰 测试节点", select: "PROXY", smart: "Smart" },
  rules: [
    { when: { type: "sourceIp", value: "192.168.0.131" }, then: { builtin: "DIRECT" } },
    { when: { type: "ipCidr", value: "10.0.0.0/8", noResolve: true }, then: { ref: "select" } },
  ],
  fallback: { ref: "select" },
});
const values: Record<string, string> = {
  TOKEN: "a&b +/=?",
  CONTROL: "control-pass",
  PASS: "test-pass",
  KEY: Buffer.alloc(32, 1).toString("base64"),
  TAIL: "tskey-auth-fixture",
};
const resolve = (token: { name: string }) => values[token.name];
function fails(input: unknown, code: string) {
  const c = compileSurgeProfile(input);
  assert.equal(c.ok, false);
  assert.ok(
    c.diagnostics.some((d) => d.code === code),
    JSON.stringify(c.diagnostics),
  );
  let reads = 0;
  assert.throws(
    () =>
      renderSurgeProfile(c, () => {
        reads++;
        return "never";
      }),
    /COMPILATION_FAILED/,
  );
  assert.equal(reads, 0);
}
// @use-case docs/feature/target-compilation/use-case/surge-profile.md
test("complete profile renders ordered rules, names, hosts, parameters and encoded managed token", () => {
  const c = compileSurgeProfile(base());
  assert.equal(c.ok, true);
  const out = renderSurgeProfile(c, resolve).content;
  assert.ok(
    out.startsWith(
      "#!MANAGED-CONFIG https://example.com/device.conf?token=a%26b+%2B%2F%3D%3F interval=3600 strict=false",
    ),
  );
  assert.ok(out.includes("http-api = control-pass@0.0.0.0:6170"));
  assert.ok(out.includes("*.example.org = server:https://dns.example.com/query"));
  assert.ok(out.includes("PROXY = select, Smart, DIRECT"));
  assert.ok(
    out.endsWith(
      "[Rule]\nSRC-IP,192.168.0.131,DIRECT\nIP-CIDR,10.0.0.0/8,PROXY,no-resolve\nFINAL,PROXY\n",
    ),
  );
  assert.ok(!JSON.stringify(c).includes("test-pass"));
});
test("exact target gates and strict schemas reject unsupported platform fields and injection", () => {
  fails(
    { ...base(), target: { engine: "surge", platform: "ios", version: "5.20.0" } },
    "UNKNOWN_TARGET",
  );
  fails({ ...base(), general: { "unknown-key": true } }, "INVALID_SCHEMA");
  fails(
    { ...base(), hosts: [{ pattern: "ok.example", address: "1.1.1.1\n[Rule]" }] },
    "INVALID_SCHEMA",
  );
  fails({ ...base(), hosts: [{ pattern: "ok.example" }] }, "INVALID_SCHEMA");
  fails({ ...base(), general: { "dns-server": ["dns.example.com"] } }, "INVALID_SCHEMA");
  fails({ ...base(), general: { "http-listen": "0.0.0.0:99999" } }, "INVALID_SCHEMA");
  fails(
    { ...base(), managed: { ...base().managed!, url: "https://u:p@example.com/a" } },
    "INVALID_SCHEMA",
  );
  fails(
    { ...base(), managed: { ...base().managed!, url: "https://example.com/a?token=x" } },
    "INVALID_SCHEMA",
  );
  const ios = {
    ...base(),
    target: { engine: "surge", platform: "ios", version: "5.21.0" } as const,
  };
  assert.equal(
    compileSurgeProfile({
      ...ios,
      nodes: [
        proxy.anytls({
          id: "edge",
          server: "a.example",
          port: 443,
          password: secret("PASS"),
          surge: { udpRelay: true },
        }),
      ],
    }).ok,
    true,
  );
  fails({ ...ios, general: { "bypass-system": true } }, "PLATFORM_OPTION_UNSUPPORTED");
  fails(
    {
      ...ios,
      rules: [{ when: { type: "processName", value: "curl" }, then: { builtin: "DIRECT" } }],
    },
    "PLATFORM_RULE_UNSUPPORTED",
  );
  fails(
    {
      ...ios,
      rules: [
        { when: { type: "macAddress", value: "00:11:22:33:44:55" }, then: { builtin: "DIRECT" } },
      ],
    },
    "PLATFORM_RULE_UNSUPPORTED",
  );
});
test("all resources participate in the graph, including orphan and mixed via/group cycles", () => {
  const p = base();
  fails({ ...p, nodes: [{ ...p.nodes[0], via: "select" }] }, "RESOURCE_CYCLE");
  fails(
    { ...p, groups: [...p.groups, { id: "orphan", type: "select", members: [{ ref: "orphan" }] }] },
    "RESOURCE_CYCLE",
  );
  fails({ ...p, nodes: [{ ...p.nodes[0], via: "missing" }] }, "MISSING_REFERENCE");
  fails(
    { ...p, rules: [{ when: { type: "domain", value: "x.example" }, then: { ref: "missing" } }] },
    "MISSING_REFERENCE",
  );
  fails({ ...p, names: { ...p.names, edge: "PROXY" } }, "DUPLICATE_NATIVE_NAME");
  fails({ ...p, names: { ...p.names, edge: "REJECT-DROP" } }, "INVALID_NATIVE_NAME");
  fails(
    {
      ...p,
      groups: [
        { id: "smart", type: "smart", members: [{ builtin: "DIRECT" }] },
        { id: "select", type: "select", members: [{ ref: "edge" }] },
      ],
    },
    "SMART_MEMBER_UNSUPPORTED",
  );
  fails(
    {
      ...p,
      groups: [
        ...p.groups,
        { id: "another", type: "smart", members: [{ ref: "edge" }], intervalSeconds: 60 },
      ],
    },
    "GROUP_OPTION_UNSUPPORTED",
  );
});
test("rule options retain their own scope and no-resolve is never inserted implicitly", () => {
  const when: SurgeCondition = {
    type: "all",
    conditions: [
      { type: "domain", value: "x.example", includeSniffed: true },
      { type: "ipCidr", value: "10.0.0.0/8", noResolve: true },
    ],
  };
  const out = renderSurgeProfile(
    compileSurgeProfile({
      ...base(),
      rules: [
        { when, then: { builtin: "DIRECT" } },
        { when: { type: "ipCidr6", value: "fd00::/8" }, then: { builtin: "DIRECT" } },
      ],
    }),
    resolve,
  ).content;
  assert.ok(
    out.includes(
      "AND,((DOMAIN,x.example,extended-matching),(IP-CIDR,10.0.0.0/8,no-resolve)),DIRECT",
    ),
  );
  assert.ok(out.includes("IP-CIDR6,fd00::/8,DIRECT\n"));
  for (const invalid of [
    { type: "domain", value: "x.example", noResolve: false },
    { type: "port", from: 22, includeSniffed: true },
    { type: "port", from: 99, to: 22 },
    { type: "ipCidr", value: "fd00::/8" },
  ])
    assert.equal(
      compileSurgeProfile({ ...base(), rules: [{ when: invalid, then: { builtin: "DIRECT" } }] })
        .ok,
      false,
    );
});
test("logical depth boundary and rule-set format conflicts fail closed", () => {
  let when: SurgeCondition = { type: "domain", value: "example.com" };
  for (let i = 0; i < 10; i++) when = { type: "not", condition: when };
  assert.equal(
    compileSurgeProfile({ ...base(), rules: [{ when, then: { builtin: "DIRECT" } }] }).ok,
    true,
  );
  fails(
    { ...base(), rules: [{ when: { type: "not", condition: when }, then: { builtin: "DIRECT" } }] },
    "LOGICAL_DEPTH_EXCEEDED",
  );
  fails(
    {
      ...base(),
      rules: [
        {
          when: { type: "ruleSet", format: "domain-set", builtin: "LAN" },
          then: { builtin: "DIRECT" },
        },
      ],
    },
    "BUILTIN_RULESET_FORMAT",
  );
  fails(
    {
      ...base(),
      rules: ["rule-set", "domain-set"].map((format) => ({
        when: { type: "ruleSet", format, url: "https://example.com/a" },
        then: { builtin: "DIRECT" },
      })),
    },
    "RULESET_FORMAT_CONFLICT",
  );
  const c = compileSurgeProfile({
    ...base(),
    rules: [
      {
        when: {
          type: "ruleSet",
          format: "rule-set",
          url: "https://example.com/a",
          noResolve: true,
        },
        then: { builtin: "DIRECT" },
      },
    ],
  });
  assert.equal(c.ok, true);
  assert.ok(c.diagnostics.some((d) => d.code === "EXTERNAL_RULESET_UNVERIFIED"));
  assert.ok(
    renderSurgeProfile(c, resolve).content.includes(
      "RULE-SET,https://example.com/a,DIRECT,no-resolve",
    ),
  );
});
test("Tailscale and WireGuard encode all declared fields without leaking keys into compilation", () => {
  const p: SurgeProfileInput = {
    ...base(),
    tunnels: [
      {
        id: "tail",
        type: "tailscale",
        sectionName: "HomeTS",
        authKey: secret("TAIL"),
        hostname: "iphone",
        dnsServer: ["100.100.100.100"],
        autoAddMagicDnsRule: true,
        idleKeepalive: 0,
      },
      {
        id: "wg",
        type: "wireguard",
        sectionName: "HomeWG",
        privateKey: secret("KEY"),
        selfIp: "10.77.0.2",
        dnsServer: ["10.77.0.1"],
        mtu: 1280,
        peers: [
          {
            publicKey: Buffer.alloc(32, 2).toString("base64"),
            endpoint: "vpn.example.com:51820",
            allowedIps: ["0.0.0.0/0", "::/0"],
            presharedKey: secret("KEY"),
            persistentKeepalive: 25,
          },
        ],
      },
    ],
  };
  const c = compileSurgeProfile(p);
  assert.equal(c.ok, true);
  const out = renderSurgeProfile(c, resolve).content;
  assert.ok(out.includes("tail = tailscale, section-name=HomeTS"));
  assert.ok(out.includes("auto-add-magic-dns-rule = true\nidle-keepalive = 0"));
  assert.ok(
    out.includes(
      'allowed-ips = "0.0.0.0/0, ::/0", endpoint = vpn.example.com:51820, keepalive = 25',
    ),
  );
  assert.ok(!JSON.stringify(c).includes(values.KEY!));
  assert.throws(
    () => renderSurgeProfile(c, (t) => (t.name === "KEY" ? "bad-key" : resolve(t))),
    /SURGE_VALUE_UNREPRESENTABLE/,
  );
  fails(
    { ...p, tunnels: [p.tunnels![0], { ...p.tunnels![1], sectionName: "HomeTS" }] },
    "DUPLICATE_TUNNEL_SECTION",
  );
});
test("batch secrets resolve exactly once, preflight precedes reads, failed render returns no partial artifacts", () => {
  const c = compileSurgeProfile(base());
  const calls = new Map<string, number>();
  assert.equal(
    renderSurgeProfiles([c, c, c, c], (t) => {
      calls.set(t.name, (calls.get(t.name) ?? 0) + 1);
      return resolve(t);
    }).length,
    4,
  );
  assert.deepEqual([...calls.values()], [1, 1, 1]);
  let reads = 0;
  assert.throws(
    () =>
      renderSurgeProfiles([c, compileSurgeProfile({})], () => {
        reads++;
        return "value";
      }),
    /COMPILATION_FAILED/,
  );
  assert.equal(reads, 0);
  assert.throws(
    () =>
      renderSurgeProfile(c, () => {
        throw new Error("SECRET_MUST_NOT_LEAK");
      }),
    /^RenderError: SECRET_RESOLUTION_FAILED$/,
  );
  assert.throws(() => renderSurgeProfile(c, () => undefined), /^RenderError: SECRET_MISSING$/);
  assert.throws(
    () =>
      renderSurgeProfile(c, (t) => (t.name === "CONTROL" ? "pass@0.0.0.0:1\n[Rule]" : resolve(t))),
    /^RenderError: SURGE_VALUE_UNREPRESENTABLE$/,
  );
  assert.throws(
    () =>
      renderSurgeProfile(c, (t) => (t.name === "PASS" ? "pass,underlying-proxy=evil" : resolve(t))),
    /^RenderError: SURGE_VALUE_UNREPRESENTABLE$/,
  );
});
test("compiled plans are isolated from mutations and fabricated public results", () => {
  const p = structuredClone(base());
  const c = compileSurgeProfile(p);
  const out = renderSurgeProfile(c, resolve).content;
  (p.nodes[0] as { server: string }).server = "changed.example";
  assert.equal(renderSurgeProfile(c, resolve).content, out);
  assert.equal(Object.isFrozen(c.bindings), true);
  assert.throws(() => renderSurgeProfile({ ...c }, resolve), /COMPILATION_FAILED/);
  let accesses = 0;
  const bad = {
    get target() {
      accesses++;
      return base().target;
    },
  };
  fails(bad, "INVALID_INPUT_GRAPH");
  assert.equal(accesses, 0);
});

// @use-case docs/feature/target-compilation/use-case/surge-profile.md
test("General preserves author key order rather than schema declaration order", () => {
  const c = compileSurgeProfile({
    ...base(),
    general: {
      "http-api": { password: secret("CONTROL"), listen: "0.0.0.0:6170" },
      ipv6: false,
      loglevel: "notify",
      "dns-server": ["1.1.1.1"],
    },
  });
  const out = renderSurgeProfile(c, resolve).content;
  assert.ok(
    out.includes(
      "[General]\nhttp-api = control-pass@0.0.0.0:6170\nipv6 = false\nloglevel = notify\ndns-server = 1.1.1.1\n",
    ),
  );
});
