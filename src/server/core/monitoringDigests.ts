import { reddit } from '@devvit/web/server';
import type { ModAnchorActionReview, ModAnchorMonitoringDigest } from '../../shared/api';

const toUtcDateKey = (date: Date): string => date.toISOString().slice(0, 10);
const toDigestDateFromIso = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const MAX_DIGEST_ACTORS_PER_RUN = 50;
const MAX_DIGEST_ACTIONS_SCANNED = 1000;
const MAX_ACTIONS_PER_DIGEST_DETAIL = 50;
const MAX_DIGEST_BODY_CHARS = 9000;

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
  skippedAlreadySent: number;
  processedActors: number;
  truncated: boolean;
  scannedActions: number;
}> => {
  const { subreddit, digestDateUtc, sendModmail, reviews, existingDigests } = input;
  const actorGroups = new Map<string, ModAnchorActionReview[]>();
  let scannedActions = 0;
  for (const review of reviews) {
    if (scannedActions >= MAX_DIGEST_ACTIONS_SCANNED) break;
    scannedActions += 1;
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
  let skippedAlreadySent = 0;
  let processedActors = 0;
  let truncated = scannedActions >= MAX_DIGEST_ACTIONS_SCANNED;
  const nowIso = new Date().toISOString();
  const actorEntries = [...actorGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_DIGEST_ACTORS_PER_RUN);
  if (actorGroups.size > actorEntries.length) truncated = true;
  for (const [actorKey, actorReviewsRaw] of actorEntries) {
    processedActors += 1;
    const digestId = `${subreddit}:${actorKey}:${digestDateUtc}`;
    const existingIndex = updated.findIndex((digest) => digest.id === digestId);
    const existing = existingIndex >= 0 ? updated[existingIndex] : undefined;
    if (existing?.deliveryStatus === 'sent') {
      skippedAlreadySent += 1;
      continue;
    }
    const actorReviews = [...new Map(actorReviewsRaw.map((item) => [item.id, item])).values()]
      .sort((a, b) => new Date(b.executedAt ?? b.createdAt).getTime() - new Date(a.executedAt ?? a.createdAt).getTime());
    const actionCounts: Record<string, number> = {};
    for (const item of actorReviews) actionCounts[item.actionType] = (actionCounts[item.actionType] ?? 0) + 1;
    const detailItems = actorReviews.slice(0, MAX_ACTIONS_PER_DIGEST_DETAIL);
    const truncatedDetail = actorReviews.length > detailItems.length;
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
        const actionDetailLines = detailItems
          .map((item) => `- ${new Date(item.executedAt ?? item.createdAt).toISOString()} · ${item.actionType} · ${item.targetType}:${item.targetId ?? 'n/a'}`)
          .join('\n');
        let body = `ModAnchor daily monitoring digest (UTC)\n\nModerator: u/${actorKey}\nDate: ${digestDateUtc} UTC\nTotal monitored actions: ${actorReviews.length}\n\nAction breakdown:\n${lines}\n\nRecent action details (latest ${detailItems.length}${truncatedDetail ? ` of ${actorReviews.length}` : ''}):\n${actionDetailLines}\n${truncatedDetail ? `\nDigest truncated: showing latest ${detailItems.length} of ${actorReviews.length} monitored actions.` : ''}\n\nThis digest includes ModAnchor actions performed during Monitoring phase.`;
        if (body.length > MAX_DIGEST_BODY_CHARS) {
          body = `ModAnchor daily monitoring digest (UTC)\n\nModerator: u/${actorKey}\nDate: ${digestDateUtc} UTC\nTotal monitored actions: ${actorReviews.length}\n\nAction breakdown:\n${lines}\n\nDigest truncated for size limits.`;
          truncated = true;
        }
        await reddit.modMail.createConversation({
          subredditName: subreddit,
          subject: `ModAnchor daily digest: u/${actorKey} — ${digestDateUtc} UTC`,
          body,
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
  return { digests: updated, generated, sent, failed, skippedAlreadySent, processedActors, truncated, scannedActions };
};
