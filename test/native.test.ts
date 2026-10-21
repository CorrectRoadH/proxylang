import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  compile,
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
import { trojan } from "./fixtures.js";

const exec = promisify(execFile);
const enabled = process.env.PROXYLANG_NATIVE_CHECK === "1";
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
            platform: "macos",
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
