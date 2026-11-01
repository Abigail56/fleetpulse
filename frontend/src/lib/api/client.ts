const DOWNLOAD_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 15000;
const REFRESH_CONFLICT_DELAY_MS = 500;
const SAFE_METHODS = new Set(["GET", "HEAD"]);

// Held in memory only, never in browser storage. A reload recovers it from /auth/me.
let csrfToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function clearAuthState() {
  csrfToken = null;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Set false for endpoints that work without a session, such as login. */
  auth?: boolean;
};

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const headers: Record<string, string> = {};
  const isForm = body instanceof FormData;
  // The browser sets a form's content type itself, including its boundary.
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (csrfToken && !SAFE_METHODS.has(method)) headers["X-CSRF-Token"] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "We couldn't reach FleetPulse. Check your connection and try again.",
    );
  }

  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: Partial<ApiError> } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "unexpected_error",
      error?.message ?? "Something went wrong. Please try again.",
      error?.fields ?? [],
    );
  }
  const token = (data as { csrf_token?: unknown } | null)?.csrf_token;
  if (typeof token === "string") csrfToken = token;
  return data as T;
}

/** Shared between simultaneous requests: refreshing twice would look like token theft. */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      await send("/auth/refresh", "POST", undefined);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Another tab has just refreshed, and its response updated the shared cookies.
        await new Promise((resolve) => setTimeout(resolve, REFRESH_CONFLICT_DELAY_MS));
        return true;
      }
      if (error instanceof ApiError && error.status === 401) {
        csrfToken = null;
        return false;
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  if (!auth) return send<T>(path, method, body);

  const attempt = async (): Promise<T> => {
    if (!csrfToken && !SAFE_METHODS.has(method)) {
      await send("/auth/me", "GET", undefined);
    }
    return send<T>(path, method, body);
  };

  try {
    return await attempt();
  } catch (error) {
    if (error instanceof ApiError && error.code === "invalid_csrf_token") {
      csrfToken = null;
      return attempt();
    }
    if (error instanceof ApiError && error.code === "not_authenticated") {
      if (await refreshSession()) return attempt();
    }
    throw error;
  }
}

/** For files. Saves what the API sends, under the name it gives, using the same session handling. */
export async function apiDownload(path: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const fetchFile = () =>
    fetch(`${baseUrl}/api/v1${path}`, {
      credentials: "include",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  let response: Response;
  try {
    response = await fetchFile();
    if (response.status === 401) {
      // Renews an expired session, or sends the person to sign in.
      await api("/auth/me");
      response = await fetchFile();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "network_error", "We couldn't reach FleetPulse. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: Partial<ApiError> } | null;
    throw new ApiError(
      response.status,
      data?.error?.code ?? "unexpected_error",
      data?.error?.message ?? "The file couldn't be downloaded.",
      [],
    );
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name ?? "fleetpulse-download";
  link.click();
  URL.revokeObjectURL(url);
}
