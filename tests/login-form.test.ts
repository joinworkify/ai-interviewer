// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LoginForm } from "@/components/login-form";

const { signInWithPassword, push, state } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  push: vi.fn(),
  state: { search: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));
vi.mock("@/components/social-auth-buttons", () => ({ SocialAuthButtons: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  state.search = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function emailInput() {
  return container.querySelector<HTMLInputElement>('input[type="email"]')!;
}

function passwordInput() {
  return container.querySelector<HTMLInputElement>('input[type="password"]')!;
}

function submitButton() {
  return container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
}

async function submit(email = "candidate@example.test", password = "test-only-password") {
  await act(async () => root.render(createElement(LoginForm)));
  await act(async () => {
    for (const [input, value] of [
      [emailInput(), email],
      [passwordInput(), password],
    ] as const) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

describe("login form after a successful sign-in", () => {
  it("clears the fields and the spinner so a later visit starts fresh", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { app_metadata: { role: "candidate" } } },
      error: null,
    });
    await submit();

    expect(push).toHaveBeenCalledWith("/candidate/roles");
    expect(emailInput().value).toBe("");
    expect(passwordInput().value).toBe("");
    expect(submitButton().disabled).toBe(false);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("sends admins to the dashboard and still clears the password", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { app_metadata: { role: "admin" } } },
      error: null,
    });
    await submit();

    expect(push).toHaveBeenCalledWith("/admin");
    expect(passwordInput().value).toBe("");
  });

  it("honours a safe next path", async () => {
    state.search = "next=%2Fcandidate%2Fprofile";
    signInWithPassword.mockResolvedValue({
      data: { user: { app_metadata: {} } },
      error: null,
    });
    await submit();

    expect(push).toHaveBeenCalledWith("/candidate/profile");
  });
});

describe("login form after a failed sign-in", () => {
  it("keeps the values, re-enables the button and shows the error", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });
    await submit("candidate@example.test", "wrong-password");

    expect(push).not.toHaveBeenCalled();
    expect(emailInput().value).toBe("candidate@example.test");
    expect(passwordInput().value).toBe("wrong-password");
    expect(submitButton().disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "wrong email or password",
    );
  });
});
