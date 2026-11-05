export function sameOriginTestBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") return value;
  // NextRequest normalizes loopback URLs to localhost. Navigate there too so
  // browser-generated Origin headers match without rewriting request headers.
  url.hostname = "localhost";
  return url.toString();
}
