export function extractFunctionApiPath(req: Request, functionName: string): string {
  const pathname = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  const marker = `/functions/v1/${functionName}`;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex >= 0) {
    const relative = pathname.slice(markerIndex + marker.length);
    return relative || "/";
  }
  const shortMarker = `/${functionName}`;
  const shortIndex = pathname.indexOf(shortMarker);
  const relative = shortIndex >= 0 ? pathname.slice(shortIndex + shortMarker.length) : pathname;
  return relative || "/";
}
