import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAuthState } from "@/lib/api/client";

import { AcceptInvitation } from "./accept-invitation";
import { AuthGuard } from "./auth-guard";
import { CURRENT_USER_KEY } from "./api";
import { describeUserAgent } from "./describe-user-agent";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";
import { ResetPasswordForm } from "./reset-password-form";
import { SessionList } from "./session-list";
import { errorResponse, jsonResponse, renderWithQuery } from "./test-utils";
import { VerifyEmailForm } from "./verify-email-form";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  params: new URLSearchParams(),
}));

const sessionChange = vi.hoisted(() => ({ changeSession: vi.fn() }));

vi.mock("@/lib/session-change", () => sessionChange);

// It makes its own request, and has its own tests.
vi.mock("./google-button", () => ({ GoogleButton: () => null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
  usePathname: () => "/account",
}));

function mockFetch(...responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

const AUTH_BODY = {
  user: { id: "1", email: "ada@example.com", full_name: "Ada" },
  csrf_token: "csrf",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
  navigation.replace.mockReset();
  navigation.params = new URLSearchParams();
  clearAuthState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function submitLogin(user: ReturnType<typeof userEvent.setup>, password = "the-password") {
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
  it("validates before calling the API", async () => {
    const mock = mockFetch();
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Please enter a valid email address.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it("goes to the account page and caches the user", async () => {
    mockFetch(jsonResponse(200, AUTH_BODY));
    const user = userEvent.setup();
    const { client } = renderWithQuery(<LoginForm />);
    await submitLogin(user);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/dashboard"));
    expect(client.getQueryData(CURRENT_USER_KEY)).toEqual(AUTH_BODY.user);
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("follows a safe next path but ignores one to another site", async () => {
    navigation.params = new URLSearchParams({ next: "https://evil.example.com" });
    mockFetch(jsonResponse(200, AUTH_BODY));
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await submitLogin(user);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows the API's generic message for wrong details", async () => {
    mockFetch(errorResponse(401, "invalid_credentials", "Incorrect email or password."));
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await submitLogin(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("explains a failed Google sign-in", () => {
    navigation.params = new URLSearchParams({ error: "google_failed" });
    renderWithQuery(<LoginForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't sign you in with Google");
  });

  it("ignores an unknown error value rather than displaying it", () => {
    navigation.params = new URLSearchParams({ error: "<b>your account is hacked</b>" });
    renderWithQuery(<LoginForm />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers to resend the email when the address isn't verified", async () => {
    const mock = mockFetch(
      errorResponse(403, "email_not_verified", "Please verify your email address first."),
      jsonResponse(202),
    );
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await submitLogin(user);
    await user.click(await screen.findByRole("button", { name: "Send a new verification email" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/new email is on its way/);
    expect(String(mock.mock.calls[1][0])).toContain("/auth/resend-verification");
  });

  it("explains being rate limited", async () => {
    mockFetch(errorResponse(429, "too_many_requests", "Too many attempts. Please try again later."));
    const user = userEvent.setup();
    renderWithQuery(<LoginForm />);
    await submitLogin(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});

describe("RegisterForm", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, password: string) {
    await user.type(screen.getByLabelText("Your name"), "Ada");
    await user.type(screen.getByLabelText("Work email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), password);
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("rejects a short password without calling the API", async () => {
    const mock = mockFetch();
    const user = userEvent.setup();
    renderWithQuery(<RegisterForm />);
    await fill(user, "short");
    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it("shows the same confirmation whether or not the address is taken", async () => {
    mockFetch(jsonResponse(202));
    const user = userEvent.setup();
    renderWithQuery(<RegisterForm />);
    await fill(user, "a-long-enough-passphrase");
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
  });

  it("puts the API's weak password message on the password field", async () => {
    mockFetch(errorResponse(400, "weak_password", "This password is too easy to guess."));
    const user = userEvent.setup();
    renderWithQuery(<RegisterForm />);
    await fill(user, "a-long-enough-passphrase");
    expect(await screen.findByText("This password is too easy to guess.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("one-time link pages", () => {
  it("removes the token from the address bar", async () => {
    window.history.pushState(null, "", "/account?token=secret");
    navigation.params = new URLSearchParams({ token: "secret" });
    renderWithQuery(<VerifyEmailForm />);
    expect(window.location.search).toBe("");
    window.history.pushState(null, "", "/");
  });

  it("explains an incomplete link", () => {
    renderWithQuery(<VerifyEmailForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("incomplete");
  });

  it("verifying sends the token and the password", async () => {
    navigation.params = new URLSearchParams({ token: "secret" });
    const mock = mockFetch(jsonResponse(200));
    const user = userEvent.setup();
    renderWithQuery(<VerifyEmailForm />);
    await user.type(screen.getByLabelText("Password"), "the-password");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByText("Your email address is verified.")).toBeInTheDocument();
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({
      token: "secret",
      password: "the-password",
    });
  });

  it("reset requires the two passwords to match", async () => {
    navigation.params = new URLSearchParams({ token: "secret" });
    const mock = mockFetch();
    const user = userEvent.setup();
    renderWithQuery(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "a-long-enough-passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "something-else-entirely");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });

  it("offers a new link when a reset link has expired", async () => {
    navigation.params = new URLSearchParams({ token: "secret" });
    mockFetch(errorResponse(400, "invalid_token", "This link is invalid or has expired."));
    const user = userEvent.setup();
    renderWithQuery(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "a-long-enough-passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a-long-enough-passphrase");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("link", { name: "Request a new reset link" })).toBeInTheDocument();
  });
});

describe("AcceptInvitation", () => {
  it("asks a signed-out visitor to sign in, keeping the invitation", async () => {
    navigation.params = new URLSearchParams({ token: "abc" });
    mockFetch(errorResponse(401, "not_authenticated"), errorResponse(401, "invalid_session"));
    renderWithQuery(<AcceptInvitation />);
    const link = await screen.findByRole("link", { name: "Sign in to accept" });
    expect(link.getAttribute("href")).toContain(encodeURIComponent("token=abc"));
  });

  it("does nothing until the signed-in user confirms", async () => {
    navigation.params = new URLSearchParams({ token: "abc" });
    const mock = mockFetch(jsonResponse(200, AUTH_BODY), jsonResponse(200, { name: "Swift" }));
    const user = userEvent.setup();
    renderWithQuery(<AcceptInvitation />);
    const accept = await screen.findByRole("button", { name: "Accept invitation" });
    expect(mock).toHaveBeenCalledTimes(1);
    await user.click(accept);
    await waitFor(() => expect(sessionChange.changeSession).toHaveBeenCalledWith("/dashboard"));
    expect(String(mock.mock.calls[1][0])).toContain("/invitations/accept");
  });

  it("shows why an invitation can't be used", async () => {
    navigation.params = new URLSearchParams({ token: "abc" });
    mockFetch(
      jsonResponse(200, AUTH_BODY),
      errorResponse(400, "invalid_invitation", "This invitation is invalid or has expired."),
    );
    const user = userEvent.setup();
    renderWithQuery(<AcceptInvitation />);
    await user.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or has expired");
  });
});

describe("AuthGuard", () => {
  it("shows loading, then the content for a signed-in user", async () => {
    mockFetch(jsonResponse(200, AUTH_BODY));
    renderWithQuery(<AuthGuard>secret content</AuthGuard>);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(await screen.findByText("secret content")).toBeInTheDocument();
  });

  it("redirects a signed-out visitor without showing the content", async () => {
    mockFetch(errorResponse(401, "not_authenticated"), errorResponse(401, "invalid_session"));
    renderWithQuery(<AuthGuard>secret content</AuthGuard>);
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/account")}`),
    );
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("offers a retry when the API is down, rather than signing the user out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("down")));
    renderWithQuery(<AuthGuard>secret content</AuthGuard>);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("SessionList", () => {
  const SESSIONS = [
    {
      id: "current",
      user_agent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0 Safari/537",
      created_at: "2026-10-01T00:00:00Z",
      last_active_at: "2026-10-01T00:00:00Z",
      expires_at: "2027-10-01T00:00:00Z",
      is_current: true,
    },
    {
      id: "other",
      user_agent: "Mozilla/5.0 (iPhone) Safari/604",
      created_at: "2026-10-01T00:00:00Z",
      last_active_at: "2026-10-01T00:00:00Z",
      expires_at: "2027-10-01T00:00:00Z",
      is_current: false,
    },
  ];

  it("lists sessions and needs confirmation before signing one out", async () => {
    const mock = mockFetch(
      jsonResponse(200, SESSIONS),
      jsonResponse(200, AUTH_BODY),
      jsonResponse(204),
      jsonResponse(200, [SESSIONS[0]]),
    );
    const user = userEvent.setup();
    renderWithQuery(<SessionList />);
    expect(await screen.findByText("Safari on iOS")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Sign out" })[1]);
    expect(mock).toHaveBeenCalledTimes(1);

    const dialog = await screen.findByRole("dialog");
    await user.click(dialog.querySelector(".btn-primary") as HTMLElement);
    await waitFor(() => expect(screen.queryByText("Safari on iOS")).not.toBeInTheDocument());
    expect(String(mock.mock.calls[2][0])).toContain("/auth/sessions/other");
  });

  it("shows an error with a retry", async () => {
    mockFetch(errorResponse(500, "server_error", "Something failed."));
    renderWithQuery(<SessionList />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something failed.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("describeUserAgent", () => {
  it.each([
    [null, "Unknown device"],
    ["curl/8.0", "Unknown device"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120", "Edge on Windows"],
    ["Mozilla/5.0 (Macintosh; Mac OS X 10_15) Version/17 Safari/605", "Safari on macOS"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/120 Safari/537", "Chrome on Android"],
  ])("%s", (agent, expected) => {
    expect(describeUserAgent(agent)).toBe(expected);
  });
});
