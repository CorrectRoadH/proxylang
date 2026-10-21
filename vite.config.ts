import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: { ignorePatterns: ["docs/**", "memory/**", "AGENTS.md", "concord.config.ts"] },
  lint: {
    ignorePatterns: ["docs/**", "memory/**", "concord.config.ts"],
    options: { typeAware: true, typeCheck: true },
    // Rule.then is declarative data, never a callable Promise handler.
    rules: { "unicorn/no-thenable": "off" },
  },
  test: { include: ["test/*.test.ts"], testTimeout: 15000 },
  pack: {
    entry: ["src/index.ts", "src/cli.ts"],
    format: "esm",
    platform: "node",
    dts: true,
    // Preserve the existing ESM package entry points (.js and .d.ts).
    fixedExtension: false,
    clean: true,
  },
});
