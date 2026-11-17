import {
  defineBuild,
  defineProfile,
  defineProxyGroup,
  defineRoutes,
  match,
  outbound,
  proxy,
  secret,
  group,
  type ProxyNode,
  type DnsRule,
} from "proxylang";
// @feature docs/feature/profile/library/README.md
const edge: ProxyNode = proxy.trojan({
  id: "edge",
  server: "192.0.2.1",
  port: 443,
  password: secret("TEST_PASSWORD"),
});
const choice = defineProxyGroup({
  id: "choice",
  name: "Choice",
  algorithm: group.select(),
  members: [edge],
});
const dns: DnsRule = { pattern: "example.com", server: "192.0.2.53" };
defineBuild({
  profiles: {
    laptop: defineProfile({
      target: { engine: "surge", platform: "macos", version: "6.10.0" },
      proxies: [edge],
      groups: [choice],
      routes: defineRoutes({ when: [match.domain("example.com")], to: choice }),
      dns: [dns],
      fallback: outbound.direct,
    }),
  },
});
proxy.http({
  id: "invalid",
  server: "192.0.2.1",
  port: 443,
  password: secret("TEST_PASSWORD"),
  // @ts-expect-error protocol fields are precise
  uuid: secret("TEST_UUID"),
});
// @ts-expect-error removed public pipeline
import { compile, render, defineRoute, defineConfig, policy, strategy } from "proxylang";
// @ts-expect-error secrets never accept raw strings as passwords
proxy.trojan({ id: "invalid", server: "192.0.2.1", port: 443, password: "TEST_PASSWORD" });
proxy.trojan({
  id: "invalid",
  server: "192.0.2.1",
  port: 443,
  password: secret("TEST_PASSWORD"),
  // @ts-expect-error application metadata is not protocol data
  region: "TEST",
});

void [compile, render, defineRoute, defineConfig, policy, strategy];
