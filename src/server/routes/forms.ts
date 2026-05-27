import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import type { ModAnchorActionReview, ModAnchorActionType, ModAnchorTargetMetadata } from '../../shared/api';
import {
  createPendingModAnchorActionReview,
  getReviewAssignments,
} from '../core/reports';
import { applyMonitoringNotification } from '../core/monitoringNotifications';

type ExampleFormValues = {
  message?: string;
};

export const forms = new Hono();

const getSubreddit = () => context.subredditName ?? 'modanchor_dev';
const normalizeUsername = (value: string) => value.replace(/^\/?u\//i, '').trim().toLowerCase();
const normalizeFormSelectValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  if (value && typeof value === 'object' && 'value' in value) {
    const maybe = (value as { value?: unknown }).value;
    if (typeof maybe === 'string') return maybe;
  }
  return null;
};
const normalizeFormTextValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    const trimmed = value[0].trim();
    return trimmed ? trimmed : undefined;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    const maybe = (value as { value?: unknown }).value;
    if (typeof maybe === 'string') {
      const trimmed = maybe.trim();
      return trimmed ? trimmed : undefined;
    }
  }
  return undefined;
};
const postActionForm = (
  errorMessage?: string,
  defaults?: { action?: string; reason?: string; removalNote?: string; targetId?: string },
  includeRemovalReason = false
) => ({
  title: 'ModAnchor Post Action',
  description: errorMessage,
  acceptLabel: 'Submit',
  cancelLabel: 'Cancel',
  fields: [
    {
      name: 'action',
      label: 'Action',
      type: 'select' as const,
      required: true,
      defaultValue: [defaults?.action ?? 'remove_post'],
      options: [
        { label: 'Approve post', value: 'approve_post' },
        { label: 'Remove post', value: 'remove_post' },
        { label: 'Remove post as spam', value: 'remove_post_spam' },
        { label: 'Lock post', value: 'lock_post' },
        { label: 'Unlock post', value: 'unlock_post' },
        { label: 'Mark NSFW', value: 'mark_nsfw' },
        { label: 'Unmark NSFW', value: 'unmark_nsfw' },
        { label: 'Mark spoiler', value: 'mark_spoiler' },
        { label: 'Unmark spoiler', value: 'unmark_spoiler' },
        { label: 'Set post flair', value: 'set_post_flair' },
      ],
    },
    { name: 'reason', label: 'User note (optional, internal thought process)', type: 'paragraph' as const, required: false, defaultValue: defaults?.reason ?? '' },
    ...(includeRemovalReason
      ? [{ name: 'removalNote', label: 'Moderator removal note (optional)', type: 'paragraph' as const, required: false, defaultValue: defaults?.removalNote ?? '' }]
      : []),
    { name: 'targetId', label: 'Target ID (auto-filled)', type: 'string' as const, required: false, defaultValue: defaults?.targetId ?? '' },
  ],
});
const commentActionForm = (
  errorMessage?: string,
  defaults?: { action?: string; reason?: string; removalNote?: string; targetId?: string },
  includeRemovalReason = false
) => ({
  title: 'ModAnchor Comment Action',
  description: errorMessage,
  acceptLabel: 'Submit',
  cancelLabel: 'Cancel',
  fields: [
    {
      name: 'action',
      label: 'Action',
      type: 'select' as const,
      required: true,
      defaultValue: [defaults?.action ?? 'remove_comment'],
      options: [
        { label: 'Approve comment', value: 'approve_comment' },
        { label: 'Remove comment', value: 'remove_comment' },
        { label: 'Remove comment as spam', value: 'remove_comment_spam' },
        { label: 'Lock comment', value: 'lock_comment' },
        { label: 'Unlock comment', value: 'unlock_comment' },
      ],
    },
    { name: 'reason', label: 'User note (optional, internal thought process)', type: 'paragraph' as const, required: false, defaultValue: defaults?.reason ?? '' },
    ...(includeRemovalReason
      ? [{ name: 'removalNote', label: 'Moderator removal note (optional)', type: 'paragraph' as const, required: false, defaultValue: defaults?.removalNote ?? '' }]
      : []),
    { name: 'targetId', label: 'Target ID (auto-filled)', type: 'string' as const, required: false, defaultValue: defaults?.targetId ?? '' },
  ],
});
const makeSnippet = (value: unknown, maxLength = 180): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
};
const getString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const toAbsoluteRedditUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `https://www.reddit.com${trimmed}`;
  if (trimmed.startsWith('r/')) return `https://www.reddit.com/${trimmed}`;
  return undefined;
};
const captureTargetMetadata = async (
  targetType: 'post' | 'comment',
  targetId: string
): Promise<ModAnchorTargetMetadata | undefined> => {
  try {
    if (targetType === 'post') {
      const post = await reddit.getPostById(targetId as `t3_${string}`);
      const p = post as unknown as Record<string, unknown>;
      return {
        title: getString(p.title),
        bodySnippet: makeSnippet(p.body ?? p.selftext ?? p.text),
        authorName: getString(p.authorName ?? p.authorUsername),
        permalink: toAbsoluteRedditUrl(getString(p.permalink)),
        url: toAbsoluteRedditUrl(getString(p.url)),
      };
    }
    const comment = await reddit.getCommentById(targetId as `t1_${string}`);
    const c = comment as unknown as Record<string, unknown>;
    let parentPostTitle: string | undefined;
    const postId = getString(c.postId);
    if (postId) {
      try {
        const parentPost = await reddit.getPostById(postId as `t3_${string}`);
        parentPostTitle = getString((parentPost as unknown as Record<string, unknown>).title);
      } catch {
        parentPostTitle = undefined;
      }
    }
    return {
      bodySnippet: makeSnippet(c.body ?? c.text),
      authorName: getString(c.authorName ?? c.authorUsername),
      permalink: toAbsoluteRedditUrl(getString(c.permalink)),
      parentPostTitle,
    };
  } catch (error) {
    console.warn('[modanchor] failed to capture target metadata', { targetType, targetId, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
};

const executeRedditModerationAction = async (targetId: string, actionType: ModAnchorActionType): Promise<void> => {
  if (actionType === 'approve_post' || actionType === 'approve_comment') {
    await reddit.approve(targetId as `t3_${string}` | `t1_${string}`);
    return;
  }
  if (actionType === 'remove_post') {
    await reddit.remove(targetId as `t3_${string}`, false);
    return;
  }
  if (actionType === 'remove_post_spam') {
    await reddit.remove(targetId as `t3_${string}`, true);
    return;
  }
  if (actionType === 'remove_comment') {
    await reddit.remove(targetId as `t1_${string}`, false);
    return;
  }
  if (actionType === 'remove_comment_spam') {
    await reddit.remove(targetId as `t1_${string}`, true);
    return;
  }
  throw new Error('UNSUPPORTED_ACTION');
};
const isRemoveActionType = (actionType: ModAnchorActionType) =>
  actionType === 'remove_post' ||
  actionType === 'remove_post_spam' ||
  actionType === 'remove_comment' ||
  actionType === 'remove_comment_spam';
const makeRemovalModNote = (value?: string, maxLength = 100): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
};
const getOrCreateModAnchorRemovalReasonId = async (subredditName: string): Promise<string | null> => {
  try {
    const reasons = await reddit.getSubredditRemovalReasons(subredditName);
    const existing = reasons.find((r) => r.title?.trim().toLowerCase() === 'modanchor removal');
    if (existing?.id) return existing.id;
    const created = await reddit.addSubredditRemovalReason(subredditName, {
      title: 'ModAnchor removal',
      message: 'This item was removed by a moderator through ModAnchor.',
    });
    if (typeof created === 'string' && created.trim()) return created;
    if (created && typeof created === 'object' && 'id' in created) {
      const id = (created as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) return id;
    }
    return null;
  } catch {
    return null;
  }
};
const tryAddRemovalNote = async (targetId: string, removalNote?: string) => {
  const modNote = makeRemovalModNote(removalNote);
  if (!modNote) return { status: 'not_required' as const };
  try {
    const reasonId = await getOrCreateModAnchorRemovalReasonId(getSubreddit());
    console.log('[ModAnchor removal note attempt]', {
      targetType: targetId.startsWith('t3_') ? 'post' : targetId.startsWith('t1_') ? 'comment' : 'unknown',
      hasTargetId: Boolean(targetId),
      subredditName: getSubreddit(),
      hasRemovalNote: Boolean(modNote),
      hasReasonId: Boolean(reasonId),
    });
    if (!reasonId) {
      return { status: 'failed' as const, error: 'Could not find or create subreddit removal reason template.' };
    }
    if (targetId.startsWith('t3_')) {
      const post = await reddit.getPostById(targetId as `t3_${string}`);
      await post.addRemovalNote({ reasonId, modNote });
      return { status: 'added' as const, reasonId };
    }
    if (targetId.startsWith('t1_')) {
      const comment = await reddit.getCommentById(targetId as `t1_${string}`);
      await comment.addRemovalNote({ reasonId, modNote });
      return { status: 'added' as const, reasonId };
    }
    return { status: 'unsupported' as const, error: 'Target type is not supported for Reddit removal-note attachment.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add removal note.';
    console.warn('[ModAnchor removal note failed]', {
      targetType: targetId.startsWith('t3_') ? 'post' : targetId.startsWith('t1_') ? 'comment' : 'unknown',
      targetId,
      status: 'failed',
      error: message,
    });
    return {
      status: 'failed' as const,
      error: message,
    };
  }
};

const handleModAnchorModerationAction = async (
  targetType: 'post' | 'comment',
  targetId: string,
  actionType: ModAnchorActionType,
  reason?: string,
  removalNote?: string
): Promise<string> => {
  const subreddit = getSubreddit();
  const actorUsernameRaw = (await reddit.getCurrentUsername()) ?? 'unknown';
  const actorUsername = normalizeUsername(actorUsernameRaw);
  const reviewAssignments = await getReviewAssignments(redis, subreddit);
  const actorAssignment = reviewAssignments.find(
    (entry) => normalizeUsername(entry.username) === actorUsername && entry.status === 'active'
  );
  const review: ModAnchorActionReview = {
    id: `mar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    subreddit,
    actorUsername,
    targetType,
    targetId,
    actionType,
    reason,
    reportMode: actorAssignment?.reportMode ?? 'per_action',
    reviewAssignmentPhase: actorAssignment?.phase ?? null,
    executionStatus: 'executed',
    modmailDeliveryStatus: 'not_required',
    createdAt: new Date().toISOString(),
  };
  const isRemoveAction = isRemoveActionType(actionType);
  review.metadata = await captureTargetMetadata(targetType, targetId);
  if (removalNote?.trim() && isRemoveAction) {
    review.metadata = {
      ...(review.metadata ?? {}),
      removalNote: removalNote.trim(),
      removalNoteStatus: actorAssignment?.phase === 'approval_required' ? 'pending' : 'unsupported',
    };
  } else if (isRemoveAction) {
    review.metadata = { ...(review.metadata ?? {}), removalNoteStatus: 'not_required' };
  } else {
    review.metadata = { ...(review.metadata ?? {}), removalNoteStatus: 'not_required' };
  }

  if (actorAssignment?.phase === 'approval_required') {
    review.executionStatus = 'pending_approval';
    await createPendingModAnchorActionReview(redis, subreddit, review);
    return 'Action queued for senior approval in ModAnchor.';
  }
  try {
    await executeRedditModerationAction(targetId, actionType);
    if (isRemoveAction) {
      const noteResult = await tryAddRemovalNote(targetId, removalNote);
      review.metadata = {
        ...(review.metadata ?? {}),
        removalNoteStatus: noteResult.status,
        ...(typeof (noteResult as { reasonId?: unknown }).reasonId === 'string' ? { removalReasonId: (noteResult as { reasonId: string }).reasonId } : {}),
        ...(noteResult.error ? { removalNoteError: noteResult.error } : {}),
      };
    }
    review.executionStatus = actorAssignment?.phase === 'monitored_actions' ? 'executed_monitored' : 'executed';
    review.modmailDeliveryStatus = 'not_required';
    if (review.executionStatus === 'executed_monitored') {
      const notified = await applyMonitoringNotification(review, {
        subreddit,
        nowIso: new Date().toISOString(),
        createConversation: reddit.modMail.createConversation.bind(reddit.modMail),
      });
      review.modmailDeliveryStatus = notified.modmailDeliveryStatus;
      review.modmailDeliveredAt = notified.modmailDeliveredAt;
      review.modmailDeliveryError = notified.modmailDeliveryError;
    }
    await createPendingModAnchorActionReview(redis, subreddit, review);
    return actorAssignment?.phase === 'monitored_actions'
      ? 'Action executed and recorded in ModAnchor review.'
      : 'Action executed through ModAnchor.';
  } catch (error) {
    review.executionStatus = 'failed';
    review.error = error instanceof Error ? error.message : 'Unknown execution failure';
    await createPendingModAnchorActionReview(redis, subreddit, review);
    return 'ModAnchor action failed. Please try again or use Reddit\'s native tools.';
  }
};

forms.post('/example-submit', async (c) => {
  const { message } = await c.req.json<ExampleFormValues>();
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  return c.json<UiResponse>(
    {
      showToast: trimmedMessage
        ? `Form says: ${trimmedMessage}`
        : 'Form submitted with no message',
    },
    200
  );
});

forms.post('/modanchor-post-action', async (c) => {
  const body = await c.req.json<{ action?: unknown; reason?: unknown; removalNote?: unknown; targetId?: unknown }>();
  const action = normalizeFormSelectValue(body.action);
  const reason = normalizeFormTextValue(body.reason);
  const removalNote = normalizeFormTextValue(body.removalNote);
  const parsedTargetId = normalizeFormTextValue(body.targetId);
  const targetId = parsedTargetId ?? context.postId;
  const isRemoveAction =
    action === 'remove_post' ||
    action === 'remove_post_spam';
  if (!targetId || !action) {
    return c.json<UiResponse>({
      showForm: {
        name: 'modAnchorPostActionForm',
        form: postActionForm(
          !targetId
            ? 'ModAnchor could not identify this post. Please close this form and reopen the post menu.'
            : 'Choose a ModAnchor action before submitting.',
          { action: action ?? undefined, reason, removalNote, targetId: parsedTargetId ?? '' }
        ),
      },
    }, 200);
  }
  if (isRemoveAction && !removalNote) {
    return c.json<UiResponse>({
      showForm: {
        name: 'modAnchorPostActionForm',
        form: postActionForm(
          'Add a moderator removal note for remove actions (optional). This may not be visible to the author.',
          { action: action ?? undefined, reason, removalNote, targetId: parsedTargetId ?? '' },
          true
        ),
      },
    }, 200);
  }
  console.log('[ModAnchor form submit parsed]', {
    targetType: 'post',
    hasTargetId: Boolean(targetId),
    action,
    hasReason: Boolean(reason),
    hasRemovalNote: Boolean(removalNote),
  });
  const message = await handleModAnchorModerationAction('post', targetId, action as ModAnchorActionType, reason, removalNote);
  return c.json<UiResponse>({ showToast: message }, 200);
});

forms.post('/modanchor-comment-action', async (c) => {
  const body = await c.req.json<{ action?: unknown; reason?: unknown; removalNote?: unknown; targetId?: unknown }>();
  const action = normalizeFormSelectValue(body.action);
  const reason = normalizeFormTextValue(body.reason);
  const removalNote = normalizeFormTextValue(body.removalNote);
  const parsedTargetId = normalizeFormTextValue(body.targetId);
  const targetId = parsedTargetId ?? context.commentId;
  const isRemoveAction =
    action === 'remove_comment' ||
    action === 'remove_comment_spam';
  if (!targetId || !action) {
    return c.json<UiResponse>({
      showForm: {
        name: 'modAnchorCommentActionForm',
        form: commentActionForm(
          !targetId
            ? 'ModAnchor could not identify this comment. Please close this form and reopen the comment menu.'
            : 'Choose a ModAnchor action before submitting.',
          { action: action ?? undefined, reason, removalNote, targetId: parsedTargetId ?? '' }
        ),
      },
    }, 200);
  }
  if (isRemoveAction && !removalNote) {
    return c.json<UiResponse>({
      showForm: {
        name: 'modAnchorCommentActionForm',
        form: commentActionForm(
          'Add a moderator removal note for remove actions (optional). This may not be visible to the author.',
          { action: action ?? undefined, reason, removalNote, targetId: parsedTargetId ?? '' },
          true
        ),
      },
    }, 200);
  }
  console.log('[ModAnchor form submit parsed]', {
    targetType: 'comment',
    hasTargetId: Boolean(targetId),
    action,
    hasReason: Boolean(reason),
    hasRemovalNote: Boolean(removalNote),
  });
  const message = await handleModAnchorModerationAction('comment', targetId, action as ModAnchorActionType, reason, removalNote);
  return c.json<UiResponse>({ showToast: message }, 200);
});
