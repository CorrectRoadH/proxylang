import ipaddr from "ipaddr.js";
import { isIP } from "node:net";
import type { Program } from "./types.js";

export function validTunAddresses(addresses: readonly string[]): boolean {
  const families = new Set<string>();
  try {
    for (const value of addresses) {
      const [address, prefix] = ipaddr.parseCIDR(value);
      const family = address.kind();
      const bits = family === "ipv4" ? 32 : 128;
      if (families.has(family) || prefix > bits - 2) return false;
      families.add(family);
      const numeric = address
        .toByteArray()
        .reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
      const mask = (1n << BigInt(bits - prefix)) - 1n;
      if ((numeric & mask) === mask) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function unsafeTunResolvers(
  program: Pick<Program, "tun" | "listener" | "dns" | "endpoints">,
): readonly string[] {
  if (!program.tun) return [];
  const networks = program.tun.address.map((value) => ipaddr.parseCIDR(value));
  const resolvers = [
    ...(program.listener ? [program.listener.resolver] : []),
    ...(program.dns ?? []).map((rule) =>
      isIP(rule.server) ? rule.server : new URL(rule.server).hostname.replace(/^\[|\]$/g, ""),
    ),
    ...(program.endpoints ?? []).map((endpoint) => endpoint.bootstrapResolver),
  ];
  return resolvers.filter((value) => {
    if (!isIP(value)) return false;
    const address = ipaddr.process(value);
    return (
      ["loopback", "unspecified"].includes(address.range()) ||
      networks.some(
        ([network, prefix]) => address.kind() === network.kind() && address.match(network, prefix),
      )
    );
  });
}
