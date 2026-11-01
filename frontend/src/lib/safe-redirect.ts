const DEFAULT_PATH = "/dashboard";

/** Only ever returns a path on this site, so a crafted login link can't send users elsewhere. */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s\p{Cc}]/u.test(next)) {
    return DEFAULT_PATH;
  }
  try {
    const url = new URL(next, "http://internal.invalid");
    return url.origin === "http://internal.invalid" ? next : DEFAULT_PATH;
  } catch {
    return DEFAULT_PATH;
  }
}
