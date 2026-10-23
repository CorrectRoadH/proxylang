import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  defineBuild,
  defineProfile,
  defineRoute,
  defineProxyGroup,
  outbound,
  runBuild,
  compile,
  compileProxyNodes,
  renderProxyNodes,
  proxy,
  singbox,
  mihomo,
  ruleSet,
  strategy,
  group,
  surge,
  direct,
  match as m,
  reject,
  render,
  route,
  rule,
  secret,
  type Config,
  type Engine,
  type ProxyNode,
} from "../src/index.js";
import { protocolConfig, testUuid } from "./proxy-fixtures.js";
import { trojan } from "./fixtures.js";

const exec = promisify(execFile);
const enabled = process.env.PROXYLANG_NATIVE_CHECK === "1";
// @use-case docs/feature/target-compilation/use-case/provider-nodes.md
test.skipIf(!enabled)("原生节点片段 Surge 6.10.0：域名、原生名、TLS/TFO与外部组", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-nodes-native-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const info = await exec("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    "/Applications/Surge.app/Contents/Info.plist",
  ]);
  assert.equal(info.stdout.trim(), "6.10.0");
  const compilation = compileProxyNodes({
    target: { engine: "surge", platform: "macos", version: "6.10.0" },
    nodes: [
      proxy.trojan({
        id: "entry",
        server: "entry.example.com",
        port: 443,
        password: secret("PASS"),
        serverName: "tls.example.com",
        skipCertVerify: true,
        tcpFastOpen: true,
        surge: { udpRelay: true },
      }),
      proxy.anytls({
        id: "any",
        server: "any.example.com",
        port: 443,
        password: secret("PASS"),
        serverName: "tls.example.com",
        skipCertVerify: true,
        tcpFastOpen: false,
        surge: { udpRelay: true },
      }),
      proxy
        .builder(
          proxy.http({
            id: "exit",
            server: "exit.example.com",
            port: 8080,
            password: secret("PASS"),
            username: secret("USER"),
          }),
        )
        .via("relay")
        .build(),
    ],
    names: { entry: "🇭🇰 示例节点", any: "备用 节点", exit: "出口" },
    externals: [{ id: "relay", nativeName: "Relay Group", kind: "group" }],
  });
  assert.equal(compilation.ok, true, JSON.stringify(compilation.diagnostics));
  const content = renderProxyNodes(compilation, () => "test-only").content;
  const path = join(root, "nodes.conf");
  await writeFile(
    path,
    `[General]\nloglevel = notify\n[Proxy]\n${content}[Proxy Group]\nRelay Group = select, 🇭🇰 示例节点, 备用 节点\n[Rule]\nDOMAIN,example.com,出口\nFINAL,DIRECT\n`,
  );
  const checked = await exec("/Applications/Surge.app/Contents/Applications/surge-cli", [
    "--check",
    path,
  ]);
  assert.match(checked.stdout, /OK/);
});
for (const [engine, version] of [
  ["sing-box", "1.11.0"],
  ["sing-box", "1.12.0"],
  ["surge", "6.10.0"],
] as const) {
  test.skipIf(!enabled)(
    `原生离线校验 ${engine} ${version}：所有条件、协议、组、DNS 与 reject fallback`,
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "proxylang-native-"));
      t.onTestFinished(() => rm(root, { recursive: true, force: true }));
      let binary: string;
      if (engine === "sing-box") {
        binary = resolve(`.cache/native/sing-box-${version}`);
        const result = await exec(binary, ["version"]);
        assert.match(
          result.stdout,
          new RegExp(`sing-box version ${version.replaceAll(".", "\\.")}\n`),
        );
      } else {
        binary = "/Applications/Surge.app/Contents/Applications/surge-cli";
        const info = await exec("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleShortVersionString",
          "/Applications/Surge.app/Contents/Info.plist",
        ]);
        assert.equal(info.stdout.trim(), version);
      }
      const nodes: ProxyNode[] = [
        trojan,
        {
          id: "http",
          type: "http",
          server: "2001:db8::1",
          port: 8080,
          username: secret("USER"),
          password: secret("PASSWORD"),
          via: "relay",
        },
        ...(version !== "1.11.0" ? [{ ...trojan, id: "anytls", type: "anytls" as const }] : []),
      ];
      const conditions = [
        m.domain("example.com"),
        m.domainSuffix("example.org"),
        m.ipCidr("192.0.2.0/24"),
        m.ipCidr("2001:db8::/32"),
        m.sourceIp("192.168.0.0/16"),
        m.sourceIp("fd00::/8"),
        m.port(443),
        m.port(1000, 2000),
        m.sourcePort(12345),
        m.sourcePort(40000, 60000),
        m.network("udp"),
        m.not(m.domain("not.example")),
        m.all(m.network("tcp"), m.any(m.ipCidr("10.0.0.0/8"), m.not(m.ipCidr("fd00::/8")))),
      ];
      const config: Config = {
        programs: {
          native: {
            engine: engine as Engine,
            nodes,
            groups: [
              strategy({ id: "portable", members: ["edge"], algorithm: group.auto() }),
              strategy({
                id: "adaptive",
                members: ["edge"],
                implementations: {
                  surge: surge.smart(),
                  "sing-box": group.urltest({ url: "https://example.com/test" }),
                },
              }),
              { id: "relay", type: "select", members: ["edge"] },
              ...(engine === "sing-box"
                ? [
                    {
                      id: "auto",
                      type: "urltest" as const,
                      members: ["edge"],
                      url: "https://example.com/test",
                    },
                  ]
                : []),
            ],
            routing: [
              ...conditions.map((condition, i) =>
                rule(`condition-${i}`, condition, i % 2 ? direct() : reject()),
              ),
              rule("http", m.network("tcp"), route("http")),
              ...(version !== "1.11.0" ? [rule("anytls", m.network("tcp"), route("anytls"))] : []),
            ],
            fallback: reject(),
            listener: { port: 16152, resolver: "1.1.1.1" },
          },
        },
        targets: [
          {
            id: "native",
            program: "native",
            engine,
            version,
            platform: process.platform === "linux" ? "linux" : "macos",
            mode: "standalone",
          },
        ],
      };
      const result = compile(config);
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      const artifact = render(result, () => "native-test-only")[0]!;
      const path = join(root, artifact.filename);
      await writeFile(path, artifact.content, { mode: 0o600 });
      const checked = await exec(
        binary,
        engine === "surge" ? ["--check", path] : ["check", "-c", path],
        { timeout: 30000 },
      );
      if (engine === "surge") assert.match(checked.stdout, /OK/);
    },
  );
}

// @use-case docs/feature/target-compilation/use-case/clash-backends.md
test.skipIf(!enabled)(
  "原生离线校验 Mihomo 1.19.32：YAML 协议、代理链、逻辑 no-resolve 与内部 DNS",
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "proxylang-mihomo-native-"));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const binary = resolve(".cache/native/mihomo-1.19.32");
    const version = await exec(binary, ["-v"], { timeout: 30000 });
    assert.match(version.stdout, /Mihomo Meta v?1\.19\.32(?:\s|$)/);
    const conditions = [
      m.domain("example.com"),
      m.domainSuffix("example.org"),
      m.ipCidr("192.0.2.0/24"),
      m.ipCidr("2001:db8::/32"),
      m.sourceIp("192.168.0.0/16"),
      m.sourceIp("fd00::/8"),
      m.port(443),
      m.port(1000, 2000),
      m.sourcePort(12345),
      m.sourcePort(40000, 60000),
      m.network("udp"),
      m.not(m.ipCidr("192.0.2.0/24")),
      m.all(m.network("tcp"), m.any(m.ipCidr("10.0.0.0/8"), m.not(m.ipCidr("fd00::/8")))),
    ];
    const config: Config = {
      programs: {
        native: {
          engine: "mihomo",
          nodes: [
            trojan,
            { ...trojan, id: "anytls", type: "anytls", via: "relay" },
            {
              id: "http",
              type: "http",
              server: "2001:db8::1",
              port: 8080,
              username: secret("USER"),
              password: secret("PASSWORD"),
              via: "relay",
            },
          ],
          groups: [
            strategy({ id: "portable", members: ["edge"], algorithm: group.auto() }),
            strategy({
              id: "adaptive",
              members: ["edge"],
              implementations: {
                mihomo: group.urltest({ url: "https://example.com/check?x=1&y=2" }),
              },
            }),
            { id: "relay", type: "select", members: ["edge"] },
          ],
          routing: [
            ...conditions.map((condition, i) =>
              rule(`condition-${i}`, condition, i % 2 ? direct() : reject()),
            ),
            rule("http", m.network("tcp"), route("http")),
            rule("anytls", m.network("tcp"), route("anytls")),
          ],
          fallback: reject(),
          listener: { port: 16153, resolver: "1.1.1.1" },
        },
      },
      targets: [
        {
          id: "native",
          program: "native",
          engine: "mihomo",
          version: "1.19.32",
          platform: process.platform === "linux" ? "linux" : "macos",
          mode: "standalone",
        },
      ],
    };
    const compiled = compile(config);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const artifact = render(compiled, () => "native: 'quoted', \"password\"\nsecond-line")[0]!;
    const path = join(root, artifact.filename);
    await writeFile(path, artifact.content, { mode: 0o600 });
    const checked = await exec(binary, ["-t", "-d", root, "-f", path], { timeout: 30000 });
    assert.match(checked.stdout + checked.stderr, /configuration.*(?:successful|successfully)/i);
  },
);

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
for (const [engine, version] of [
  ["surge", "6.10.0"],
  ["sing-box", "1.11.0"],
  ["sing-box", "1.12.0"],
  ["mihomo", "1.19.32"],
] as const) {
  test.skipIf(!enabled)(
    `原生代理资源 ${engine === "mihomo" ? "Mihomo" : engine} ${version}: SS/UUID/TLS/WS`,
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "proxylang-proxy-native-"));
      t.onTestFinished(() => rm(root, { recursive: true, force: true }));
      const config = protocolConfig(engine, version);
      const compiled = compile({
        ...config,
        targets: config.targets.map((target) => ({
          ...target,
          platform: process.platform === "linux" ? "linux" : "macos",
        })),
      });
      assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
      const artifact = render(compiled, (token) =>
        token.name === "UUID" ? testUuid : "native-test-only",
      )[0]!;
      const path = join(root, artifact.filename);
      await writeFile(path, artifact.content, { mode: 0o600 });
      const binary =
        engine === "surge"
          ? "/Applications/Surge.app/Contents/Applications/surge-cli"
          : resolve(`.cache/native/${engine}-${version}`);
      if (engine === "surge") {
        const info = await exec("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleShortVersionString",
          "/Applications/Surge.app/Contents/Info.plist",
        ]);
        assert.equal(info.stdout.trim(), version);
      } else {
        const info = await exec(binary, [engine === "mihomo" ? "-v" : "version"]);
        assert.match(
          info.stdout,
          engine === "mihomo"
            ? /Mihomo Meta v?1\.19\.32(?:\s|$)/
            : new RegExp(`sing-box version ${version.replaceAll(".", "\\.")}\\n`),
        );
      }
      const result = await exec(
        binary,
        engine === "surge"
          ? ["--check", path]
          : engine === "mihomo"
            ? ["-t", "-d", root, "-f", path]
            : ["check", "-c", path],
        { timeout: 30000 },
      );
      if (engine === "surge") assert.match(result.stdout, /OK/);
      if (engine === "mihomo")
        assert.match(result.stdout + result.stderr, /configuration.*(?:successful|successfully)/i);
    },
  );
}

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test.skipIf(!enabled)("原生 sing-box 1.12.0 Tailscale check 不启动身份且隔离DNS", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "proxylang-endpoint-native-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const stateDirectory = join(root, "identity");
  const binary = resolve(".cache/native/sing-box-1.12.0");
  const info = await exec(binary, ["version"]);
  assert.match(info.stdout, /sing-box version 1\.12\.0\n/);
  assert.match(info.stdout, /\bwith_tailscale\b/);
  const compiled = compile({
    programs: {
      home: {
        engine: "sing-box",
        nodes: [],
        groups: [],
        endpoints: [
          singbox.tailscale({
            id: "home",
            hostname: "test-only",
            stateDirectory,
            acceptRoutes: true,
            bootstrapResolver: "9.9.9.9",
          }),
        ],
        routing: [rule("lan", m.ipCidr("192.168.50.0/24"), route("home"))],
        fallback: direct(),
        listener: { port: 16902, resolver: "1.1.1.1" },
      },
    },
    targets: [
      {
        id: "native",
        program: "home",
        engine: "sing-box",
        platform: process.platform === "linux" ? "linux" : "macos",
        version: "1.12.0",
        mode: "standalone",
      },
    ],
  });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const artifact = render(compiled, () => {
    throw new Error("No authentication is required by this offline fixture");
  })[0]!;
  const path = join(root, artifact.filename);
  await writeFile(path, artifact.content, { mode: 0o600 });
  await assert.rejects(access(stateDirectory));
  await exec(binary, ["check", "-c", path], { timeout: 30000, cwd: root });
  await assert.rejects(access(stateDirectory));
});

// @use-case docs/feature/rule-composition/use-case/compose-native-rule-sets.md
for (const [engine, version] of [
  ["surge", "6.10.0"],
  ["sing-box", "1.11.0"],
  ["sing-box", "1.12.0"],
  ["mihomo", "1.19.32"],
] as const) {
  test.skipIf(!enabled)(
    `原生规则集 ${engine === "mihomo" ? "Mihomo" : engine} ${version} 组合与客户端资源引用`,
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "proxylang-rule-set-native-"));
      t.onTestFinished(() => rm(root, { recursive: true, force: true }));
      const server = createServer((_req, res) => {
        res.setHeader("Content-Type", "text/plain");
        res.end(
          engine === "sing-box"
            ? JSON.stringify({ version: 1, rules: [{ domain_suffix: ["example.org"] }] })
            : engine === "mihomo"
              ? "payload:\n  - DOMAIN-SUFFIX,example.org\n"
              : "DOMAIN-SUFFIX,example.org\n",
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      t.onTestFinished(
        () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      );
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/rules`;
      const remote =
        engine === "surge"
          ? surge.ruleSet({ id: "remote", url })
          : engine === "sing-box"
            ? singbox.ruleSet({ id: "remote", url, format: "source", intervalSeconds: 600 })
            : mihomo.ruleProvider({
                id: "remote",
                url,
                format: "yaml",
                behavior: "classical",
                intervalSeconds: 600,
              });
      const set = ruleSet({ id: "combined", when: m.any(remote, m.domain("example.net")) });
      const result = compile({
        programs: {
          home: {
            engine,
            nodes: [],
            groups: [],
            routing: [
              rule("nested", m.all(m.network("tcp"), m.not(set)), direct()),
              rule("remote", remote, direct()),
              ...(engine === "surge"
                ? [
                    rule(
                      "explicit",
                      surge.ruleSet({ id: "timed", url: url + "/timed", intervalSeconds: 600 }),
                      direct(),
                    ),
                    rule(
                      "domains",
                      surge.ruleSet({
                        id: "domains",
                        url: url + "/domains",
                        format: "domain-set",
                        intervalSeconds: 600,
                      }),
                      direct(),
                    ),
                    rule(
                      "domain-nested",
                      m.not(
                        surge.ruleSet({
                          id: "domain-default",
                          url: url + "/domain-default",
                          format: "domain-set",
                        }),
                      ),
                      direct(),
                    ),
                  ]
                : []),
            ],
            fallback: direct(),
            listener: { port: 16154, resolver: "1.1.1.1" },
          },
        },
        targets: [
          {
            id: "native",
            program: "home",
            engine,
            version,
            platform: process.platform === "linux" ? "linux" : "macos",
            mode: "standalone",
          },
        ],
      });
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      const artifact = render(result, () => undefined)[0]!;
      const path = join(root, artifact.filename);
      await writeFile(path, artifact.content);
      const binary =
        engine === "surge"
          ? "/Applications/Surge.app/Contents/Applications/surge-cli"
          : resolve(`.cache/native/${engine}-${version}`);
      if (engine === "surge") {
        const info = await exec("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleShortVersionString",
          "/Applications/Surge.app/Contents/Info.plist",
        ]);
        assert.equal(info.stdout.trim(), version);
      } else {
        const info = await exec(binary, [engine === "mihomo" ? "-v" : "version"]);
        assert.ok(info.stdout.includes(version));
      }
      const checked = await exec(
        binary,
        engine === "surge"
          ? ["--check", path]
          : engine === "mihomo"
            ? ["-t", "-d", root, "-f", path]
            : ["check", "-c", path],
        { timeout: 30000, cwd: root },
      );
      if (engine === "surge") assert.match(checked.stdout, /OK/);
      if (engine === "mihomo")
        assert.match(
          checked.stdout + checked.stderr,
          /configuration.*(?:successful|successfully)/i,
        );
    },
  );
}

// @use-case docs/feature/target-compilation/use-case/build-targets.md
test.skipIf(!enabled)("portable profile sing-box 1.12.0 standalone native check", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portable-native-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const endpoint = singbox.tailscale({
    id: "tailnet",
    hostname: "fixture",
    stateDirectory: join(root, "identity"),
    acceptRoutes: true,
    bootstrapResolver: "9.9.9.9",
  });
  const edge = proxy.trojan({
    id: "edge",
    server: "192.0.2.1",
    port: 443,
    password: secret("PASS"),
  });
  const choice = defineProxyGroup({
    id: "choice",
    name: "Choice",
    algorithm: group.urltest({ url: "https://example.com", intervalSeconds: 60 }),
    members: [edge],
  });
  const profile = defineProfile({
    target: { engine: "sing-box", platform: "linux", version: "1.12.0" },
    nodes: [edge],
    groups: [choice],
    endpoints: [endpoint],
    routes: [
      defineRoute({ when: m.ipCidr("192.168.50.0/24"), to: endpoint }),
      defineRoute({ when: m.ipCidr("2001:db8::/32"), to: choice }),
    ],
    fallback: outbound.direct,
    singBox: { mode: "standalone", listener: { port: 16902, resolver: "1.1.1.1" } },
  });
  const result = await runBuild(
    defineBuild({ profiles: { linux: profile }, resolveSecret: () => "fixture" }),
    join(root, "output"),
  );
  assert.equal(result.exitCode, 0);
  await exec(
    resolve(".cache/native/sing-box-1.12.0"),
    ["check", "-c", join(root, "output/out/linux.json")],
    { timeout: 30000, cwd: root },
  );
  await assert.rejects(access(endpoint.stateDirectory));
});
