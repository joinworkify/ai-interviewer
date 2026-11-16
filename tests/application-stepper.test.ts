// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = { pathname: "/candidate/setup", search: "role=software-engineer&attempt=abc" };
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { ApplicationStepper } = await import("@/components/candidate/application-stepper");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function links() {
  return [...container.querySelectorAll("ol a")].map((a) => a.getAttribute("href"));
}

describe("ApplicationStepper", () => {
  it("links only the completed steps, keeping the open attempt", () => {
    nav.pathname = "/candidate/setup";
    nav.search = "role=software-engineer&attempt=abc";
    act(() => root.render(createElement(ApplicationStepper)));

    expect(links()).toEqual([
      "/candidate/roles/software-engineer",
      "/candidate/resume?role=software-engineer&attempt=abc",
      "/candidate/consent?role=software-engineer&attempt=abc",
    ]);
    expect(container.querySelector('[aria-current="step"]')?.textContent).toMatch(/Mic check/);
  });

  it("has no links on the first step or after the interview", () => {
    nav.pathname = "/candidate/roles/software-engineer";
    nav.search = "";
    act(() => root.render(createElement(ApplicationStepper)));
    expect(links()).toEqual([]);

    nav.pathname = "/candidate/result";
    nav.search = "attempt=abc";
    act(() => root.render(createElement(ApplicationStepper)));
    expect(links()).toEqual([]);
  });
});
