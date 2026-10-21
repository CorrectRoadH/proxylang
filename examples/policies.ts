import { block, direct, match as m, policy, reject, rule, sequence, slot } from "proxylang";

// Conditions are data: reuse the same set in multiple policies without copying actions.
export const homeDomains = m.any(m.domainSuffix("home.example"), m.domainSuffix("nas.example"));
export const aiDomains = m.any(m.domainSuffix("openai.com"), m.domainSuffix("anthropic.com"));

export const homePolicy = policy({
  id: "home-routing",
  exits: ["proxy", "ai", "dev", "residential"] as const,
  rules: sequence(
    block("work-before-block", [rule("lark", m.domainSuffix("larksuite.com"), slot("proxy"))]),
    // Broad block deliberately overlaps the work exception: order is observable in cases.
    block("distractions", [
      rule(
        "blocked",
        m.any(m.domainSuffix("social.example"), m.domainSuffix("larksuite.com")),
        reject(),
      ),
    ]),
    block("lan", [
      rule("private-ip", m.any(m.ipCidr("192.168.0.0/16"), m.ipCidr("fd00::/8")), direct()),
    ]),
    block("home", [rule("services", homeDomains, direct())]),
    block("ai", [rule("services", aiDomains, slot("ai"))]),
    block(
      "ssh",
      [rule("github", m.all(m.domain("github.com"), m.port(22)), slot("proxy"))],
      m.network("tcp"),
    ),
    block(
      "residential",
      [rule("service", m.domain("residential.example"), slot("residential"))],
      m.network("tcp"),
    ),
    block("custom", [
      rule("steam-store", m.domain("store.steampowered.com"), slot("proxy")),
      rule("steam-download", m.domainSuffix("steampowered.com"), direct()),
      rule("tracker-web", m.domain("www.tracker.example"), slot("proxy")),
      rule("tracker", m.domainSuffix("tracker.example"), direct()),
    ]),
    block("dev", [rule("device", m.sourceIp("192.168.0.42/32"), slot("dev"))]),
  ),
});
