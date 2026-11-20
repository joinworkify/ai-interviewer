import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { describeError } from "@/lib/log/safe-error";

import { createEmailSender } from "./email";
import { stageNotice } from "./inbox";
import { createSupabaseInboxWriter } from "./inbox-store";
import { notifyStage, type NotifyStage } from "./review-notify";
import { createSupabaseNotifyStore } from "./store";

/**
 * Tells a candidate about a stage of one application: an in-app notice
 * always, plus an email when `email` is true and a provider is configured.
 * Both are deduplicated (one per session and stage). Never throws: a
 * notification problem must not affect the thing that triggered it.
 */
export async function announceStage(sessionId: string, stage: NotifyStage, options: { email: boolean }): Promise<void> {
  try {
    const db = createAdminClient();
    const store = createSupabaseNotifyStore(db);
    const target = await store.load(sessionId);
    if (!target) return;
    const notice = stageNotice(stage, target.roleTitle);
    await createSupabaseInboxWriter(db).add({ userId: target.userId, kind: stage, sessionId, ...notice });
    if (options.email) {
      const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
      await notifyStage({
        store,
        send: createEmailSender(process.env),
        sessionId,
        stage,
        link: origin ? `${origin}/candidate/applications` : null,
      });
    }
  } catch (err) {
    console.error("[notify] announce failed", describeError(err));
  }
}
