import type { InterviewLevel } from "@/lib/gemini-live/interview-details";

/**
 * What the Dograh agent is told about a candidate's role. Pure and free of
 * server imports, so the live screen (browser) and the attempt route (server)
 * build exactly the same values from a role.
 *
 * The output is passed through validateLiveInterviewBody by the Dograh session
 * route, so a role title or skill with unsupported characters is rejected there
 * rather than reaching the prompt.
 */

export interface RoleLike {
  title: string;
  skills: readonly string[];
}

export interface RoleInterviewDetails {
  role: string;
  level: InterviewLevel;
  techstack: string;
}

/** Roles are not leveled in the data, so infer it from the title. */
export function levelForRole(title: string): InterviewLevel {
  return /\b(senior|expert|lead|principal|staff)\b/i.test(title) ? "senior" : "mid";
}

export function interviewDetailsForRole(role: RoleLike): RoleInterviewDetails {
  return {
    role: role.title,
    level: levelForRole(role.title),
    // The validator allows 8 items; keep the first ones, they are the main skills.
    techstack: role.skills.slice(0, 8).join(", "),
  };
}
