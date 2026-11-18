import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { parse, stringify } from "yaml";
import { defineBuild, runBuild } from "proxylang";
import { fixtureSecrets, scenarioProfile, scenarios } from "../fixtures/scenarios.js";
const exec = promisify(execFile),
  enabled = process.env.PROXYLANG_NATIVE_CHECK === "1";
const selected = process.env.SING_BOX_VERSION;
// @feature docs/engineering/testing/README.md
for (const s of scenarios.filter(
  (s) =>
    (s.engine === "sing-box" && (!selected || s.version === selected)) ||
    (s.engine === "mihomo" && !selected),
))
  test.skipIf(!enabled)(
    `native ${s.id}`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), "proxylang-native-"));
      const binary = resolve(`.cache/native/${s.engine}-${s.version}`);
      const server = createServer((_req, res) =>
        res.end(
          s.engine === "sing-box"
            ? JSON.stringify({ version: 1, rules: [{ domain_suffix: ["example.com"] }] })
            : "payload:\n  - '.example.com'\n",
        ),
      );
      try {
        await access(binary);
        const version = await exec(binary, [s.engine === "sing-box" ? "version" : "-v"]);
        assert.ok((version.stdout + version.stderr).includes(s.version));
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const source = await readFile(
          new URL(
            `../golden/${s.id}/expected.${s.engine === "sing-box" ? "json" : "yaml"}`,
            import.meta.url,
          ),
          "utf8",
        );
        const file = join(root, "fixture." + (s.engine === "sing-box" ? "json" : "yaml"));
        if (s.engine === "sing-box") {
          const config = JSON.parse(source);
          if (s.mode === "fragment") {
            assert.equal(config.inbounds, undefined);
            assert.equal(config.dns, undefined);
            assert.equal(config.endpoints, undefined);
            config.inbounds = [
              { type: "mixed", tag: "fixture-listener", listen: "127.0.0.1", listen_port: 16900 },
            ];
            config.dns = {
              servers: [{ type: "udp", tag: "pl-dns", server: "192.0.2.53", server_port: 53 }],
              final: "pl-dns",
              strategy: "prefer_ipv4",
            };
            config.route.default_domain_resolver = { server: "pl-dns", strategy: "prefer_ipv4" };
          }
          for (const set of config.route.rule_set ?? [])
            set.url = `http://127.0.0.1:${address.port}/rules`;
          for (const endpoint of config.endpoints ?? []) {
            assert.match(version.stdout, /\bwith_tailscale\b/);
            endpoint.state_directory = join(root, "identity");
          }
          await writeFile(file, JSON.stringify(config), { mode: 0o600 });
          await exec(binary, ["check", "-c", file], { cwd: root, timeout: 15000 });
          await assert.rejects(access(join(root, "identity")));
        } else {
          const config = parse(source);
          if (s.mode === "fragment") {
            for (const key of ["mixed-port", "dns", "tun"]) assert.equal(config[key], undefined);
            Object.assign(config, {
              "mixed-port": 16900,
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
                nameserver: ["192.0.2.53"],
                "default-nameserver": ["192.0.2.53"],
                "respect-rules": false,
                "use-hosts": false,
                "use-system-hosts": false,
              },
            });
          }
          for (const provider of Object.values(config["rule-providers"] ?? {}) as { url: string }[])
            provider.url = `http://127.0.0.1:${address.port}/rules`;
          await writeFile(file, stringify(config), { mode: 0o600 });
          await exec(binary, ["-t", "-d", root, "-f", file], { cwd: root, timeout: 15000 });
        }
      } finally {
        await new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
        await rm(root, { recursive: true, force: true });
      }
    },
    20000,
  );

// @feature docs/feature/targets/format/sing-box.md
test.skipIf(!enabled || (!!selected && selected !== "1.14.4"))(
  "sing-box 1.14.4 starts with an empty cache and a remote rule set hostname",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "proxylang-bootstrap-"));
    const downloadedHosts: (string | undefined)[] = [];
    const http = createServer((req, res) => {
      downloadedHosts.push(req.headers.host);
      res.end(JSON.stringify({ version: 1, rules: [{ domain_suffix: ["example.com"] }] }));
    });
    const dns = createSocket("udp4");
    const portReservation = createServer();
    try {
      http.listen(0, "127.0.0.1");
      await once(http, "listening");
      const httpAddress = http.address();
      assert.ok(httpAddress && typeof httpAddress !== "string");

      dns.on("message", (query, client) => {
        // Return a single A record, or an empty answer for other question types.
        const questionEnd = query.indexOf(0, 12) + 5;
        const reply = Buffer.from(query.subarray(0, questionEnd));
        const isA = reply.readUInt16BE(questionEnd - 4) === 1;
        reply.writeUInt16BE(0x8180, 2);
        reply.writeUInt16BE(isA ? 1 : 0, 6);
        reply.writeUInt16BE(0, 10);
        const answer = Buffer.from("c00c000100010000003c00047f000001", "hex");
        dns.send(isA ? Buffer.concat([reply, answer]) : reply, client.port, client.address);
      });
      dns.bind(0, "127.0.0.1");
      await once(dns, "listening");

      const scenario = scenarios.find((s) => s.id === "sing-box-macos-1.14.4-standalone/rulesets")!;
      const result = await runBuild(
        defineBuild({
          outDir: root,
          profiles: { fixture: scenarioProfile(scenario) },
          secrets: fixtureSecrets,
        }),
      );
      assert.equal(result.published, true, JSON.stringify(result));

      portReservation.listen(0, "127.0.0.1");
      await once(portReservation, "listening");
      const listenerAddress = portReservation.address();
      assert.ok(listenerAddress && typeof listenerAddress !== "string");

      const file = join(root, "out", "fixture.json");
      const config = JSON.parse(await readFile(file, "utf8"));
      config.log = { level: "info" };
      for (const inbound of config.inbounds) inbound.listen_port = listenerAddress.port;
      for (const server of config.dns.servers) {
        if (server.tag === "pl-routed-dns") server.server_port = listenerAddress.port;
        if (server.tag === "pl-dns") {
          server.server = "127.0.0.1";
          server.server_port = dns.address().port;
        }
      }
      config.route.rule_set[0].url = `http://rules.example.com:${httpAddress.port}/rules`;
      await writeFile(file, JSON.stringify(config));
      await new Promise<void>((done) => portReservation.close(() => done()));

      const child = spawn(resolve(".cache/native/sing-box-1.14.4"), ["run", "-c", file], {
        cwd: root,
        timeout: 10000,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let started = false;
      let output = "";
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          output += chunk;
          if (!started && output.includes("sing-box started")) {
            started = true;
            child.kill("SIGTERM");
          }
        });
      }
      const [exitCode] = await once(child, "close");
      assert.match(output, /sing-box started/, output);
      assert.equal(exitCode, 0, output);
      assert.deepEqual(downloadedHosts, [`rules.example.com:${httpAddress.port}`]);
    } finally {
      portReservation.close();
      try {
        dns.close();
      } catch {
        // The socket may not have been bound if fixture setup failed.
      }
      await new Promise<void>((done) => {
        http.close(() => done());
        http.closeAllConnections();
      });
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
