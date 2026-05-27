import { reddit } from '@devvit/web/server';
import type { ModAnchorActionReview, ModAnchorMonitoringDigest } from '../../shared/api';

const toUtcDateKey = (date: Date): string => date.toISOString().slice(0, 10);
const toDigestDateFromIso = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

export const getPreviousUtcDateKey = (now: Date): string => {
  const previous = new Date(now);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return toUtcDateKey(previous);
};

const summarizeDigest = (actorUsername: string, digestDateUtc: string, totalActions: number) =>
  `u/${actorUsername} had ${totalActions} monitored ModAnchor actions on ${digestDateUtc} UTC.`;

export const generateMonitoringDigestsForDate = async (input: {
  subreddit: string;
  digestDateUtc: string;
  sendModmail: boolean;
  reviews: ModAnchorActionReview[];
  existingDigests: ModAnchorMonitoringDigest[];
}): Promise<{
  digests: ModAnchorMonitoringDigest[];
  generated: number;
  sent: number;
  failed: number;
}> => {
  const { subreddit, digestDateUtc, sendModmail, reviews, existingDigests } = input;
  const actorGroups = new Map<string, ModAnchorActionReview[]>();
  for (const review of reviews) {
    if (review.executionStatus !== 'executed_monitored') continue;
    if ((review.reportMode ?? 'per_action') !== 'daily_digest') continue;
    if ((review.modmailDeliveryStatus ?? 'pending') === 'sent') continue;
    const actionDate = toDigestDateFromIso(review.executedAt ?? review.createdAt);
    if (actionDate !== digestDateUtc) continue;
    const key = review.actorUsername.toLowerCase();
    const group = actorGroups.get(key) ?? [];
    group.push(review);
    actorGroups.set(key, group);
  }

  const updated = [...existingDigests];
  let generated = 0;
  let sent = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();
  for (const [actorKey, actorReviews] of actorGroups.entries()) {
    const digestId = `${subreddit}:${actorKey}:${digestDateUtc}`;
    const existingIndex = updated.findIndex((digest) => digest.id === digestId);
    const existing = existingIndex >= 0 ? updated[existingIndex] : undefined;
    if (existing?.deliveryStatus === 'sent') continue;
    const actionCounts: Record<string, number> = {};
    for (const item of actorReviews) actionCounts[item.actionType] = (actionCounts[item.actionType] ?? 0) + 1;
    const digest: ModAnchorMonitoringDigest = {
      id: digestId,
      subreddit,
      actorUsername: actorKey,
      reviewAssignmentUsername: actorKey,
      digestDate: digestDateUtc,
      periodStart: `${digestDateUtc}T00:00:00.000Z`,
      periodEnd: `${digestDateUtc}T23:59:59.999Z`,
      actionReviewIds: actorReviews.map((review) => review.id),
      totalActions: actorReviews.length,
      actionCounts,
      summary: summarizeDigest(actorKey, digestDateUtc, actorReviews.length),
      deliveryStatus: existing?.deliveryStatus === 'failed' ? 'failed' : 'pending',
      deliveredAt: existing?.deliveredAt,
      deliveryError: existing?.deliveryError,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    generated += 1;
    if (sendModmail) {
      try {
        const lines = Object.entries(actionCounts).map(([action, count]) => `- ${action}: ${count}`).join('\n');
        await reddit.modMail.createConversation({
          subredditName: subreddit,
          subject: `ModAnchor daily digest: u/${actorKey} — ${digestDateUtc} UTC`,
          body: `ModAnchor daily monitoring digest (UTC)\n\nModerator: u/${actorKey}\nDate: ${digestDateUtc} UTC\nTotal monitored actions: ${actorReviews.length}\n\nAction breakdown:\n${lines}\n\nThis digest includes ModAnchor actions performed during Monitoring phase.`,
          to: null,
          isAuthorHidden: true,
        });
        digest.deliveryStatus = 'sent';
        digest.deliveredAt = nowIso;
        digest.deliveryError = undefined;
        sent += 1;
      } catch (error) {
        digest.deliveryStatus = 'failed';
        digest.deliveryError = error instanceof Error ? error.message : 'modmail delivery failed';
        failed += 1;
      }
    }
    if (existingIndex >= 0) updated[existingIndex] = digest;
    else updated.push(digest);
  }
  return { digests: updated, generated, sent, failed };
};

