// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { PasswordInput } from "@/components/ui/password-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("PasswordInput", () => {
  it("hides the password until the eye button is pressed, and hides it again on a second press", () => {
    act(() => root.render(createElement(PasswordInput, { id: "password", defaultValue: "secret" })));
    const input = container.querySelector("input")!;
    const button = container.querySelector("button")!;

    expect(input.type).toBe("password");
    expect(input.id).toBe("password");
    expect(button.getAttribute("aria-label")).toBe("Show password");

    act(() => button.click());
    expect(input.type).toBe("text");
    expect(button.getAttribute("aria-label")).toBe("Hide password");

    act(() => button.click());
    expect(input.type).toBe("password");
  });

  it("does not submit the form it sits in", () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    act(() => root.render(createElement("form", null, createElement(PasswordInput, { id: "p" }))));
    container.querySelector("form")!.addEventListener("submit", onSubmit);

    act(() => container.querySelector("button")!.click());
    expect(container.querySelector("button")!.type).toBe("button");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
