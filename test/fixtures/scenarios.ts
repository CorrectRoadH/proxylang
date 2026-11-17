import {
  defineProfile,
  defineProxyGroup,
  defineRoutes as routeBatch,
  group,
  match,
  outbound,
  proxy,
  secret,
  singbox,
  surge,
  type ProfileDefinition,
  type Profile,
  type ProfileCondition,
  type ProfileDestination,
} from "proxylang";

const defineRoutes = (input: {
  when: ProfileCondition | readonly ProfileCondition[];
  to: ProfileDestination;
}) =>
  routeBatch({
    ...input,
    when: Array.isArray(input.when) ? input.when : [input.when],
  } as Parameters<typeof routeBatch>[0]);

export const validationValue = (token: { name: string }): string =>
  token.name === "TEST_UUID"
    ? "11111111-2222-4333-8444-555555555555"
    : token.name === "TEST_KEY"
      ? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
      : "test-only";
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
  ["surge", "6.10.0", ["macos"], ["standalone"]],
  ["surge", "5.21.0", ["ios"], ["standalone"]],
  ["sing-box", "1.12.0", ["macos", "linux"], ["standalone", "fragment"]],
  ["sing-box", "1.14.4", ["macos", "linux"], ["standalone", "fragment"]],
  ["mihomo", "1.19.32", ["macos", "linux"], ["standalone", "fragment"]],
  ["stash", "4.2.1", ["macos"], ["fragment"]],
] as const)
  for (const platform of platforms)
    for (const mode of modes) {
      const scenes = ["protocols", "groups", "chain", "conditions"];
      if (engine !== "stash") scenes.push("rulesets");
      if (engine === "surge" || (engine === "sing-box" && mode === "standalone"))
        scenes.push("dns", "tunnel");
      if (engine === "sing-box" && version === "1.14.4") {
        scenes.push("modern");
        if (mode === "standalone") scenes.push("tun");
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
      ...(
        [
          "vmess",
          ...(s.engine === "sing-box" || s.engine === "mihomo" ? (["vless"] as const) : []),
        ] as const
      ).flatMap((type) =>
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
      proxy.http({ id: "chained", server: "192.0.2.20", port: 8080, password: pass, via: "edge" }),
    );
    routes.push(...defineRoutes({ when: match.network("tcp"), to: resources[1] as never }));
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
    const when =
      s.engine === "surge"
        ? surge.ruleSet({
            id: "external",
            url: "https://rules.example.com/list.txt",
            intervalSeconds: 86400,
          })
        : s.engine === "sing-box"
          ? singbox.ruleSet({
              id: "external",
              url: "https://rules.example.com/list.json",
              format: "source",
              intervalSeconds: 86400,
            })
          : {
              type: "nativeRuleSet",
              engine: "mihomo",
              id: "external",
              url: "https://rules.example.com/list.yaml",
              format: "yaml",
              behavior: "domain",
              intervalSeconds: 86400,
            };
    routes.unshift(...defineRoutes({ when: when as never, to: outbound.direct }));
  }
  if (s.engine === "surge") {
    extensions = { surge: { general: { loglevel: "notify", "dns-server": ["192.0.2.53"] } } };
    if (s.scene === "tunnel") {
      resources.push(
        {
          id: "tunnel",
          type: "tailscale",
          sectionName: "ExampleMesh",
          authKey: secret("TEST_AUTH"),
          hostname: "test-device",
        },
        {
          id: "wireguard",
          type: "wireguard",
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
        },
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
  return {
    target: { engine: s.engine, platform: s.platform, version: s.version },
    proxies: resources,
    groups,
    routes,
    fallback: nodes[0],
    ...(s.scene === "dns"
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
