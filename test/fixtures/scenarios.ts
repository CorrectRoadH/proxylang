import {
  defineProfile,
  defineProxyGroup,
  defineRoutes as routeBatch,
  group,
  match,
  outbound,
  proxy,
  defineSecrets,
  dnsRule,
  ruleSet,
  singbox,
  surge,
  type ProfileDefinition,
  type Profile,
  type Condition as ProfileCondition,
  type Exit as ProfileDestination,
} from "proxylang";

const defineRoutes = (input: {
  when: ProfileCondition | readonly ProfileCondition[];
  to: ProfileDestination;
}) =>
  routeBatch({
    ...input,
    when: Array.isArray(input.when) ? input.when : [input.when],
  } as Parameters<typeof routeBatch>[0]);

export const fixtureSecrets = defineSecrets({
  TEST_PASSWORD: { value: "test-only", validation: "test-only" },
  TEST_USER: { value: "test-only", validation: "test-only" },
  TEST_UUID: {
    value: "11111111-2222-4333-8444-555555555555",
    validation: "11111111-2222-4333-8444-555555555555",
  },
  TEST_AUTH: { value: "test-only", validation: "test-only" },
  TEST_KEY: {
    value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    validation: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  },
});
const secret = (name: Extract<keyof typeof fixtureSecrets, string>) => fixtureSecrets[name];
export type Scenario = {
  id: string;
  engine: "surge" | "sing-box" | "mihomo" | "stash";
  platform: "macos" | "linux" | "ios";
  version: string;
  mode: "standalone" | "fragment";
  scene: string;
};
export const scenarios: Scenario[] = [];
for (const [engine, version, platforms, modes] of [
  ["surge", "6.11.0", ["macos"], ["standalone"]],
  ["surge", "5.23.0", ["ios"], ["standalone"]],
  ["sing-box", "1.14.4", ["macos", "linux"], ["standalone", "fragment"]],
  ["mihomo", "1.19.34", ["macos", "linux"], ["standalone", "fragment"]],
  ["stash", "5.0.0", ["macos"], ["fragment"]],
] as const)
  for (const platform of platforms)
    for (const mode of modes) {
      const scenes = ["protocols", "groups", "chain", "conditions", "names"];
      if (engine === "surge")
        scenes.push("group-options", "logical-single", "udp-reject", "udp-direct");
      if (engine !== "stash") scenes.push("rulesets");
      if (engine === "surge" || (engine === "sing-box" && mode === "standalone"))
        scenes.push("dns", "tunnel");
      if (engine === "sing-box") {
        scenes.push("modern");
        if (mode === "standalone")
          scenes.push("tun", "tailscale-relative-state", "tailscale-selector", "tailscale-dns");
      }
      for (const scene of scenes)
        scenarios.push({
          id: `${engine}-${platform}-${version}-${mode}/${scene}`,
          engine,
          platform,
          version,
          mode,
          scene,
        });
    }
export function scenarioDefinition(s: Scenario): ProfileDefinition {
  const pass = secret("TEST_PASSWORD");
  const nodes = [
    proxy.trojan({
      id: "edge",
      ...(s.scene === "names" ? { name: "Edge Example" } : {}),
      server: "192.0.2.10",
      port: 443,
      password: pass,
      serverName: "proxy.example.com",
    }),
  ];
  const resources: unknown[] = [...nodes];
  const routes = [...defineRoutes({ when: match.domainSuffix("example.com"), to: nodes[0]! })];
  const groups = [] as ReturnType<typeof defineProxyGroup>[];
  let extensions: Record<string, unknown> = {};
  if (s.scene === "protocols") {
    const all = [
      proxy.http({
        id: "http",
        server: "192.0.2.11",
        port: 8080,
        password: pass,
        username: secret("TEST_USER"),
      }),
      proxy.anytls({ id: "anytls", server: "192.0.2.12", port: 443, password: pass }),
      proxy.hysteria2({
        id: "hy2",
        server: "192.0.2.13",
        port: 443,
        password: pass,
        portHopping: "443;40000-40010",
        portHoppingInterval: 30,
      }),
      ...(["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"] as const).map((method, i) =>
        proxy.shadowsocks({
          id: `ss-${i}`,
          server: "192.0.2.14",
          port: 8388,
          method,
          password: pass,
        }),
      ),
      ...(["vmess", ...(s.engine !== "surge" ? (["vless"] as const) : [])] as const).flatMap(
        (type) =>
          [false, true].map((ws) =>
            proxy[type]({
              id: `${type}-${ws ? "ws" : "tcp"}`,
              server: "192.0.2.15",
              port: 443,
              uuid: secret("TEST_UUID"),
              tls: { serverName: "tls.example.com" },
              ...(ws
                ? { transport: { type: "ws" as const, path: "/proxy", host: "ws.example.com" } }
                : {}),
            }),
          ),
      ),
    ];
    resources.push(...all);
    all.forEach((node, i) =>
      routes.push(
        ...defineRoutes({ when: match.all(match.network("tcp"), match.port(1000 + i)), to: node }),
      ),
    );
  }
  if (s.scene === "groups") {
    groups.push(
      defineProxyGroup({ id: "choice", name: "Choice", algorithm: group.select(), members: nodes }),
    );
    if (s.engine !== "stash") {
      groups.push(
        defineProxyGroup({
          id: "automatic",
          name: "Automatic",
          algorithm: group.auto(),
          members: nodes,
        }),
      );
      if (s.engine !== "surge")
        groups.push(
          defineProxyGroup({
            id: "speed",
            name: "Speed",
            algorithm: group.urltest({ url: "https://example.com/check" }),
            members: nodes,
          }),
        );
    }
    groups.forEach((g, i) => routes.push(...defineRoutes({ when: match.port(2000 + i), to: g })));
  }
  if (s.scene === "chain") {
    resources.push(
      proxy.http({
        id: "chained",
        server: "192.0.2.20",
        port: 8080,
        password: pass,
        via: nodes[0],
      }),
    );
    routes.push(...defineRoutes({ when: match.network("tcp"), to: resources[1] as never }));
  }
  if (s.scene === "group-options") {
    const tested = defineProxyGroup({
      id: "tested-select",
      name: "Tested Select",
      algorithm: group.select(),
      members: nodes,
      surge: { url: "https://test.example.com/probe", intervalSeconds: 300, timeoutSeconds: 10 },
    });
    groups.push(tested);
    routes.unshift(...defineRoutes({ when: match.domain("selected.example"), to: tested }));
  }
  if (s.scene === "names") {
    const choice = defineProxyGroup({
      id: "named-choice",
      name: "Route Choice",
      algorithm: group.select(),
      members: nodes,
    });
    groups.push(choice);
    const chained = proxy.http({
      id: "named-chain",
      name: "Chained Example",
      server: "192.0.2.20",
      port: 8080,
      password: pass,
      via: choice,
    });
    resources.push(chained);
    routes.unshift(
      ...defineRoutes({ when: match.domain("choice.example"), to: choice }),
      ...defineRoutes({ when: match.network("tcp"), to: chained }),
    );
    if (s.engine === "surge") {
      const mesh = surge.tailscale({
        id: "named-mesh",
        name: "Mesh Example",
        sectionName: "NamedMesh",
        hostname: "example-device",
        authKey: fixtureSecrets.TEST_AUTH,
      });
      resources.push(mesh);
      routes.unshift(...defineRoutes({ when: match.domain("mesh.example"), to: mesh }));
    }
    if (s.engine === "sing-box" && s.mode === "standalone") {
      const mesh = singbox.tailscale({
        id: "named-mesh",
        name: "Mesh Example",
        hostname: "example-device",
        stateDirectory: "/var/lib/example-named-mesh",
        acceptRoutes: true,
        bootstrapResolver: "192.0.2.53",
      });
      resources.push(mesh);
      routes.unshift(...defineRoutes({ when: match.domain("mesh.example"), to: mesh }));
    }
  }
  if (s.scene === "logical-single")
    routes.push(
      ...defineRoutes({
        when: [
          match.all(match.ipCidr("192.0.2.0/24")),
          match.any(match.domain("single.example")),
          match.not(match.all(match.port(443))),
        ],
        to: outbound.direct,
      }),
    );
  if (s.scene === "udp-reject" || s.scene === "udp-direct") {
    const http = proxy.http({ id: "http", server: "192.0.2.30", port: 8080, password: pass });
    resources.push(http);
    const mixed = defineProxyGroup({
      id: "mixed",
      algorithm: group.select(),
      members: [nodes[0]!, http],
    });
    groups.push(mixed);
    const reject = s.scene === "udp-reject";
    routes.push(
      ...defineRoutes({
        when: reject ? match.domain("udp.example") : match.network("tcp"),
        to: http,
      }),
    );
    routes.push(
      ...defineRoutes({
        when: reject ? match.domain("mixed.example") : match.network("tcp"),
        to: mixed,
      }),
    );
  }
  if (s.scene === "conditions") {
    const conditions: ProfileCondition[] = [
      match.domain("one.example"),
      match.domainSuffix("two.example"),
      match.ipCidr("192.0.2.0/24"),
      match.ipCidr("2001:db8::/32"),
      match.port(80),
      match.network("udp"),
      match.all(match.domain("three.example"), match.not(match.port(443))),
      match.any(match.port(123), match.port(456)),
    ];
    if (s.engine !== "stash")
      conditions.push(
        match.sourceIp("192.0.2.21"),
        match.sourcePort(2000, 2005),
        match.port(4000, 4010),
      );
    if (s.platform !== "ios") conditions.push(match.processName("example-app"));
    if (s.engine === "surge")
      conditions.push(surge.match.ipAsn(64512, { noResolve: true }) as never);
    routes.push(...defineRoutes({ when: conditions, to: outbound.direct }));
  }
  if (s.scene === "rulesets") {
    const when = ruleSet({
      id: "external",
      surge: { url: "https://rules.example.com/list.txt", intervalSeconds: 86400 },
      singBox: {
        url: "https://rules.example.com/list.json",
        format: "source",
        intervalSeconds: 86400,
      },
      mihomo: {
        url: "https://rules.example.com/list.yaml",
        format: "yaml",
        behavior: "domain",
        intervalSeconds: 86400,
      },
    });
    routes.unshift(...defineRoutes({ when: when as never, to: outbound.direct }));
  }
  if (s.engine === "surge") {
    extensions = {
      surge: {
        general: {
          loglevel: "notify",
          "dns-server": ["192.0.2.53"],
          ...(s.scene === "udp-reject" || s.scene === "udp-direct"
            ? {
                "udp-policy-not-supported-behaviour":
                  s.scene === "udp-reject" ? "REJECT" : "DIRECT",
              }
            : {}),
        },
      },
    };
    if (s.scene === "tunnel") {
      resources.push(
        surge.tailscale({
          id: "tunnel",
          sectionName: "ExampleMesh",
          authKey: secret("TEST_AUTH"),
          hostname: "test-device",
        }),
        surge.wireguard({
          id: "wireguard",
          sectionName: "ExampleWire",
          privateKey: secret("TEST_KEY"),
          selfIp: "192.0.2.2",
          peers: [
            {
              publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              endpoint: "edge.example.com:51820",
              allowedIps: ["192.0.2.0/24"],
              presharedKey: secret("TEST_KEY"),
              persistentKeepalive: 25,
            },
          ],
        }),
      );
      routes.unshift(
        ...defineRoutes({ when: match.domain("mesh.example"), to: resources[1] as never }),
        ...defineRoutes({ when: match.domain("wire.example"), to: resources[2] as never }),
      );
    }
  } else if (s.engine === "sing-box") {
    extensions = {
      singBox: {
        mode: s.mode,
        ...(s.mode === "standalone" ? { listener: { port: 16900, resolver: "192.0.2.53" } } : {}),
      },
    };
    if (s.scene === "tunnel") {
      const ep = singbox.tailscale({
        id: "mesh",
        hostname: "test-device",
        stateDirectory: "/var/lib/example-mesh",
        acceptRoutes: true,
        bootstrapResolver: "192.0.2.53",
        authKey: secret("TEST_AUTH"),
      });
      resources.push(ep);
      routes.unshift(...defineRoutes({ when: match.domain("mesh.example"), to: ep }));
    }
    if (s.scene.startsWith("tailscale-")) {
      const endpoint = singbox.tailscale({
        id: "mesh",
        ...(s.scene === "tailscale-relative-state" ? {} : { name: "Example Mesh" }),
        hostname: "fixture-mesh",
        stateDirectory: `identities/${s.platform}-${s.scene === "tailscale-relative-state" ? "mesh" : s.scene.slice("tailscale-".length)}`,
        acceptRoutes: true,
        bootstrapResolver: "192.0.2.53",
      });
      resources.push(endpoint);
      if (s.scene === "tailscale-selector") {
        const selector = defineProxyGroup({
          id: "home",
          algorithm: group.select(),
          members: [endpoint, outbound.direct],
        });
        groups.push(selector);
        routes.unshift(...defineRoutes({ when: match.domain("mesh.example"), to: selector }));
      } else {
        routes.unshift(...defineRoutes({ when: match.domain("mesh.example"), to: endpoint }));
      }
      if (s.scene === "tailscale-dns")
        extensions.dns = dnsRule(["*.mesh.example", "corp.example"], {
          endpoint,
          acceptDefaultResolvers: true,
        });
    }
    if (s.scene === "modern")
      Object.assign(extensions.singBox as object, {
        domainMatching: "prefer-sniffed",
        serverAliases: { "proxy.example.com": "192.0.2.10" },
        unsupportedUdp: "reject",
        ...(s.mode === "standalone" ? { cacheFile: true } : {}),
      });
    if (s.scene === "tun")
      Object.assign(extensions.singBox as object, {
        tun: {
          address: ["192.0.2.1/24", "2001:db8::1/64"],
          stack: "mixed",
          autoRoute: true,
          strictRoute: true,
          dnsMode: "hijack",
          routeExcludeAddress: ["192.0.2.128/25"],
        },
        listener: { port: 16900, resolver: "2001:db8:1::53" },
      });
  } else if (s.engine === "mihomo")
    extensions = {
      mihomo: {
        mode: s.mode,
        ...(s.mode === "standalone" ? { listener: { port: 16900, resolver: "192.0.2.53" } } : {}),
      },
    };
  const rulesetBootstrap =
    s.scene === "rulesets" && s.engine === "sing-box" && s.mode === "standalone";
  if (rulesetBootstrap) Object.assign(extensions.singBox as object, { cacheFile: true });
  return {
    target: { engine: s.engine, platform: s.platform, version: s.version },
    proxies: resources,
    groups,
    routes,
    fallback: s.scene === "udp-reject" ? groups.find((g) => g.id === "mixed") : nodes[0],
    ...(s.scene === "dns" || rulesetBootstrap
      ? {
          dns: [
            { pattern: "api.example.com", server: "192.0.2.54" },
            { pattern: "*.corp.example", server: "https://dns.example.com/dns-query" },
          ],
        }
      : {}),
    ...extensions,
  } as unknown as ProfileDefinition;
}
export const scenarioProfile = (s: Scenario): Profile => defineProfile(scenarioDefinition(s));
