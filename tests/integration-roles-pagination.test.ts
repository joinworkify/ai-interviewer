// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import RolesPage from "@/app/candidate/roles/page";

vi.mock("@/lib/candidate/api", () => ({
  getRoles: async () => Array.from({ length: 15 }, (_, i) => ({ id: `role-${i}`, title: `Role ${i}`, payRate: "$10/hour", skills: [], about: "" })),
  filterRoles: (roles: { title: string }[], query: string) => roles.filter((role) => role.title.includes(query)),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RolesPage)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("retains themed role cards while paginating all fifteen roles", async () => {
  expect(container.querySelectorAll("ul.grid > li")).toHaveLength(14);
  expect(container.querySelector("ul.grid > li span.font-heading")).not.toBeNull();
  await act(async () => (container.querySelector('[aria-label="Go to page 2"]') as HTMLElement).click());
  expect(container.querySelectorAll("ul.grid > li")).toHaveLength(1);
  expect(container.textContent).toContain("Role 14");
  expect(container.textContent).toContain("Showing 15–15 of 15 roles");
});
it("searching from page two returns to the first page of matching results", async () => {
  await act(async () => (container.querySelector('[aria-label="Go to page 2"]') as HTMLElement).click());
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Role 0");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll("ul.grid > li")).toHaveLength(1);
  expect(container.textContent).toContain("Role 0");
  expect(container.textContent).toContain("Showing 1–1 of 1 roles");
});
