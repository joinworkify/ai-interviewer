import type { EmailMessage } from "./email";

/** Confirmation and reminder emails for a booked interview time. Times are shown in UTC with a note, since the server does not know the candidate's time zone. */

export interface BookingEmailInput {
  name: string | null;
  roleTitle: string | null;
  startsAt: Date;
  /** Absolute URL of the role or applications page, when the app origin is known. */
  link: string | null;
}

function when(d: Date): string {
  return `${d.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

export function composeBookingEmail(kind: "confirmation" | "reminder", input: BookingEmailInput): Omit<EmailMessage, "to"> {
  const hello = input.name?.trim() ? `Hi ${input.name.trim()},` : "Hello,";
  const role = input.roleTitle ? ` for ${input.roleTitle}` : "";
  const link = input.link ? `\n\nOpen it here: ${input.link}` : "";
  const lines =
    kind === "confirmation"
      ? [`You booked your DataSea interview${role} for ${when(input.startsAt)}.`, "Find a quiet place, check your microphone and speaker, and allow about 20 minutes. You can cancel or change the time from your applications page."]
      : [`A reminder: your DataSea interview${role} is coming up at ${when(input.startsAt)}.`, "Find a quiet place and check your microphone and speaker before you start."];
  return {
    subject: kind === "confirmation" ? "Your DataSea interview is booked" : "Your DataSea interview is coming up",
    text: `${hello}\n\n${lines.join("\n\n")}${link}\n\nThe DataSea team`,
  };
}
