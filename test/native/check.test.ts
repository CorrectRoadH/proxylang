import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { parse, stringify } from "yaml";
import { scenarios } from "../fixtures/scenarios.js";
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
