// @concord-file
// @concord-implements docs/feature/routing-cases/library.md#routerequest
import { z } from "zod";
import { isIP } from "node:net";
import { inspectDefinition, ProfileDefinitionError } from "../model/definitions.js";
import { processNameSchema } from "../model/schema.js";
import type { RouteRequest } from "../model/routing-types.js";
const domain = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const ip = z.string().refine((v) => isIP(v) !== 0 && !v.includes("%"));
const port = z.number().int().min(1).max(65535);
const schema = z.strictObject({
  network: z.enum(["tcp", "udp"]).optional(),
  domain: domain.optional(),
  sniffedDomain: domain.optional(),
  ip: ip.optional(),
  resolvedIp: ip.optional(),
  asn: z.number().int().min(1).max(4294967295).optional(),
  port: port.optional(),
  sourceIp: ip.optional(),
  sourcePort: port.optional(),
  processName: processNameSchema.optional(),
  macAddress: z
    .string()
    .regex(/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i)
    .optional(),
});
export function parseRequest(input: RouteRequest): RouteRequest {
  try {
    inspectDefinition(input);
  } catch {
    throw new ProfileDefinitionError("INVALID_REQUEST", ["request"]);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new ProfileDefinitionError(
      "INVALID_REQUEST",
      parsed.error.issues.flatMap((i) =>
        i.code === "unrecognized_keys" ? i.keys : i.path.length ? [i.path.join(".")] : ["request"],
      ),
    );
  if (parsed.data.ip !== undefined && parsed.data.resolvedIp !== undefined)
    throw new ProfileDefinitionError("INVALID_REQUEST", ["ip", "resolvedIp"]);
  return Object.freeze({ ...parsed.data, network: parsed.data.network ?? "tcp" });
}
