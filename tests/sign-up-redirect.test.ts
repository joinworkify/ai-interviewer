// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SignUpForm } from "@/components/sign-up-form";

const { signUp, push, state } = vi.hoisted(() => ({
  signUp: vi.fn(), push: vi.fn(), state: { next: "/candidate/resume?role=engineer" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams({ next: state.next }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signUp } }) }));
vi.mock("@/components/social-auth-buttons", () => ({ SocialAuthButtons: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  state.next = "/candidate/resume?role=engineer";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function submit() {
  await act(async () => root.render(createElement(SignUpForm)));
  await act(async () => {
    for (const input of container.querySelectorAll("input")) {
      const value = input.type === "email" ? "candidate@example.test" : "test-only-password";
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
describe("sign-up continuation", () => {
  it("follows the role continuation immediately when sign-up returns a session", async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: "test-only" } }, error: null });
    await submit();
    expect(push).toHaveBeenCalledWith(state.next);
    expect(container.querySelector('a[href^="/auth/login"]')?.getAttribute("href")).toBe(`/auth/login?next=${encodeURIComponent(state.next)}`);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/..//evil.example"])("rejects unsafe next=%s for both session and email redirects", async (next) => {
    state.next = next;
    signUp.mockResolvedValue({ data: { session: { access_token: "test-only" } }, error: null });
    await submit();
    expect(push).toHaveBeenCalledWith("/candidate/roles");
    const callback = new URL(signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.origin).toBe(window.location.origin);
    expect(callback.searchParams.get("next")).toBe("/candidate/roles");
  });

  it("sends email confirmations through the session-exchanging callback before the protected next page", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    await submit();
    expect(signUp).toHaveBeenCalledTimes(1);
    const callback = new URL(signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.origin).toBe(window.location.origin);
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe(state.next);
    expect(push).toHaveBeenCalledWith("/auth/sign-up-success");
  });
});
