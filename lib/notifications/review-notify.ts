import { notifiableStage } from "@/lib/candidate/stage";
import type { ReviewStatus } from "@/lib/admin/access";

import type { EmailMessage, SendEmail } from "./email";

/**
 * Emails a candidate when a reviewer moves their application to a new stage
 * (in review, accepted, not selected). At most one email per session and
 * stage: the stage is claimed in the database first, so flipping a status back
 * and forth never repeats a message. If the send fails the claim is released
 * so a later attempt can retry. Only the stage is ever mentioned: no score,
 * notes or reviewer details.
 */

export interface NotifyTarget {
  userId: string;
  email: string;
  name: string | null;
  roleTitle: string | null;
}

/** Every stage that can be emailed or shown in the inbox. */
export type NotifyStage = NonNullable<ReturnType<typeof notifiableStage>> | "received" | "unfinished";

export interface NotifyStore {
  load(sessionId: string): Promise<NotifyTarget | null>;
  /** Records the stage as notified; false when it already was. */
  claim(sessionId: string, stage: NotifyStage): Promise<boolean>;
  release(sessionId: string, stage: NotifyStage): Promise<void>;
}

export type NotifyOutcome = "sent" | "already_sent" | "skipped" | "failed";

export function composeStageEmail(
  stage: NotifyStage,
  target: Pick<NotifyTarget, "name" | "roleTitle">,
  link: string | null,
): Omit<EmailMessage, "to"> {
  const hello = target.name?.trim() ? `Hi ${target.name.trim()},` : "Hello,";
  const role = target.roleTitle ? ` for ${target.roleTitle}` : "";
  const status = link ? `\n\nYou can follow your application any time: ${link}` : "";
  const body: Record<NotifyStage, { subject: string; lines: string[] }> = {
    received: {
      subject: `We received your DataSea interview`,
      lines: [`Thank you for completing your interview${role}. A person at DataSea will review it and we will email you when its status changes.`],
    },
    unfinished: {
      subject: `Finish your DataSea application`,
      lines: [`You started an interview${role} but it was not finished. You can try again whenever you are ready, with a quiet place and about 20 minutes.`],
    },
    in_review: {
      subject: `Your DataSea application is in review`,
      lines: [`A person at DataSea has started reviewing your interview${role}. We will be in touch when there is a decision.`],
    },
    accepted: {
      subject: `Good news about your DataSea application`,
      lines: [`Congratulations, your application${role} was accepted. DataSea will contact you soon with the next steps.`],
    },
    not_selected: {
      subject: `An update on your DataSea application`,
      lines: [
        `Thank you for taking the time to interview${role}. After review, DataSea has decided not to move forward with this application.`,
        `We appreciate your effort and encourage you to apply for other roles.`,
      ],
    },
  };
  const { subject, lines } = body[stage];
  return { subject, text: `${hello}\n\n${lines.join("\n\n")}${status}\n\nThe DataSea team` };
}

/** Emails a candidate about one stage, once per session and stage. */
export async function notifyStage(args: {
  store: NotifyStore;
  send: SendEmail | null;
  sessionId: string;
  stage: NotifyStage;
  /** Absolute URL of the candidate's applications page, when the app origin is known. */
  link: string | null;
}): Promise<NotifyOutcome> {
  if (!args.send) return "skipped";
  const target = await args.store.load(args.sessionId);
  if (!target?.email) return "skipped";

  if (!(await args.store.claim(args.sessionId, args.stage))) return "already_sent";
  const message = composeStageEmail(args.stage, target, args.link);
  const ok = await args.send({ to: target.email, ...message });
  if (!ok) {
    await args.store.release(args.sessionId, args.stage);
    return "failed";
  }
  return "sent";
}

/** Emails the candidate when a reviewer moves their application to a new status. */
export async function notifyCandidate(args: {
  store: NotifyStore;
  send: SendEmail | null;
  sessionId: string;
  status: ReviewStatus;
  link: string | null;
}): Promise<NotifyOutcome> {
  const stage = notifiableStage(args.status);
  if (!stage) return "skipped";
  return notifyStage({ store: args.store, send: args.send, sessionId: args.sessionId, stage, link: args.link });
}
