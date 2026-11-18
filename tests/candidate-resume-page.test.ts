// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import CandidateResumePage from "@/app/candidate/resume/page";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  fetchSavedResumes: vi.fn(),
  saveProfile: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: mocks.select }),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("role=software-engineer"),
}));

vi.mock("@/components/candidate/step-gate", () => ({
  StepGate: ({ children }: { children: import("react").ReactNode }) => children,
}));

vi.mock("@/lib/candidate/resume-client", () => ({
  deleteResume: vi.fn(),
  fetchSavedResumes: mocks.fetchSavedResumes,
  ResumeUploadError: class extends Error {},
  selectResume: vi.fn(),
  uploadResume: vi.fn(),
}));

vi.mock("@/lib/candidate/profile-client", () => ({
  ProfileSaveError: class extends Error {},
  saveProfile: mocks.saveProfile,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "candidate-1", user_metadata: { name: "Account Name" } } },
    error: null,
  });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.fetchSavedResumes.mockResolvedValue([]);
  mocks.saveProfile.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderPage() {
  await act(async () => {
    root.render(createElement(CandidateResumePage));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("candidate resume step profile prefill", () => {
  it("fills saved name, phone, and LinkedIn details after login", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        name: "Saved Candidate",
        phone: "+95 912-345-678",
        linkedin_url: "https://www.linkedin.com/in/candidate",
        portfolio_url: "https://portfolio.example",
      },
      error: null,
    });

    await renderPage();

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Full name"]')?.value).toBe(
      "Saved Candidate",
    );
    expect(container.querySelector<HTMLInputElement>('input[type="tel"]')?.value).toBe("912345678");
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain("+95");
    expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
      "https://www.linkedin.com/in/candidate",
    );
    expect(mocks.select).toHaveBeenCalledWith("name, phone, linkedin_url, portfolio_url");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    expect(mocks.saveProfile).toHaveBeenCalledWith({
      name: "Saved Candidate",
      phone: "+95912345678",
      linkedinUrl: "https://www.linkedin.com/in/candidate",
    });
  });

  it("uses the signed-in account name when no profile name is saved", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { name: null, phone: null, linkedin_url: null, portfolio_url: null },
      error: null,
    });

    await renderPage();

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Full name"]')?.value).toBe(
      "Account Name",
    );
  });
});
