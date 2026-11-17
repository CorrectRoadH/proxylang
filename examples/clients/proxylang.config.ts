import {
  defineBuild,
  defineProfile,
  defineRoutes,
  proxy,
  secret,
  secrets,
  match,
  outbound,
} from "proxylang";
const edge = proxy.trojan({
  id: "edge",
  server: "192.0.2.10",
  port: 443,
  password: secret("TEST_PASSWORD"),
});
export default defineBuild({
  outDir: "generated",
  profiles: {
    example: defineProfile({
      target: { engine: "stash", version: "4.2.1", platform: "macos" },
      proxies: [edge],
      groups: [],
      routes: defineRoutes({ when: [match.domainSuffix("example.com")], to: edge }),
      fallback: outbound.direct,
    }),
  },
  secrets: secrets({
    values: { TEST_PASSWORD: "test-only" },
    validation: { TEST_PASSWORD: "test-only" },
  }),
});
