// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ResumeProfileForm } from "@/components/candidate/resume-profile-form";
import { saveProfile } from "@/lib/candidate/profile-client";

vi.mock("@/lib/candidate/profile-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/candidate/profile-client")>(),
  saveProfile: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(saveProfile).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(ResumeProfileForm, {
    initialProfile: {
      name: "Candidate",
      email: "candidate@example.com",
      phone: "",
      linkedinUrl: "",
      portfolioUrl: "",
    },
  })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function save() {
  await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
}

describe("ResumeProfileForm success message", () => {
  it("keeps the latest save confirmation visible for its own four seconds", async () => {
    await save();
    act(() => vi.advanceTimersByTime(3000));
    await save();
    expect(saveProfile).toHaveBeenCalledTimes(2);

    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Profile saved successfully.");
    act(() => vi.advanceTimersByTime(2999));
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("cancels the success timeout when the form unmounts", async () => {
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const cancel = vi.spyOn(globalThis, "clearTimeout");
    await save();
    const timerIndex = schedule.mock.calls.findIndex(([, delay]) => delay === 4000);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const timer = schedule.mock.results[timerIndex].value;
    act(() => root.unmount());
    expect(cancel).toHaveBeenCalledWith(timer);
    // Leave a mounted root for the shared teardown.
    root = createRoot(container);
  });
});
