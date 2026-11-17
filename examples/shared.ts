import { defineRoutes, match, outbound, ruleSet, type Exit, type RouteCase } from "proxylang";
// One source object selects the appropriate native branch for each target.
export const exampleRules = ruleSet({
  id: "example-sites",
  surge: { url: "https://rules.example.com/domains.txt", format: "domain-set" },
  singBox: {
    url: "https://rules.example.com/domains.json",
    format: "source",
    intervalSeconds: 86400,
  },
  mihomo: {
    url: "https://rules.example.com/domains.yaml",
    format: "yaml",
    behavior: "domain",
    intervalSeconds: 86400,
  },
});
export const sharedRoutes = (exit: Exit, includeExternalRuleSets = true) => [
  defineRoutes({ when: match.domainSuffix("example.com"), to: exit }),
  ...(includeExternalRuleSets ? [defineRoutes({ when: exampleRules, to: exit })] : []),
];
export const sharedCases = (exit: Exit, includeExternalRuleSets = true): readonly RouteCase[] => [
  {
    name: "example domain uses the shared exit",
    request: { domain: "www.example.com" },
    expect: exit,
  },
  ...(includeExternalRuleSets
    ? [
        {
          name: "external rule-set hit uses the shared exit",
          request: { domain: "service.example" },
          assume: { hit: [exampleRules] },
          expect: exit,
        },
        {
          name: "external rule-set miss falls back to direct",
          request: { domain: "other.example" },
          assume: { miss: [exampleRules] },
          expect: outbound.direct,
        },
      ]
    : [
        {
          name: "unmatched domain falls back to direct",
          request: { domain: "other.example" },
          expect: outbound.direct,
        },
      ]),
];
