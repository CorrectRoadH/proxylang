// @concord-file
// @concord-implements docs/feature/target-compilation/domain-sources.md
/** Identity only: preserve explicit false in author snapshots. */
export function domainIdentityFields(value: object): [string, unknown][] {
  return Object.entries(value)
    .filter(([key, field]) => field !== undefined && !(key === "includeSniffed" && field === false))
    .sort(([a], [b]) => a.localeCompare(b));
}
