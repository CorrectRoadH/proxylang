// @concord-file
// @concord-implements docs/feature/targets/README.md#诊断
import { register } from "./identity.js";
import type { Profile, Exit } from "./profile-types.js";
import type { InspectedProfile } from "./inspect-profile.js";
// This view is only for collecting independent target errors. No plan or routing
// model produced from it may escape an invalid preparation.
export function diagnosticView(profile: Profile, inspected: InspectedProfile): Profile {
  const diagnosticSecret = register(
    { type: "env" as const, name: "TEST_DIAGNOSTIC_ONLY" },
    "secret",
  );
  const surge = profile.target.engine === "surge";
  const destination = (exit: Exit) =>
    !surge && "builtin" in exit && !["DIRECT", "REJECT"].includes(exit.builtin)
      ? { builtin: "DIRECT" }
      : exit;
  const proxies = profile.proxies.map((resource) => {
    if (
      (surge && resource.type === "sing-box-tailscale") ||
      (!surge && ["tailscale", "wireguard"].includes(resource.type))
    )
      return {
        type: "trojan",
        id: resource.id,
        server: "192.0.2.1",
        port: 443,
        password: diagnosticSecret,
      };
    return resource;
  });
  const groups = profile.groups.map((resource) => {
    const unsupported = surge
      ? resource.algorithm.type === "urltest"
      : resource.algorithm.type === "surge-smart" ||
        (profile.target.engine === "stash" && resource.algorithm.type !== "select");
    const algorithm = unsupported ? { type: "select" } : resource.algorithm;
    const { surge: options, ...rest } = resource;
    return {
      ...rest,
      algorithm,
      members: resource.members.map(destination),
      ...(surge && algorithm.type === "select" && options ? { surge: options } : {}),
    };
  });
  const stripName = <T extends { readonly id: string; readonly name?: string }>(resource: T) => {
    const { name: _name, ...rest } = resource;
    return rest;
  };
  return {
    ...profile,
    proxies: proxies.map(stripName),
    groups: groups.map(stripName),
    routes: inspected.rules.map((r) => ({ ...r, to: destination(r.to) })),
    fallback: destination(profile.fallback),
  } as unknown as Profile;
}
