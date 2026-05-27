import type { ModAnchorActionReview } from '../../shared/api';

const normalizeUserDisplay = (username: string) =>
  username.startsWith('u/') ? username : `u/${username}`;

const formatActionLabel = (actionType: string) =>
  actionType.replaceAll('_', ' ');

const buildTargetSummary = (review: ModAnchorActionReview): string => {
  if (review.targetType === 'user') {
    const username =
      typeof review.metadata?.targetUsername === 'string'
        ? review.metadata.targetUsername
        : review.targetUsername ?? review.targetId ?? 'unknown';
    return `Target user: ${normalizeUserDisplay(String(username))}`;
  }
  if (review.targetType === 'post') {
    const title = typeof review.metadata?.title === 'string' ? review.metadata.title : undefined;
    const author = typeof review.metadata?.authorName === 'string' ? review.metadata.authorName : undefined;
    return `Target post: ${title ?? review.targetId ?? 'unknown'}${author ? ` · ${normalizeUserDisplay(author)}` : ''}`;
  }
  const snippet = typeof review.metadata?.bodySnippet === 'string' ? review.metadata.bodySnippet : undefined;
  const author = typeof review.metadata?.authorName === 'string' ? review.metadata.authorName : undefined;
  const parentPostTitle =
    typeof review.metadata?.parentPostTitle === 'string' ? review.metadata.parentPostTitle : undefined;
  return `Target comment: ${snippet ?? review.targetId ?? 'unknown'}${author ? ` · ${normalizeUserDisplay(author)}` : ''}${parentPostTitle ? ` · Parent post: ${parentPostTitle}` : ''}`;
};

export const applyMonitoringNotification = async (
  review: ModAnchorActionReview,
  options: {
    subreddit: string;
    nowIso?: string;
    createConversation: (input: {
      subredditName: string;
      subject: string;
      body: string;
      to: null;
      isAuthorHidden: boolean;
    }) => Promise<unknown>;
  }
): Promise<ModAnchorActionReview> => {
  if (review.executionStatus !== 'executed_monitored') {
    return { ...review, modmailDeliveryStatus: review.modmailDeliveryStatus ?? 'not_required' };
  }
  if (review.modmailDeliveryStatus === 'sent') return review;
  if ((review.reportMode ?? 'per_action') === 'daily_digest') {
    return { ...review, modmailDeliveryStatus: 'pending', modmailDeliveredAt: undefined, modmailDeliveryError: undefined };
  }
  try {
    const subject = `ModAnchor monitored action: ${formatActionLabel(review.actionType)} by ${normalizeUserDisplay(review.actorUsername)}`;
    const targetSummary = buildTargetSummary(review);
    const permalink = typeof review.metadata?.permalink === 'string' ? review.metadata.permalink : undefined;
    const body = [
      'ModAnchor monitored action',
      '',
      `Moderator: ${normalizeUserDisplay(review.actorUsername)}`,
      `Action: ${formatActionLabel(review.actionType)}`,
      targetSummary,
      `Reason: ${review.reason?.trim() ? review.reason : 'No reason provided'}`,
      'Review phase: Monitoring',
      'Execution status: Executed through ModAnchor',
      `Timestamp: ${options.nowIso ?? new Date().toISOString()}`,
      ...(permalink ? [`Link: ${permalink}`] : []),
      '',
      'This action was executed during ModAnchor Monitoring phase.',
    ].join('\n');
    await options.createConversation({
      subredditName: options.subreddit,
      subject,
      body,
      to: null,
      isAuthorHidden: true,
    });
    return {
      ...review,
      modmailDeliveryStatus: 'sent',
      modmailDeliveredAt: options.nowIso ?? new Date().toISOString(),
      modmailDeliveryError: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'modmail delivery failed';
    console.warn('[modanchor] monitoring modmail failed', {
      reviewId: review.id,
      actorUsername: review.actorUsername,
      actionType: review.actionType,
      targetType: review.targetType,
      targetId: review.targetId,
      error: message,
    });
    return {
      ...review,
      modmailDeliveryStatus: 'failed',
      modmailDeliveredAt: undefined,
      modmailDeliveryError: message,
    };
  }
};

