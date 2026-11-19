// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import RoleDetailPage from "@/app/candidate/roles/[id]/page";

const { getUser, push } = vi.hoisted(() => ({ getUser: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "engineer" }),
  useRouter: () => ({ push }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser } }) }));
vi.mock("@/lib/candidate/api", () => ({
  getRole: async () => ({ id: "engineer", title: "Engineer", payMin: 10, payMax: 15, payType: "hour", skills: [], responsibilities: [], requirements: [] }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
function applyButton() {
  return Array.from(container.querySelectorAll("button")).find((button) => /Apply|Opening/.test(button.textContent ?? ""))!;
}
beforeEach(async () => {
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RoleDetailPage)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
describe("public role Apply", () => {
  it("copies the public role URL without requiring sign-in", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const share = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Share")!;
    await act(async () => share.click());
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(share.textContent).toContain("Copied");
    expect(getUser).not.toHaveBeenCalled();
    expect(applyButton()).toBeDefined();
  });

  it("reports clipboard failures while retaining the Apply action", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const share = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Share")!;
    await act(async () => share.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to copy link");
    expect(applyButton().disabled).toBe(false);
  });
  it.each([true, false])("routes an authenticated=%s visitor to the appropriate entry point", async (signedIn) => {
    getUser.mockResolvedValue({ data: { user: signedIn ? { id: "candidate" } : null }, error: null });
    await act(async () => applyButton().click());
    expect(push).toHaveBeenCalledWith(signedIn
      ? "/candidate/resume?role=engineer"
      : "/auth/login?next=%2Fcandidate%2Fresume%3Frole%3Dengineer");
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("recovers when navigation throws", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "candidate" } }, error: null });
    push.mockImplementationOnce(() => { throw new Error("Navigation failed"); });
    await act(async () => applyButton().click());
    expect(applyButton().disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/try again/i);
  });

  it("allows retry after an auth lookup rejects without removing the role", async () => {
    getUser.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => applyButton().click());
    expect(applyButton()?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/try again/i);
    expect(container.querySelector("h1")?.textContent).toBe("Engineer");
    expect(push).not.toHaveBeenCalled();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await act(async () => applyButton().click());
    expect(push).toHaveBeenCalledWith("/auth/login?next=%2Fcandidate%2Fresume%3Frole%3Dengineer");
  });
});
