import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  "format": "concord.project/v1",
  "projectId": "b5c3ff29-d31c-41b9-8286-d3eb7a4cc3df",
  "testRoots": [
    "test"
  ],
  "sourceRoots": [
    "src"
  ],
  "runner": {
    "kind": "command",
    "argv": [
      "vp",
      "run",
      "check"
    ],
    "sourceFiles": [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.check.json",
      "vite.config.ts",
      "src/types.ts",
      "src/dsl.ts",
      "src/schema.ts",
      "src/rules.ts",
      "src/rulesets.ts",
      "src/compiler.ts",
      "src/strategies.ts",
      "src/targets.ts",
      "src/render.ts",
      "src/clash.ts",
      "src/proxies.ts",
      "src/host.ts",
      "src/cli.ts",
      "src/index.ts",
      "test/fixtures.ts",
      "test/rules.test.ts",
      "test/type-contracts.ts",
      "test/rulesets.test.ts",
      "test/compiler.test.ts",
      "test/strategies.test.ts",
      "test/host.test.ts",
      "test/native.test.ts",
      "test/clash.test.ts",
      "test/proxies.test.ts",
      "test/proxy-fixtures.ts",
      "examples/home/{proxylang}.config.ts",
      "examples/clients/{proxylang}.config.ts",
      "examples/proxies/{proxylang}.config.ts",
      "examples/rule-sets/{proxylang}.config.ts",
      "examples/policies.ts"
    ],
    "timeoutMs": 120000
  },
  "projectTypes": [
    "library",
    "cli"
  ],
  "documentDefaults": {
    "featurePages": [],
    "roadmapPages": [],
    "designPages": []
  },
  "constitution": {
    "path": "docs/constitution.md"
  },
  "memorySources": [
    {
      "name": "project",
      "provider": "local-files",
      "path": "memory",
      "access": "read-write",
      "defaultWrite": true
    }
  ]
} as const satisfies ProjectConfig;
