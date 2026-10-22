import {
  defineConfig,
  direct,
  match,
  mihomo,
  policy,
  reject,
  rule,
  ruleSet,
  singbox,
  slot,
  surge,
  use,
  type Match,
  type Program,
} from "../src/index.js";

// Each caller provides its own native capability. The language composes conditions;
// it neither downloads these resources nor claims the three files are equivalent.
function mediaPolicy(external: Match) {
  const media = ruleSet({
    id: "media",
    when: match.any(external, match.domainSuffix("video.example")),
  });
  return policy({
    id: "media-policy",
    exits: ["media"],
    rules: [rule("media-tcp", match.all(match.network("tcp"), media), slot("media"))],
  });
}
function program(engine: Program["engine"], external: Match): Program {
  return {
    engine,
    nodes: [],
    groups: [],
    routing: [
      rule("local", match.domainSuffix("local.example"), direct()),
      use(mediaPolicy(external), { id: "media", bindings: { media: direct() } }),
    ],
    fallback: reject(),
  };
}
export default defineConfig({
  programs: {
    apple: program(
      "surge",
      surge.ruleSet({
        id: "streaming",
        url: "https://example.com/streaming.list",
        // Nested Surge references retain the client's default update interval.
      }),
    ),
    box: program(
      "sing-box",
      singbox.ruleSet({
        id: "streaming",
        url: "https://example.com/streaming.srs",
        format: "binary",
        intervalSeconds: 21600,
      }),
    ),
    meta: program(
      "mihomo",
      mihomo.ruleProvider({
        id: "streaming",
        url: "https://example.com/streaming.yaml",
        behavior: "classical",
        format: "yaml",
        intervalSeconds: 21600,
      }),
    ),
  },
  targets: [
    { id: "apple", program: "apple", engine: "surge", platform: "macos", version: "6.10.0" },
    { id: "box", program: "box", engine: "sing-box", platform: "linux", version: "1.12.0" },
    { id: "meta", program: "meta", engine: "mihomo", platform: "linux", version: "1.19.32" },
  ],
  cases: [
    {
      id: "local",
      program: "box",
      request: { network: "tcp", domain: "local.example" },
      expect: { rule: "box/local", action: direct() },
    },
  ],
});
