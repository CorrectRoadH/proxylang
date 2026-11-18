// @concord-file
// @concord-implements docs/feature/profile/library/README.md#引用规则
import type { Profile, ProfileDestination, DeepReadonly } from "./profile-types.js";
import type {
  Action,
  ConcreteGroup,
  Match,
  NormalizedProfile,
  ProxyNode,
  TailscaleEndpoint,
} from "./types.js";
import { exactDefinition, ProfileDefinitionError, snapshotDefinition } from "./definitions.js";
import {
  deepFreeze,
  nodeSchema,
  endpointSchema,
  matchSchema,
  engineOptionsSchema,
} from "./schema.js";
const fail = (code: string): never => {
  throw new ProfileDefinitionError(code);
};
export function normalizeProfile(profile: Profile): NormalizedProfile {
  const byId = new Map<string, object>();
  for (const resource of [...profile.proxies, ...profile.groups]) {
    if (!resource || typeof resource.id !== "string") fail("INVALID_RESOURCE_DEFINITION");
    byId.set(resource.id, resource);
  }
  const destination = (value: DeepReadonly<ProfileDestination>): Action => {
    if (!value || typeof value !== "object") return fail("INVALID_DESTINATION");
    if ("builtin" in value) {
      exactDefinition(value, ["builtin"]);
      if (value.builtin === "DIRECT") return { type: "direct" };
      if (value.builtin === "REJECT") return { type: "reject" };
      return fail("PROFILE_DESTINATION_UNSUPPORTED");
    }
    return { type: "route", to: value.id };
  };
  const algorithm = (group: Profile["groups"][number]): ConcreteGroup => {
    exactDefinition(group, ["type", "id", "name", "algorithm", "members", "surge"]);
    if (group.type !== "proxy-group" || !group.members.length) fail("INVALID_GROUP_DEFINITION");
    const a = group.algorithm;
    exactDefinition(
      a,
      a.type === "urltest" ? ["type", "url", "intervalSeconds", "toleranceMs"] : ["type"],
    );
    const members = group.members.map((m) => {
      const x = destination(m);
      return x.type === "route" ? x.to : x.type === "direct" ? "DIRECT" : "REJECT";
    });
    if (a.type === "auto")
      return {
        id: group.id,
        members,
        type: "urltest",
        url: "https://www.gstatic.com/generate_204",
        intervalSeconds: 180,
        toleranceMs: 50,
      };
    if (a.type === "urltest") {
      let url: URL;
      try {
        url = new URL(a.url);
      } catch {
        return fail("INVALID_GROUP_DEFINITION");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        !Number.isInteger(a.intervalSeconds ?? 180) ||
        (a.intervalSeconds ?? 180) < 1 ||
        (a.intervalSeconds ?? 180) > 86400 ||
        !Number.isInteger(a.toleranceMs ?? 50) ||
        (a.toleranceMs ?? 50) < 0 ||
        (a.toleranceMs ?? 50) > 60000
      )
        fail("INVALID_GROUP_DEFINITION");
    }
    return { ...a, id: group.id, members } as ConcreteGroup;
  };
  const nodes: ProxyNode[] = [],
    endpoints: TailscaleEndpoint[] = [];
  for (const item of profile.proxies) {
    if (item.type === "sing-box-tailscale") {
      const { name: _name, ...native } = item;
      const parsed = endpointSchema.safeParse(native);
      if (!parsed.success) fail("INVALID_RESOURCE_DEFINITION");
      endpoints.push(parsed.data!);
    } else {
      const { name: _name, ...native } = item;
      if ("via" in native && native.via) Object.assign(native, { via: native.via.id });
      const parsed = nodeSchema.safeParse(native);
      if (!parsed.success) fail("INVALID_RESOURCE_DEFINITION");
      nodes.push(parsed.data as ProxyNode);
    }
  }
  const extension = profile.target.engine === "sing-box" ? profile.singBox : profile.mihomo;
  const parsedOptions = engineOptionsSchema.safeParse(extension ?? {});
  if (!parsedOptions.success) fail("INVALID_PROFILE_DEFINITION");
  const mode =
    extension?.mode ?? (profile.target.engine === "sing-box" ? "standalone" : "fragment");
  return deepFreeze(
    snapshotDefinition({
      target: { ...profile.target, id: "profile", mode },
      nodes,
      endpoints,
      groups: profile.groups.map(algorithm),
      rules: profile.routes.map((r, i) => {
        exactDefinition(r, ["type", "when", "to"]);
        if (r.type !== "route") fail("INVALID_ROUTE_DEFINITION");
        const when = matchSchema.safeParse(r.when);
        if (!when.success)
          throw new ProfileDefinitionError("PROFILE_CONDITION_UNSUPPORTED", [`routes[${i}].when`]);
        return {
          id: `route-${i + 1}`,
          when: when.data as Match,
          then: destination(r.to),
          origin: [],
        };
      }),
      fallback: destination(profile.fallback),
      ...(profile.dns === undefined
        ? {}
        : {
            dns: profile.dns.map(({ pattern, server }) => ({
              pattern,
              server:
                typeof server === "string" ? server : { ...server, endpoint: server.endpoint.id },
            })),
          }),
      ...extension,
    }),
  ) as NormalizedProfile;
}
