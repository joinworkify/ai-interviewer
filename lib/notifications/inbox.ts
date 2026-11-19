import { STAGE_DESCRIPTIONS, STAGE_LABELS } from "@/lib/candidate/stage";

import type { NotifyStage } from "./review-notify";

/**
 * In-app notifications: what a candidate sees in the bell and on
 * /candidate/notifications. They work without any email provider, and (user,
 * kind, session) is unique so a retried job never shows the same one twice.
 */

export type InboxKind = NotifyStage | "booking" | "booking_reminder";

export interface InboxItem {
  userId: string;
  kind: InboxKind;
  /** Part of the dedupe key; omit for events that are not about one session. */
  sessionId?: string;
  title: string;
  body: string;
  /** Site-relative link (starts with "/"). */
  link: string;
}

export interface InboxWriter {
  /** Stores the item; false when this (user, kind, session) already exists. */
  add(item: InboxItem): Promise<boolean>;
}

export const NIL_SESSION = "00000000-0000-0000-0000-000000000000";

/** The notice for a session stage. Only the stage is ever mentioned, like the email. */
export function stageNotice(stage: NotifyStage, roleTitle: string | null): Pick<InboxItem, "title" | "body" | "link"> {
  const role = roleTitle ? ` for ${roleTitle}` : "";
  const notices: Record<NotifyStage, { title: string; body: string }> = {
    received: { title: "We received your interview", body: `Your interview${role} was submitted. A person at DataSea will review it.` },
    in_review: { title: "Your application is in review", body: STAGE_DESCRIPTIONS.in_review },
    accepted: { title: "Your application was accepted", body: STAGE_DESCRIPTIONS.accepted },
    not_selected: { title: STAGE_LABELS.not_selected, body: STAGE_DESCRIPTIONS.not_selected },
    unfinished: { title: "Finish your application", body: `You started an interview${role} but did not finish. You can try again from your applications.` },
  };
  return { ...notices[stage], link: "/candidate/applications" };
}
