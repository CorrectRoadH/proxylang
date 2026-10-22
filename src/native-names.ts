// @concord-file
// @concord-implements docs/feature/target-compilation/use-case/provider-nodes.md
import { z } from "zod";
import type { Engine } from "./types.js";

export const nativeNameSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      value.trim() === value &&
      !/[\p{C}\p{Zl}\p{Zp},=[\]()#;]/u.test(value) &&
      !["DIRECT", "REJECT"].includes(value.toUpperCase()) &&
      !value.toLowerCase().startsWith("pl-"),
  );

export function isReservedNativeName(name: string, engine: Engine): boolean {
  const reserved =
    engine === "surge"
      ? ["REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"]
      : engine === "mihomo"
        ? ["GLOBAL", "PASS", "COMPATIBLE", "REJECT-DROP", "PASS-RULE"]
        : engine === "stash"
          ? ["GLOBAL", "PASS", "COMPATIBLE", "REJECT-DROP"]
          : [];
  return reserved.includes(name.toUpperCase());
}
