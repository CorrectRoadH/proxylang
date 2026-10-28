import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import {
  compile,
  render,
  proxy,
  secret,
  compileProxyNodes,
  renderProxyNodes,
  match,
  rule,
  route,
} from "../src/index.js";
import { protocolConfig } from "./proxy-fixtures.js";

const base = { id: "hy2", server: "192.0.2.10", port: 443, password: secret("PASS") };
const node = proxy.hysteria2({
  ...base,
  serverName: "tls.example.com",
  skipCertVerify: true,
  portHopping: "443;40000-60000",
  portHoppingInterval: 30,
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("Hysteria2 preserves authentication, TLS and port hopping across all engines and permits UDP", () => {
  for (const engine of ["surge", "sing-box", "mihomo", "stash"] as const) {
    const config = protocolConfig(engine);
    const compiled = compile({
      ...config,
      targets: config.targets.map((t) => ({
        ...t,
        mode: engine === "stash" ? "fragment" : "standalone",
      })),
      programs: {
        protocols: {
          ...config.programs.protocols!,
          listener: engine === "stash" ? undefined : config.programs.protocols!.listener,
          nodes: [node],
          routing: [rule("udp", match.network("udp"), route("hy2"))],
        },
      },
    });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    let calls = 0;
    const content = render(compiled, () => {
      calls++;
      return "test-pass";
    })[0]!.content;
    assert.equal(calls, 1);
    if (engine === "surge") {
      assert.match(
        content,
        /hy2 = hysteria2, 192.0.2.10, 443, password=test-pass, sni=tls.example.com, skip-cert-verify=true, port-hopping=443;40000-60000, port-hopping-interval=30/,
      );
    } else if (engine === "sing-box") {
      const result = JSON.parse(content).outbounds.find((n: any) => n.tag === "hy2");
      assert.equal(result.password, "test-pass");
      assert.deepEqual(result.tls, {
        enabled: true,
        server_name: "tls.example.com",
        insecure: true,
      });
      assert.deepEqual(result.server_ports, ["443:443", "40000:60000"]);
      assert.equal(result.hop_interval, "30s");
      assert.equal(result.server_port, undefined);
    } else {
      const result = parse(content).proxies[0];
      assert.equal(result[engine === "stash" ? "auth" : "password"], "test-pass");
      assert.equal(result[engine === "stash" ? "password" : "auth"], undefined);
      assert.equal(result.sni, "tls.example.com");
      assert.equal(result["skip-cert-verify"], true);
      assert.equal(result.ports, "443,40000-60000");
      assert.equal(result["hop-interval"], 30);
    }
  }
});

// @use-case docs/feature/target-compilation/use-case/define-proxies.md
test("Hysteria2 rejects invalid port ranges, intervals and Surge hopping via; no secret reads on failure", () => {
  const target = { engine: "surge", platform: "macos", version: "6.10.0" } as const;
  for (const options of [
    ...["", "0", "65536", "60000-40000", "443;", "443,8443", "1\n", "1-65536"].map(
      (portHopping) => ({ portHopping }),
    ),
    { portHoppingInterval: 30 },
    { portHopping: "443", portHoppingInterval: 0 },
    { portHopping: "443", portHoppingInterval: 1.5 },
    { tcpFastOpen: true },
    { portHopping: "443", via: "relay" },
  ]) {
    const compiled = compileProxyNodes({
      target,
      nodes: [{ ...base, type: "hysteria2", ...options }],
      externals: [{ id: "relay", nativeName: "Relay", kind: "group" }],
    });
    assert.equal(compiled.ok, false, JSON.stringify(options));
    assert.throws(
      () =>
        renderProxyNodes(compiled, () => {
          throw new Error("SECRET_READ");
        }),
      /COMPILATION_FAILED/,
    );
  }
  const simple = compileProxyNodes({ target, nodes: [proxy.hysteria2(base)] });
  assert.equal(simple.ok, true);
  assert.equal(
    renderProxyNodes(simple, () => "test-pass").content,
    "hy2 = hysteria2, 192.0.2.10, 443, password=test-pass\n",
  );
});
