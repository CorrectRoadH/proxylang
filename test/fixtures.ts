import {
  direct,
  secret,
  type Config,
  type Entry,
  type Program,
  type TrojanNode,
} from "../src/index.js";

export const trojan: TrojanNode = {
  id: "edge",
  type: "trojan",
  server: "192.0.2.1",
  port: 443,
  password: secret("TEST_PASSWORD"),
  serverName: "edge.example",
};
export function fixture(routing: readonly Entry[] = [], overrides: Partial<Program> = {}): Config {
  return {
    programs: {
      home: {
        engine: "sing-box",
        nodes: [trojan],
        groups: [],
        routing,
        fallback: direct(),
        ...overrides,
      },
    },
    targets: [
      { id: "box", program: "home", engine: "sing-box", version: "1.12.0", platform: "linux" },
    ],
  };
}
export function dual(config: Config): Config {
  return {
    ...config,
    programs: { ...config.programs, mac: { ...config.programs.home!, engine: "surge" } },
    targets: [
      ...config.targets,
      { id: "mac", program: "mac", engine: "surge", version: "6.10.0", platform: "macos" },
    ],
  };
}
