import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactForm } from "./contact-form";

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Your name"), "Ada Obi");
  await user.type(screen.getByLabelText("Work email"), "ada@example.com");
  await user.type(
    screen.getByLabelText("How can we help?"),
    "We run thirty vans and want to know more.",
  );
}

function mockResponse(status: number) {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ContactForm", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows field errors linked to their inputs, and doesn't send", async () => {
    const fetchMock = mockResponse(202);
    const user = userEvent.setup();
    render(<ContactForm />);
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Please enter your name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Your name")).toHaveAttribute(
      "aria-describedby",
      "name-error",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the message and shows confirmation", async () => {
    const fetchMock = mockResponse(202);
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText(/Your message has been sent/)).toBeInTheDocument();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/api/v1/contact");
    expect(JSON.parse(options.body)).toMatchObject({
      name: "Ada Obi",
      email: "ada@example.com",
      company: null,
      fleet_size: null,
    });
  });

  it("keeps the text and explains when sending fails", async () => {
    mockResponse(503);
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't send/);
    expect(screen.getByLabelText("Your name")).toHaveValue("Ada Obi");
  });

  it("explains rate limiting separately", async () => {
    mockResponse(429);
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again later/);
  });

  it("handles a network failure without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't send/),
    );
  });

  it("disables the button while sending, preventing double submission", async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
    );
    const user = userEvent.setup();
    render(<ContactForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    finish(new Response("{}", { status: 202 }));
    expect(await screen.findByText(/Your message has been sent/)).toBeInTheDocument();
  });
});
