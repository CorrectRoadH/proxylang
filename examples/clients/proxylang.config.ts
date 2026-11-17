import {
  defineBuild,
  defineProfile,
  defineRoutes,
  defineProxyGroup,
  group,
  proxy,
  defineSecrets,
  match,
  outbound,
} from "proxylang";
const secrets = defineSecrets({ TEST_PASSWORD: { value: "test-only", validation: "test-only" } });
const edge = proxy.trojan({
  id: "edge",
  name: "Edge Example",
  server: "192.0.2.10",
  port: 443,
  password: secrets.TEST_PASSWORD,
});
const relay = defineProxyGroup({
  id: "relay",
  name: "Relay Example",
  algorithm: group.select(),
  members: [edge],
});
const chained = proxy
  .builder(
    proxy.trojan({
      id: "chained",
      server: "192.0.2.20",
      port: 443,
      password: secrets.TEST_PASSWORD,
    }),
  )
  .via(relay)
  .name("Chained Example")
  .build();
export default defineBuild({
  outDir: "generated",
  profiles: {
    example: defineProfile({
      target: { engine: "stash", version: "4.2.1", platform: "macos" },
      proxies: [edge, chained],
      groups: [relay],
      routes: defineRoutes({ when: [match.domainSuffix("example.com")], to: chained }),
      fallback: outbound.direct,
    }),
  },
  secrets,
});
