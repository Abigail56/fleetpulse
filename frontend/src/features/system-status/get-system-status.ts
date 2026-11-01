export type SystemStatusResult =
  | { state: "ready" | "not_ready"; checks: Record<string, string> }
  | { state: "unreachable" };

const REQUEST_TIMEOUT_MS = 3000;

function isReadinessBody(
  body: unknown,
): body is { status: "ready" | "not_ready"; checks: Record<string, string> } {
  if (typeof body !== "object" || body === null) return false;
  const { status, checks } = body as { status?: unknown; checks?: unknown };
  return (
    (status === "ready" || status === "not_ready") &&
    typeof checks === "object" &&
    checks !== null
  );
}

export async function getSystemStatus(
  baseUrl = process.env.API_BASE_URL,
): Promise<SystemStatusResult> {
  if (!baseUrl) {
    console.error("system_status_failed: API_BASE_URL is not set");
    return { state: "unreachable" };
  }
  try {
    const response = await fetch(`${baseUrl}/api/v1/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json();
    if (!isReadinessBody(body)) {
      console.error("system_status_failed: unexpected response shape");
      return { state: "unreachable" };
    }
    return { state: body.status, checks: body.checks };
  } catch (error) {
    console.error("system_status_failed:", error);
    return { state: "unreachable" };
  }
}
