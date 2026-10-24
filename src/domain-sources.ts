// @concord-file
// @concord-implements docs/feature/target-compilation/domain-sources.md
import { z } from "zod";
import type { DomainSource } from "./types.js";

const order = ["destination", "tlsSni", "httpHost"] as const;
export const domainSourcesSchema = z
  .array(z.enum(order))
  .min(1)
  .max(3)
  .refine((sources) => new Set(sources).size === sources.length);

export function supportsDomainSources(
  sources: readonly DomainSource[] | undefined,
  engine: string,
): boolean {
  return (
    sources === undefined ||
    (sources.length === 1 && sources[0] === "destination") ||
    (engine === "surge" && sources.length === 3)
  );
}
export function extendedDomainSources(sources: readonly DomainSource[] | undefined): boolean {
  return sources?.length === 3;
}
/** Identity only: preserve author snapshots and all non-source options. */
export function domainIdentityFields(value: object): [string, unknown][] {
  return Object.entries(value)
    .map(([key, field]): [string, unknown] => {
      if (key !== "sources" || field === undefined) return [key, field];
      const sources = field as readonly DomainSource[];
      return [
        key,
        sources.length === 1 && sources[0] === "destination"
          ? undefined
          : order.filter((source) => sources.includes(source)),
      ];
    })
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
}
