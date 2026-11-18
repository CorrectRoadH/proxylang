export function pathsOverlap(a: string, b: string): boolean {
  if (a.startsWith("/") !== b.startsWith("/")) return false;
  return (
    a === b ||
    a.startsWith(b.endsWith("/") ? b : `${b}/`) ||
    b.startsWith(a.endsWith("/") ? a : `${a}/`)
  );
}
