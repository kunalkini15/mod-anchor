import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  ApiErrorResponse,
  CreateNewModConfigRequest,
  DecrementResponse,
  IncrementResponse,
  InitResponse,
  ModOnboardReportResponse,
  ModeratorListResponse,
  NewModConfigResponse,
  ReportHistoryResponse,
  SeniorityRuleResponse,
  SaveSeniorityRuleRequest,
  SeniorOverrideRequest,
  StartReviewRequest,
  UpdateReviewSetupRequest,
  ReviewAssignmentsResponse,
  ModOnboardAccessResponse,
  SeniorAccessPolicyResponse,
  SaveSeniorAccessPolicyRequest,
  ModAnchorActionReviewsResponse,
  MonitoringDigestsResponse,
  PaginatedMonitoringDigestsResponse,
  ModAnchorActionType,
  MyActionReviewsResponse,
  SubmitUserActionRequest,
  SubmitUserActionResponse,
  PaginatedModAnchorActionReviewsResponse,
  PaginatedReportHistoryResponse,
  ReportHistoryListItem,
} from '../../shared/api';
import { applyMonitoringNotification } from '../core/monitoringNotifications';
import {
  addNewMod,
  completeNewMod,
  getNewMods,
  getReports,
  getReviewAssignments,
  advanceExpiredReviewPhases,
  getSeniorOverrides,
  getSeniorityRule,
  getSeniorAccessPolicy,
  saveSeniorAccessPolicy,
  saveSeniorityRule,
  saveReport,
  saveReports,
  buildModOnboardReport,
  normalizeStoredReports,
  startReviewAssignment,
  addSeniorOverride,
  removeSeniorOverride,
  resetModAnchorWorkspaceData,
  advanceReviewPhase,
  completeReviewAssignment,
  updateReviewAssignmentSetup,
  createPendingModAnchorActionReview,
  getModAnchorActionReviews,
  getModAnchorActionReviewsPage,
  getMonitoringDigests,
  saveMonitoringDigests,
  updateModAnchorActionReviewStatus,
} from '../core/reports';
import { generateMonitoringDigestsForDate } from '../core/monitoringDigests';

export const api = new Hono();

const getSubreddit = () => context.subredditName ?? 'modanchor_dev';
const workspacePostKey = (subreddit: string): string => `modanchor:workspacePostId:${subreddit.toLowerCase()}`;
const normalizeUsername = (value: string) => value.replace(/^\/?u\//i, '').trim();
const clampDays = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(90, Math.max(1, Math.floor(value))) : fallback;
const clampPhase1Days = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(90, Math.max(0, Math.floor(value))) : fallback;
const clampHours = (value: number, fallback = 0) =>
  Number.isFinite(value) ? Math.min(23, Math.max(0, Math.floor(value))) : fallback;
const clampMinutes = (value: number, fallback = 0) =>
  Number.isFinite(value) ? Math.min(59, Math.max(0, Math.floor(value))) : fallback;
const toNumberOrNull = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
const getAccountAgeDays = (createdAt: unknown): number | null => {
  if (!createdAt) return null;
  const created =
    createdAt instanceof Date
      ? createdAt
      : typeof createdAt === 'string' || typeof createdAt === 'number'
        ? new Date(createdAt)
        : null;
  if (!created || Number.isNaN(created.getTime())) return null;
  const diffMs = Date.now() - created.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};
const sumNullableNumbers = (...values: Array<number | null>): number | null => {
  const numericValues = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (!numericValues.length) return null;
  return numericValues.reduce((sum, value) => sum + value, 0);
};
const normalizePermissions = (permissions: string[]) =>
  permissions.map((p) => p.toLowerCase().trim()).filter(Boolean);
const hasStrongRedditPermission = (permissions: string[], strong: string[]) => {
  const normalized = normalizePermissions(permissions);
  const strongSet = new Set(normalizePermissions(strong));
  // Owner-level senior detection should only elevate on all/everything, not config alone.
  const ownerTokens = new Set<string>();
  if (strongSet.has('everything') || strongSet.has('all')) {
    ownerTokens.add('everything');
    ownerTokens.add('all');
  }
  if (ownerTokens.size === 0) return false;
  return normalized.some((permission) =>
    Array.from(ownerTokens).some((token) => permission === token || permission.includes(token))
  );
};
const toDigestDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const parseLimit = (raw: string | undefined, fallback = 25, max = 100) => {
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
};
const parseOffsetCursor = (raw: string | undefined): number => {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};
const MAX_REASON_LENGTH = 1000;
const MAX_MOD_NOTE_LENGTH = 500;
const formatActionLabel = (actionType: string) => {
  const labels: Record<string, string> = {
    remove_post: 'Removed post',
    remove_post_spam: 'Removed post as spam',
    approve_post: 'Approved post',
    remove_comment: 'Removed comment',
    remove_comment_spam: 'Removed comment as spam',
    approve_comment: 'Approved comment',
    lock_post: 'Locked post',
    unlock_post: 'Unlocked post',
    lock_comment: 'Locked comment',
    unlock_comment: 'Unlocked comment',
    ban_user: 'Ban user',
    temp_ban_user: 'Temporary ban user',
    unban_user: 'Unban user',
    mute_user: 'Mute user',
    unmute_user: 'Unmute user',
    add_mod_note: 'Add mod note',
  };
  return labels[actionType] ?? actionType.replaceAll('_', ' ');
};
const NATIVE_MOD_ACTIONS = new Set([
  'approvepost',
  'approvelink',
  'approvecomment',
  'removecomment',
  'removelink',
  'spamcomment',
  'spamlink',
  'lock',
  'unlock',
  'banuser',
  'unbanuser',
  'muteuser',
  'unmuteuser',
  'editflair',
]);
const getRedditPermissionsForUser = async (subredditName: string, username: string): Promise<string[]> => {
  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return [];
    try {
      const permissions = await user.getModPermissionsForSubreddit(subredditName);
      return normalizePermissions(permissions);
    } catch {
      const mapLike = (user as { modPermissions?: Map<string, string[]> }).modPermissions;
      if (mapLike instanceof Map) {
        const fromMap = mapLike.get(subredditName) ?? [];
        return normalizePermissions(fromMap);
      }
      return [];
    }
  } catch {
    return [];
  }
};
const stripThingPrefix = (targetId: string) => targetId.replace(/^t[13]_/, '');
const toFullnameCandidates = (targetId: string, prefix: 't3_' | 't1_'): string[] => {
  const raw = targetId.trim();
  const bare = stripThingPrefix(raw);
  const candidates = [raw, `${prefix}${bare}`];
  return candidates.filter((value, index, arr) => value && arr.indexOf(value) === index);
};
const verifyBanViaBannedUsers = async (subredditName: string, targetUsername: string): Promise<boolean> => {
  try {
    const listing = reddit.getBannedUsers({ subredditName, username: targetUsername, limit: 1, pageSize: 1 });
    const first = await listing.get(0);
    return Boolean(first);
  } catch {
    return false;
  }
};
const verifyBanViaModLog = async (subredditName: string, targetUsername: string): Promise<boolean> => {
  try {
    const listing = reddit.getModerationLog({ subredditName, pageSize: 25 });
    const events = await listing.all();
    const normalizedTarget = normalizeUsername(targetUsername).toLowerCase();
    return events.some((event) =>
      event.type === 'banuser' &&
      normalizeUsername(event.target?.author ?? '').toLowerCase() === normalizedTarget
    );
  } catch {
    return false;
  }
};
const getApprovedUserSet = async (subredditName: string): Promise<Set<string>> => {
  try {
    const listing = reddit.getApprovedUsers({ subredditName, limit: 500, pageSize: 100 });
    const users = await listing.all();
    return new Set(
      users
        .map((user) => normalizeUsername(user.username ?? ''))
        .filter(Boolean)
        .map((username) => username.toLowerCase())
    );
  } catch {
    return new Set();
  }
};
const isPrivateSubreddit = async (): Promise<boolean> => {
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    return subreddit.type === 'private';
  } catch {
    return false;
  }
};
const executeReviewAction = async (review: {
  targetId?: string;
  targetType: string;
  actionType: ModAnchorActionType;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ metadata?: Record<string, unknown> }> => {
  const targetId = review.targetId;
  const actionType = review.actionType;
  if (!targetId) throw new Error('Action review target is missing');
  if (actionType === 'approve_post' || actionType === 'remove_post' || actionType === 'remove_post_spam') {
    const candidateIds = toFullnameCandidates(targetId, 't3_');
    let lastError: unknown;
    for (const id of candidateIds) {
      try {
        if (actionType === 'approve_post') await reddit.approve(id as `t3_${string}`);
        else await reddit.remove(id as `t3_${string}`, actionType === 'remove_post_spam');
        return {};
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to run post moderation action');
  }

  if (actionType === 'approve_comment' || actionType === 'remove_comment' || actionType === 'remove_comment_spam') {
    const candidateIds = toFullnameCandidates(targetId, 't1_');
    let lastError: unknown;
    for (const id of candidateIds) {
      try {
        if (actionType === 'approve_comment') await reddit.approve(id as `t1_${string}`);
        else await reddit.remove(id as `t1_${string}`, actionType === 'remove_comment_spam');
        return {};
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to run comment moderation action');
  }

  if (actionType === 'ban_user') {
    const targetUsername = String((review.metadata?.targetUsername ?? targetId) ?? '').replace(/^\/?u\//i, '').trim();
    if (!targetUsername) throw new Error('Target username is missing');
    const executionAttemptedAt = new Date().toISOString();
    await reddit.banUser({
      subredditName: getSubreddit(),
      username: targetUsername,
      note: typeof review.reason === 'string' ? review.reason : undefined,
    } as unknown as Parameters<typeof reddit.banUser>[0]);
    const subredditName = getSubreddit();
    const verifiedByBannedUsers = await verifyBanViaBannedUsers(subredditName, targetUsername);
    if (verifiedByBannedUsers) {
      return {
        metadata: {
          executionAttemptedAt,
          executionStatusDetail: 'ban_user call succeeded',
          redditApiCallStatus: 'succeeded',
          verificationStatus: 'confirmed',
          verificationSource: 'getBannedUsers',
        },
      };
    }
    const verifiedByModLog = await verifyBanViaModLog(subredditName, targetUsername);
    return {
      metadata: {
        executionAttemptedAt,
        executionStatusDetail: 'ban_user call succeeded',
        redditApiCallStatus: 'succeeded',
        verificationStatus: verifiedByModLog ? 'confirmed' : 'not_confirmed',
        verificationSource: verifiedByModLog ? 'getModerationLog' : 'none',
      },
    };
  }
  if (actionType === 'temp_ban_user') {
    const targetUsername = String((review.metadata?.targetUsername ?? targetId) ?? '').replace(/^\/?u\//i, '').trim();
    if (!targetUsername) throw new Error('Target username is missing');
    const requestedDuration = Number(review.metadata?.durationDays ?? 0);
    const allowedDurations = new Set([3, 7, 28]);
    const duration = allowedDurations.has(requestedDuration) ? requestedDuration : 7;
    const executionAttemptedAt = new Date().toISOString();
    await reddit.banUser({
      subredditName: getSubreddit(),
      username: targetUsername,
      note: typeof review.reason === 'string' ? review.reason : undefined,
      duration,
    } as unknown as Parameters<typeof reddit.banUser>[0]);
    return {
      metadata: {
        executionAttemptedAt,
        executionStatusDetail: 'temp_ban_user call succeeded',
        redditApiCallStatus: 'succeeded',
        verificationStatus: 'skipped',
        verificationSource: 'none',
        durationDays: duration,
      },
    };
  }
  if (actionType === 'unban_user') {
    const targetUsername = String((review.metadata?.targetUsername ?? targetId) ?? '').replace(/^\/?u\//i, '').trim();
    if (!targetUsername) throw new Error('Target username is missing');
    const executionAttemptedAt = new Date().toISOString();
    await reddit.unbanUser(targetUsername, getSubreddit());
    return {
      metadata: {
        executionAttemptedAt,
        executionStatusDetail: 'unban_user call succeeded',
        redditApiCallStatus: 'succeeded',
        verificationStatus: 'skipped',
        verificationSource: 'none',
      },
    };
  }
  if (actionType === 'mute_user') {
    const targetUsername = String((review.metadata?.targetUsername ?? targetId) ?? '').replace(/^\/?u\//i, '').trim();
    if (!targetUsername) throw new Error('Target username is missing');
    const executionAttemptedAt = new Date().toISOString();
    await reddit.muteUser({
      subredditName: getSubreddit(),
      username: targetUsername,
      note: typeof review.reason === 'string' ? review.reason : undefined,
    } as Parameters<typeof reddit.muteUser>[0]);
    return {
      metadata: {
        executionAttemptedAt,
        executionStatusDetail: 'mute_user call succeeded',
        redditApiCallStatus: 'succeeded',
        verificationStatus: 'skipped',
        verificationSource: 'none',
      },
    };
  }
  if (actionType === 'unmute_user') {
    const targetUsername = String((review.metadata?.targetUsername ?? targetId) ?? '').replace(/^\/?u\//i, '').trim();
    if (!targetUsername) throw new Error('Target username is missing');
    const executionAttemptedAt = new Date().toISOString();
    await reddit.unmuteUser(targetUsername, getSubreddit());
    return {
      metadata: {
        executionAttemptedAt,
        executionStatusDetail: 'unmute_user call succeeded',
        redditApiCallStatus: 'succeeded',
        verificationStatus: 'skipped',
        verificationSource: 'none',
      },
    };
  }
  if (actionType === 'add_mod_note') {
    const targetUsername = String((review.metadata?.targetUsername ?? targetId) ?? '').replace(/^\/?u\//i, '').trim();
    const modNote = typeof review.metadata?.modNote === 'string' ? review.metadata.modNote.trim() : '';
    if (!targetUsername) throw new Error('Target username is missing');
    if (!modNote) throw new Error('modNote is required for add_mod_note');
    const executionAttemptedAt = new Date().toISOString();
    await reddit.addModNote({
      subreddit: getSubreddit(),
      user: targetUsername,
      note: modNote,
    });
    return {
      metadata: {
        executionAttemptedAt,
        executionStatusDetail: 'add_mod_note call succeeded',
        redditApiCallStatus: 'succeeded',
        verificationStatus: 'skipped',
        verificationSource: 'none',
      },
    };
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
const getModOnboardAccess = async (): Promise<ModOnboardAccessResponse> => {
  const subredditName = context.subredditName;
  const currentUsernameRaw = (await reddit.getCurrentUsername()) ?? null;
  const currentUsername = currentUsernameRaw ? normalizeUsername(currentUsernameRaw).toLowerCase() : null;
  if (!subredditName || !currentUsername) {
    return {
      currentUsername,
      isModerator: false,
      canViewModOnboard: false,
      canUseActionConsole: false,
      canManageModOnboard: false,
      canApproveActions: false,
      canViewReports: false,
      isSeniorMod: false,
      isUnderReview: false,
      reason: 'ModAnchor is available to subreddit moderators only.',
    };
  }
  const subreddit = getSubreddit();
  const [policy, seniorOverrides, reviewAssignments] = await Promise.all([
    getSeniorAccessPolicy(redis, subreddit),
    getSeniorOverrides(redis, subreddit),
    advanceExpiredReviewPhases(redis, subreddit),
  ]);
  const activeAssignments = reviewAssignments.filter((a) => a.status === 'active');
  const isUnderReview = activeAssignments.some(
    (a) => normalizeUsername(a.username).toLowerCase() === currentUsername
  );
  const hasCompletedReview = reviewAssignments.some((assignment) => {
    if (normalizeUsername(assignment.username).toLowerCase() !== currentUsername) return false;
    return assignment.status === 'completed' || assignment.phase === 'graduated';
  });
  const isSeniorByOverride = seniorOverrides.some(
    (entry) => normalizeUsername(entry.username).toLowerCase() === currentUsername
  );
  const redditPermissions = await getRedditPermissionsForUser(subredditName, currentUsername);
  const isSeniorByRedditPermissions =
    policy.autoSeniorByRedditPermissions &&
    hasStrongRedditPermission(redditPermissions, policy.strongRedditPermissions);
  const isBootstrapAllowed =
    seniorOverrides.length === 0 &&
    activeAssignments.length === 0 &&
    hasStrongRedditPermission(redditPermissions, policy.strongRedditPermissions);
  // TODO: Harden bootstrap access with Reddit owner/full-permission checks once Devvit exposes a reliable field here.
  const isSeniorMod =
    hasCompletedReview || isSeniorByOverride || isSeniorByRedditPermissions || isBootstrapAllowed;
  const isModerator = redditPermissions.length > 0;
  const canUseActionConsole = isModerator;
  const allowed = isModerator;
  const currentAssignment = activeAssignments.find(
    (a) => normalizeUsername(a.username).toLowerCase() === currentUsername
  );
  return {
    currentUsername,
    isModerator,
    canViewModOnboard: allowed,
    canUseActionConsole,
    canManageModOnboard: isSeniorMod,
    canApproveActions: isSeniorMod,
    canViewReports: isSeniorMod,
    isSeniorMod,
    isUnderReview,
    reviewPhase: currentAssignment?.phase ?? null,
    reviewStatus: currentAssignment?.status ?? null,
    reason: allowed ? undefined : 'ModAnchor is available to subreddit moderators only.',
  };
};

api.get('/init', async (c) => {
  const { postId } = context;
  const subredditName = context.subredditName;

  if (!postId) {
    return c.json<ApiErrorResponse>({ error: 'postId is required but missing from context' }, 400);
  }

  try {
    if (subredditName) {
      await redis.set(workspacePostKey(subredditName), postId);
    }
    const [count, username] = await Promise.all([
      redis.get('count'),
      reddit.getCurrentUsername(),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      count: count ? parseInt(count, 10) : 0,
      username: username ?? 'anonymous',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown initialization error';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ApiErrorResponse>({ error: 'postId is required' }, 400);
  }

  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({ count, postId, type: 'increment' });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ApiErrorResponse>({ error: 'postId is required' }, 400);
  }

  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({ count, postId, type: 'decrement' });
});

api.get('/reports', async (c) => {
  try {
    const reports = await getReports(redis, getSubreddit());
    const summaryOnly = String(c.req.query('summaryOnly') ?? '').toLowerCase() === 'true';
    if (!summaryOnly) {
      return c.json<ReportHistoryResponse>({ reports });
    }
    const limit = parseLimit(c.req.query('limit'), 20, 100);
    const offset = parseOffsetCursor(c.req.query('cursor'));
    const items: ReportHistoryListItem[] = reports.map((report) => ({
      id: report.id,
      type: report.type,
      title: report.type === 'modonboard'
        ? report.summary
        : `RuleGap report — ${toDigestDate(report.generatedAt)} UTC`,
      username: report.type === 'modonboard' ? report.username : undefined,
      generatedAt: report.generatedAt,
      periodDays: report.periodDays,
      actionCount: report.type === 'modonboard' ? report.metrics?.totalActions : undefined,
      metrics:
        report.type === 'modonboard'
          ? {
              totalActions: report.metrics?.totalActions,
              approvedExecuted: report.metrics?.approvedExecuted,
              executedMonitored: report.metrics?.executedMonitored,
              rejected: report.metrics?.rejected,
              failed: report.metrics?.failed,
            }
          : undefined,
      focusAreasCount: report.type === 'modonboard' ? report.focusAreas?.length : undefined,
    }));
    const paged = items.slice(offset, offset + limit);
    const nextOffset = offset + paged.length;
    return c.json<PaginatedReportHistoryResponse>({
      items: paged,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
      hasMore: nextOffset < items.length,
      total: items.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load report history';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/reports/:id', async (c) => {
  try {
    const id = String(c.req.param('id') ?? '').trim();
    if (!id) return c.json<ApiErrorResponse>({ error: 'id is required' }, 400);
    const reports = await getReports(redis, getSubreddit());
    const report = reports.find((item) => item.id === id);
    if (!report) return c.json<ApiErrorResponse>({ error: 'Report not found.' }, 404);
    return c.json({ report });
  } catch (error) {
    return c.json<ApiErrorResponse>({ error: error instanceof Error ? error.message : 'Failed to load report' }, 400);
  }
});

api.post('/modonboard/reports/delete', async (c) => {
  try {
    const access = await getModOnboardAccess();
    if (!access.canManageModOnboard) {
      return c.json<ApiErrorResponse>({ error: 'Only senior moderators can manage ModOnboard review settings.' }, 403);
    }
    const body = (await c.req.json<{ reportId?: string }>()) ?? {};
    const reportId = String(body.reportId ?? '').trim();
    if (!reportId) return c.json<ApiErrorResponse>({ error: 'reportId is required' }, 400);
    const subreddit = getSubreddit();
    const existing = normalizeStoredReports(await getReports(redis, subreddit), subreddit);
    if (!existing.some((report) => report.id === reportId)) {
      return c.json<ApiErrorResponse>({ error: 'Report not found.' }, 404);
    }
    const updated = existing.filter((report) => report.id !== reportId);
    await saveReports(redis, subreddit, updated);
    return c.json<ReportHistoryResponse>({ reports: updated });
  } catch (error) {
    return c.json<ApiErrorResponse>({ error: error instanceof Error ? error.message : 'Failed to delete report' }, 400);
  }
});

api.post('/modonboard/reports/delete-all', async (c) => {
  try {
    const access = await getModOnboardAccess();
    if (!access.canManageModOnboard) {
      return c.json<ApiErrorResponse>({ error: 'Only senior moderators can manage ModOnboard review settings.' }, 403);
    }
    const subreddit = getSubreddit();
    await saveReports(redis, subreddit, []);
    return c.json<ReportHistoryResponse>({ reports: [] });
  } catch (error) {
    return c.json<ApiErrorResponse>({ error: error instanceof Error ? error.message : 'Failed to clear report history' }, 400);
  }
});

api.post('/modonboard/reset-data', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    await resetModAnchorWorkspaceData(redis, getSubreddit());
    return c.json({ message: 'ModAnchor workspace data cleared.' }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to clear ModAnchor workspace data.';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/new-mods', async (c) => {
  try {
    const newMods = await getNewMods(redis, getSubreddit());
    return c.json<NewModConfigResponse>({ newMods });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load new mod list';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/access', async (c) => {
  try {
    const access = await getModOnboardAccess();
    return c.json<ModOnboardAccessResponse>(access);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve ModOnboard access';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/moderators', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canViewModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: access.reason ?? 'Only senior moderators can view ModOnboard review data.' },
      403
    );
  }
  const subredditName = context.subredditName;
  if (!subredditName) {
    return c.json<ApiErrorResponse>(
      { error: 'Unable to determine subreddit for moderator loading.' },
      400
    );
  }

  try {
    const currentUsername = normalizeUsername((await reddit.getCurrentUsername()) ?? '').toLowerCase();
    const subreddit = getSubreddit();
    const seniorAccessPolicy = await getSeniorAccessPolicy(redis, subreddit);
    const seniorOverrides = await getSeniorOverrides(redis, subreddit);
    const reviewAssignments = await getReviewAssignments(redis, subreddit);
    const approvedUsers = await getApprovedUserSet(subredditName);
    const overrideSet = new Set(seniorOverrides.map((o) => normalizeUsername(o.username).toLowerCase()));
    const assignmentByUser = new Map(
      reviewAssignments.map((assignment) => [normalizeUsername(assignment.username).toLowerCase(), assignment])
    );
    const listing = reddit.getModerators({ subredditName });
    const entries = await listing.all();
    const moderators = (await Promise.all(
      entries.map(async (entry) => {
        const raw =
          ((entry as { name?: string }).name ??
            (entry as { username?: string }).username ??
            (entry as { displayName?: string }).displayName ??
            '');
        const username = normalizeUsername(raw);
        const key = username.toLowerCase();
        const assignment = assignmentByUser.get(key);
        const isSeniorByOverride = overrideSet.has(key);
        const redditPermissions = await getRedditPermissionsForUser(subredditName, username);
        const isSeniorByRedditPermissions =
          seniorAccessPolicy.autoSeniorByRedditPermissions &&
          hasStrongRedditPermission(redditPermissions, seniorAccessPolicy.strongRedditPermissions);
        let userForSignals = entry as unknown;
        const maybeDirectCreatedAt = (entry as { createdAt?: unknown }).createdAt;
        const maybeDirectLinkKarma = (entry as { linkKarma?: unknown }).linkKarma;
        const maybeDirectCommentKarma = (entry as { commentKarma?: unknown }).commentKarma;
        if (!maybeDirectCreatedAt && maybeDirectLinkKarma === undefined && maybeDirectCommentKarma === undefined && username) {
          try {
            const fetchedUser = await reddit.getUserByUsername(username);
            if (fetchedUser) userForSignals = fetchedUser;
          } catch {
            // Best-effort enrichment only.
          }
        }
        const signalData = (() => {
          try {
            return {
              accountAgeDays: getAccountAgeDays((userForSignals as { createdAt?: unknown }).createdAt),
              linkKarma: toNumberOrNull((userForSignals as { linkKarma?: unknown }).linkKarma),
              commentKarma: toNumberOrNull((userForSignals as { commentKarma?: unknown }).commentKarma),
            };
          } catch {
            return {
              accountAgeDays: null,
              linkKarma: null,
              commentKarma: null,
            };
          }
        })();
        const { accountAgeDays, linkKarma, commentKarma } = signalData;
        const totalKarma = sumNullableNumbers(linkKarma, commentKarma);
        // Mod tenure is not currently available from the inspected Devvit User shape.
        // Keep it null so communities can either set minModTenureDays to 0 or use manual senior override.
        const modTenureDays: number | null = null;
        const hasActiveReview = assignment?.status === 'active';
        const isGraduatedReview = assignment?.status === 'completed' || assignment?.phase === 'graduated';
        const modAnchorRole: 'senior' | 'regular' | 'under_review' = hasActiveReview
          && !(isSeniorByOverride || isSeniorByRedditPermissions)
          ? 'under_review'
          : isGraduatedReview || isSeniorByOverride || isSeniorByRedditPermissions
            ? 'senior'
            : 'regular';
        return {
          username,
          displayName: `u/${username}`,
          isCurrentUser: username.toLowerCase() === currentUsername,
          modTenureDays,
          accountAgeDays,
          totalKarma,
          linkKarma,
          commentKarma,
          redditPermissions,
          isSeniorByRedditPermissions,
          modAnchorRole,
          reviewPhase: assignment?.phase ?? null,
          reviewStatus: assignment?.status ?? null,
          isSeniorByRule: false,
          isSeniorByOverride,
          isApprovedUser: approvedUsers.has(key),
        };
      })
    ))
      .filter((m) => m.username.length > 0)
      .sort((a, b) => a.username.localeCompare(b.username));

    return c.json<ModeratorListResponse>({ moderators });
  } catch (error) {
    console.error('Failed to load subreddit moderators:', error);
    return c.json<ApiErrorResponse>(
      {
        error: 'Unable to load subreddit moderators. You can still add a username manually.',
      },
      500
    );
  }
});

api.get('/modonboard/seniority-rule', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canViewModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: access.reason ?? 'Only senior moderators can view ModOnboard review data.' },
      403
    );
  }
  try {
    const subreddit = getSubreddit();
    const [seniorityRule, seniorOverrides] = await Promise.all([
      getSeniorityRule(redis, subreddit),
      getSeniorOverrides(redis, subreddit),
    ]);
    return c.json<SeniorityRuleResponse>({ seniorityRule, seniorOverrides });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load seniority rule';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/senior-access-policy', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canViewModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: access.reason ?? 'Only senior moderators can view ModOnboard review data.' },
      403
    );
  }
  try {
    const subreddit = getSubreddit();
    const [seniorAccessPolicy, seniorOverrides] = await Promise.all([
      getSeniorAccessPolicy(redis, subreddit),
      getSeniorOverrides(redis, subreddit),
    ]);
    return c.json<SeniorAccessPolicyResponse>({ seniorAccessPolicy, seniorOverrides });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load senior access policy';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/senior-access-policy', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<SaveSeniorAccessPolicyRequest>()) ?? ({} as SaveSeniorAccessPolicyRequest);
    if (!body.seniorAccessPolicy) {
      return c.json<ApiErrorResponse>({ error: 'seniorAccessPolicy is required' }, 400);
    }
    const username = normalizeUsername((await reddit.getCurrentUsername()) ?? '') || undefined;
    const saved = await saveSeniorAccessPolicy(redis, getSubreddit(), {
      ...body.seniorAccessPolicy,
      updatedAt: new Date().toISOString(),
      updatedBy: username,
    });
    const seniorOverrides = await getSeniorOverrides(redis, getSubreddit());
    return c.json<SeniorAccessPolicyResponse>({ seniorAccessPolicy: saved, seniorOverrides });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save senior access policy';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/seniority-rule', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<SaveSeniorityRuleRequest>()) ?? ({} as SaveSeniorityRuleRequest);
    if (!body.seniorityRule) {
      return c.json<ApiErrorResponse>({ error: 'seniorityRule is required' }, 400);
    }
    const username = normalizeUsername((await reddit.getCurrentUsername()) ?? '') || undefined;
    const saved = await saveSeniorityRule(redis, getSubreddit(), {
      ...body.seniorityRule,
      updatedAt: new Date().toISOString(),
      updatedBy: username,
    });
    const seniorOverrides = await getSeniorOverrides(redis, getSubreddit());
    return c.json<SeniorityRuleResponse>({ seniorityRule: saved, seniorOverrides });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save seniority rule';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/senior-overrides', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<SeniorOverrideRequest>()) ?? {};
    const username = normalizeUsername(body.username ?? '');
    if (!username) return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    const assignedBy = normalizeUsername((await reddit.getCurrentUsername()) ?? '') || undefined;
    const seniorOverrides = await addSeniorOverride(redis, getSubreddit(), username, assignedBy);
    const seniorityRule = await getSeniorityRule(redis, getSubreddit());
    return c.json<SeniorityRuleResponse>({ seniorityRule, seniorOverrides });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add senior override';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/senior-overrides/remove', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<SeniorOverrideRequest>()) ?? {};
    const username = normalizeUsername(body.username ?? '');
    if (!username) return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    const seniorOverrides = await removeSeniorOverride(redis, getSubreddit(), username);
    const seniorityRule = await getSeniorityRule(redis, getSubreddit());
    return c.json<SeniorityRuleResponse>({ seniorityRule, seniorOverrides });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove senior override';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/reviews', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canViewModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: access.reason ?? 'Only senior moderators can view ModOnboard review data.' },
      403
    );
  }
  try {
    const reviewAssignments = await advanceExpiredReviewPhases(redis, getSubreddit());
    return c.json<ReviewAssignmentsResponse>({ reviewAssignments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load review assignments';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/reviews/start', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<StartReviewRequest>()) ?? ({} as StartReviewRequest);
    const username = normalizeUsername(body.username ?? '');
    if (!username) return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    const request: StartReviewRequest = {
      username,
      phase1Days: clampPhase1Days(body.phase1Days, 0),
      phase2Days: clampDays(body.phase2Days, 14),
      phase1DurationMinutes:
        typeof body.phase1DurationMinutes === 'number'
          ? Math.max(0, Math.floor(body.phase1DurationMinutes))
          : clampPhase1Days(body.phase1Days, 0) * 24 * 60 + clampHours((body as { phase1Hours?: number }).phase1Hours ?? 0) * 60 + clampMinutes((body as { phase1Minutes?: number }).phase1Minutes ?? 0),
      phase2DurationMinutes:
        typeof body.phase2DurationMinutes === 'number'
          ? Math.max(1, Math.floor(body.phase2DurationMinutes))
          : Math.max(1, clampDays(body.phase2Days, 14) * 24 * 60 + clampHours((body as { phase2Hours?: number }).phase2Hours ?? 0) * 60 + clampMinutes((body as { phase2Minutes?: number }).phase2Minutes ?? 0)),
      autoGraduate: body.autoGraduate === true,
      reportMode: body.reportMode === 'daily_digest' ? 'daily_digest' : 'per_action',
    };
    const subredditName = context.subredditName;
    if (!subredditName) {
      return c.json<ApiErrorResponse>({ error: 'Unable to determine subreddit for review onboarding.' }, 400);
    }
    let onboardingMessage: string | undefined;
    if (await isPrivateSubreddit()) {
      const approvedUsers = await getApprovedUserSet(subredditName);
      const normalized = username.toLowerCase();
      if (!approvedUsers.has(normalized)) {
        try {
          await reddit.approveUser(username, subredditName);
          onboardingMessage = `Added u/${username} as an approved user so they can open the ModAnchor workspace.`;
        } catch (error) {
          console.error('[modanchor] failed to auto-approve moderator for private subreddit', {
            subredditName,
            username,
            error: error instanceof Error ? error.message : String(error),
          });
          return c.json<ApiErrorResponse>(
            {
              error:
                'This private subreddit requires the moderator to be an approved user before they can open ModAnchor. Add them as an approved user in Reddit Mod Tools, then try again.',
            },
            400
          );
        }
      }
    }
    const assignedBy = normalizeUsername((await reddit.getCurrentUsername()) ?? '') || undefined;
    const reviewAssignments = await startReviewAssignment(redis, getSubreddit(), request, assignedBy);
    const reviewPeriodDays = Math.max(
      1,
      Math.ceil(((request.phase1DurationMinutes ?? request.phase1Days * 24 * 60) + (request.phase2DurationMinutes ?? request.phase2Days * 24 * 60)) / (24 * 60))
    );
    await addNewMod(redis, getSubreddit(), username, reviewPeriodDays);
    return c.json<ReviewAssignmentsResponse>({
      reviewAssignments,
      ...(onboardingMessage ? { message: onboardingMessage } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start review assignment';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/reviews/advance', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<{ username?: string }>()) ?? {};
    const username = normalizeUsername(body.username ?? '');
    if (!username) return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    const reviewAssignments = await advanceReviewPhase(redis, getSubreddit(), username);
    return c.json<ReviewAssignmentsResponse>({ reviewAssignments });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to advance review phase';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/reviews/complete', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<{ username?: string }>()) ?? {};
    const username = normalizeUsername(body.username ?? '');
    if (!username) return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    const subreddit = getSubreddit();
    const reviewAssignments = await completeReviewAssignment(redis, subreddit, username);
    await completeNewMod(redis, getSubreddit(), username);
    let message = 'Review assignment completed.';
    let finalReportId: string | undefined;
    let finalReportStatus: 'saved' | 'failed' | 'skipped' = 'skipped';
    try {
      const completed = reviewAssignments.find((a) => normalizeUsername(a.username) === username);
      if (completed) {
        const actionReviews = await getModAnchorActionReviews(redis, subreddit);
        const id = `final-review:${subreddit}:${username}:${completed.assignedAt}`;
        finalReportId = id;
        const generatedAt = new Date().toISOString();
        const report = buildModOnboardReport({
          subreddit,
          username,
          assignment: completed,
          actionReviews,
          generatedAtIso: generatedAt,
          reportType: 'final_review',
          reportId: id,
        });
        const existing = await getReports(redis, subreddit);
        const filtered = existing.filter((r) => r.id !== id);
        await saveReports(redis, subreddit, [report, ...filtered]);
        message = 'Review completed and final report saved.';
        finalReportStatus = 'saved';
      }
    } catch (error) {
      console.warn('[modanchor] final report generation failed after completion', error);
      message = 'Review completed, but final report could not be generated.';
      finalReportStatus = 'failed';
    }
    return c.json<ReviewAssignmentsResponse>({ reviewAssignments, message, finalReportId, finalReportStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete review assignment';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/reviews/update', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<UpdateReviewSetupRequest>()) ?? ({} as UpdateReviewSetupRequest);
    const username = normalizeUsername(body.username ?? '');
    if (!username) return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    const request: UpdateReviewSetupRequest = {
      username,
      phase1DurationMinutes:
        typeof body.phase1DurationMinutes === 'number' ? Math.max(0, Math.floor(body.phase1DurationMinutes)) : undefined,
      phase2DurationMinutes:
        typeof body.phase2DurationMinutes === 'number' ? Math.max(1, Math.floor(body.phase2DurationMinutes)) : undefined,
      autoGraduate: typeof body.autoGraduate === 'boolean' ? body.autoGraduate : undefined,
      reportMode: body.reportMode === 'daily_digest' || body.reportMode === 'per_action' ? body.reportMode : undefined,
    };
    const reviewAssignments = await updateReviewAssignmentSetup(redis, getSubreddit(), request);
    return c.json<ReviewAssignmentsResponse>({
      reviewAssignments,
      message: `Review setup updated for u/${username}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update review setup';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/new-mods', async (c) => {
  try {
    const body = (await c.req.json<Partial<CreateNewModConfigRequest>>()) ?? {};
    const username = (body.username ?? '').replace(/^u\//i, '').trim();
    if (!username) {
      return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    }

    const reviewPeriodDays = Number.isFinite(body.reviewPeriodDays)
      ? Math.max(1, Math.floor(body.reviewPeriodDays!))
      : 14;

    const newMods = await addNewMod(redis, getSubreddit(), username, reviewPeriodDays);
    return c.json<NewModConfigResponse>({ newMods });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add new mod';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/new-mods/complete', async (c) => {
  try {
    const body = (await c.req.json<{ username?: string }>()) ?? {};
    const username = (body.username ?? '').replace(/^u\//i, '').trim();
    if (!username) {
      return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    }

    const newMods = await completeNewMod(redis, getSubreddit(), username);
    return c.json<NewModConfigResponse>({ newMods });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete new mod onboarding';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/report', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<{ username?: string; periodDays?: number; reviewAssignmentId?: string }>()) ?? {};
    const username = normalizeUsername(body.username ?? '');
    if (!username) {
      return c.json<ApiErrorResponse>({ error: 'username is required' }, 400);
    }

    const subreddit = getSubreddit();
    const [assignments, actionReviews] = await Promise.all([
      getReviewAssignments(redis, subreddit),
      getModAnchorActionReviews(redis, subreddit),
    ]);
    const assignment = assignments.find((a) => normalizeUsername(a.username) === username);
    if (!assignment) {
      return c.json<ApiErrorResponse>({ error: 'No review assignment found for this moderator.' }, 404);
    }
    const generatedAt = new Date().toISOString();
    const reportId = `manual-review:${subreddit}:${username}:${generatedAt}`;
    const filtered = actionReviews.filter((r) => normalizeUsername(r.actorUsername) === username);
    const startMs = new Date(assignment.assignedAt).getTime();
    const endMs = new Date(assignment.status === 'completed' ? assignment.expectedPhaseEndAt : generatedAt).getTime();
    const nativeActions = await (async () => {
      try {
        const listing = reddit.getModerationLog({
          subredditName: subreddit,
          moderatorUsernames: [username],
          pageSize: 100,
        });
        const events = await listing.all();
        return events
          .filter((event) => {
            const t = new Date(event.createdAt).getTime();
            if (!Number.isFinite(t) || t < startMs || t > endMs) return false;
            return NATIVE_MOD_ACTIONS.has(String(event.type ?? '').toLowerCase());
          })
          .map((event) => ({
            id: event.id,
            action: String(event.type ?? 'unknown'),
            createdAt: new Date(event.createdAt).toISOString(),
            targetType: undefined,
            targetId: event.target?.id,
            details: typeof event.details === 'string' ? event.details : undefined,
          }));
      } catch {
        return [] as Array<{ id: string; action: string; createdAt: string; targetType?: string; targetId?: string; details?: string }>;
      }
    })();
    const report = buildModOnboardReport({
      subreddit,
      username,
      assignment,
      actionReviews: filtered,
      generatedAtIso: generatedAt,
      reportType: 'manual',
      reportId,
    });
    if (nativeActions.length > 0) {
      report.nativeActionSummary = {
        totalCount: nativeActions.length,
        breakdown: nativeActions.reduce<Record<string, number>>((acc, action) => {
          const key = action.action.toLowerCase();
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
        note: 'ModAnchor cannot block native Reddit actions. This section uses moderation-log activity by the reviewed moderator during this period.',
      };
      report.nativeActionsRecent = nativeActions.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);
    }
    await saveReport(redis, subreddit, report);
    return c.json<ModOnboardReportResponse>({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate ModOnboard report';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/action-reviews', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const status = c.req.query('status')?.trim();
    const actor = c.req.query('actor')?.trim().toLowerCase();
    const dateFrom = c.req.query('dateFrom')?.trim();
    const dateTo = c.req.query('dateTo')?.trim();
    const shouldPaginate = Boolean(
      status ||
      actor ||
      dateFrom ||
      dateTo ||
      c.req.query('limit') ||
      c.req.query('cursor')
    );
    if (!shouldPaginate) {
      const reviews = await getModAnchorActionReviews(redis, getSubreddit());
      return c.json<ModAnchorActionReviewsResponse>({ reviews });
    }
    const page = await getModAnchorActionReviewsPage(redis, getSubreddit(), {
      status,
      actor,
      dateFrom,
      dateTo,
      limit: parseLimit(c.req.query('limit'), 25, 100),
      cursor: c.req.query('cursor') ?? undefined,
    });
    return c.json<PaginatedModAnchorActionReviewsResponse>({
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total: page.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load ModAnchor action reviews';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/my-action-reviews', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canUseActionConsole || !access.currentUsername) {
    return c.json<ApiErrorResponse>(
      { error: 'ModAnchor is available to subreddit moderators only.' },
      403
    );
  }
  try {
    const actor = normalizeUsername(access.currentUsername).toLowerCase();
    const page = await getModAnchorActionReviewsPage(redis, getSubreddit(), {
      actor,
      limit: parseLimit(c.req.query('limit'), 20, 100),
      cursor: c.req.query('cursor') ?? undefined,
    });
    return c.json<MyActionReviewsResponse & { nextCursor: string | null; hasMore: boolean; total: number }>({
      reviews: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total: page.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load your action reviews';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/action-reviews/approve', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<{ actionReviewId?: string }>()) ?? {};
    const actionReviewId = body.actionReviewId ?? '';
    if (!actionReviewId) return c.json<ApiErrorResponse>({ error: 'actionReviewId is required' }, 400);
    const reviews = await getModAnchorActionReviews(redis, getSubreddit());
    const review = reviews.find((r) => r.id === actionReviewId);
    if (!review) return c.json<ApiErrorResponse>({ error: 'Action review not found' }, 404);
    if (review.executionStatus !== 'pending_approval') {
      return c.json<ApiErrorResponse>({ error: 'Action review is not pending approval' }, 400);
    }
    const approverRaw = (await reddit.getCurrentUsername()) ?? 'unknown';
    const approver = normalizeUsername(approverRaw);
    let approverPerms: string[] = [];
    try {
      if (context.subredditName) {
        approverPerms = await getRedditPermissionsForUser(context.subredditName, approver);
      }
    } catch {
      approverPerms = [];
    }
    console.log('[ModAnchor approve action attempt]', {
      actionReviewId,
      subreddit: getSubreddit(),
      contextSubredditName: context.subredditName ?? null,
      approverUsername: approver,
      approverPerms,
      targetType: review.targetType,
      targetId: review.targetId,
      actionType: review.actionType,
      currentStatus: review.executionStatus,
    });
    const executionResult = await executeReviewAction(review as unknown as Parameters<typeof executeReviewAction>[0]);
    const decidedBy = approver || undefined;
    const noteResult = isRemoveActionType(review.actionType) && review.targetId
      ? await tryAddRemovalNote(
          review.targetId,
          typeof review.metadata?.removalNote === 'string'
            ? review.metadata.removalNote
            : typeof review.metadata?.modNote === 'string'
              ? review.metadata.modNote
              : undefined
        )
      : { status: 'not_required' as const, error: undefined };
    const updated = await updateModAnchorActionReviewStatus(
      redis,
      getSubreddit(),
      actionReviewId,
      'approved_executed',
      decidedBy,
      undefined,
      noteResult.status !== 'not_required'
        ? {
            ...(executionResult.metadata ?? {}),
            removalNoteStatus: noteResult.status,
            ...(typeof (noteResult as { reasonId?: unknown }).reasonId === 'string' ? { removalReasonId: (noteResult as { reasonId: string }).reasonId } : {}),
            ...(noteResult.error ? { removalNoteError: noteResult.error } : {}),
          }
        : (executionResult.metadata ?? undefined)
    );
    return c.json<ModAnchorActionReviewsResponse>({ reviews: updated });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.includes('403')
      ? 'Could not execute action: approving moderator lacks required Reddit moderation permissions for this target.'
      : raw;
    console.error('[ModAnchor approve action failed]', {
      route: '/api/modonboard/action-reviews/approve',
      subreddit: getSubreddit(),
      contextSubredditName: context.subredditName ?? null,
      error: raw,
    });
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/action-console/submit', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canUseActionConsole) {
    return c.json<ApiErrorResponse>(
      { error: 'ModAnchor is available to subreddit moderators only.' },
      403
    );
  }
  try {
    const body = (await c.req.json<SubmitUserActionRequest>()) ?? {};
    const actionType = body.actionType;
    const targetType = body.targetType;
    const targetUsername = normalizeUsername(body.targetUsername ?? '').trim();
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
    const modNote = typeof body.modNote === 'string' ? body.modNote.trim().slice(0, MAX_MOD_NOTE_LENGTH) : '';
    const targetActionMap: Record<'user' | 'post' | 'comment', Set<ModAnchorActionType>> = {
      user: new Set(['ban_user', 'temp_ban_user', 'unban_user', 'mute_user', 'unmute_user', 'add_mod_note']),
      post: new Set(['approve_post', 'remove_post', 'remove_post_spam', 'lock_post', 'unlock_post']),
      comment: new Set(['approve_comment', 'remove_comment', 'remove_comment_spam', 'lock_comment', 'unlock_comment']),
    };
    if (!targetActionMap[targetType]?.has(actionType)) return c.json<ApiErrorResponse>({ error: 'Unsupported action type for target.' }, 400);
    if (actionType === 'add_mod_note' && !modNote) {
      return c.json<ApiErrorResponse>({ error: 'modNote is required for add mod note' }, 400);
    }
    if (targetType === 'user' && !targetUsername) return c.json<ApiErrorResponse>({ error: 'targetUsername is required' }, 400);
    if ((targetType === 'post' || targetType === 'comment') && !targetId) return c.json<ApiErrorResponse>({ error: 'targetId is required' }, 400);
    const parsedTargetId = targetType === 'user' ? targetUsername : targetId;
    const actorRaw = (await reddit.getCurrentUsername()) ?? '';
    const actorUsername = normalizeUsername(actorRaw).toLowerCase();
    if (!actorUsername) return c.json<ApiErrorResponse>({ error: 'Unable to resolve actor username' }, 400);
    const subreddit = getSubreddit();
    const [reviews, existingActionReviews] = await Promise.all([
      getReviewAssignments(redis, subreddit),
      getModAnchorActionReviews(redis, subreddit),
    ]);
    const actorAssignment = reviews.find(
      (r) => r.status === 'active' && normalizeUsername(r.username).toLowerCase() === actorUsername
    );
    const nowMs = Date.now();
    const dedupeCandidate = existingActionReviews.find((entry) => {
      const createdMs = new Date(entry.createdAt).getTime();
      const withinWindow = Number.isFinite(createdMs) && nowMs - createdMs >= 0 && nowMs - createdMs <= 30_000;
      if (!withinWindow) return false;
      if (entry.subreddit !== subreddit) return false;
      if (normalizeUsername(entry.actorUsername).toLowerCase() !== actorUsername) return false;
      if (entry.targetType !== targetType) return false;
      if (String(entry.targetId ?? '').toLowerCase() !== String(parsedTargetId ?? '').toLowerCase()) return false;
      if (entry.actionType !== actionType) return false;
      if ((entry.reason ?? '').trim() !== reason) return false;
      return entry.executionStatus === 'pending_approval' || entry.executionStatus === 'executed_monitored';
    });
    if (dedupeCandidate) {
      return c.json<SubmitUserActionResponse>(
        {
          message:
            dedupeCandidate.executionStatus === 'pending_approval'
              ? `Queued for senior approval: ${formatActionLabel(actionType)}.`
              : `Action ran and was recorded for monitoring: ${formatActionLabel(actionType)}.`,
          review: dedupeCandidate,
        },
        200
      );
    }
    const now = new Date().toISOString();
    const review: import('../../shared/api').ModAnchorActionReview = {
      id: crypto.randomUUID(),
      subreddit,
      actorUsername,
      targetType,
      targetId: parsedTargetId ?? undefined,
      targetUsername: targetType === 'user' ? targetUsername : undefined,
      actionType,
      reason: reason || undefined,
      reviewAssignmentPhase: actorAssignment?.phase ?? null,
      executionStatus: 'executed' as const,
      createdAt: now,
      metadata: {
        ...(targetType === 'user' ? { targetUsername } : {}),
        ...(parsedTargetId ? { parsedTargetId } : {}),
        targetType,
        ...(modNote ? { modNote } : {}),
        ...(isRemoveActionType(actionType) && modNote
          ? { removalNote: modNote, removalNoteStatus: actorAssignment?.phase === 'approval_required' ? 'pending' : 'not_required' }
          : {}),
        ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
      },
    };
    if (actorAssignment?.phase === 'approval_required') {
      review.executionStatus = 'pending_approval';
      await createPendingModAnchorActionReview(redis, subreddit, review);
      return c.json<SubmitUserActionResponse>({ message: `Queued for senior approval: ${formatActionLabel(actionType)}.`, review }, 200);
    }
    try {
      const executionResult = await executeReviewAction(review);
      review.executionStatus = actorAssignment?.phase === 'monitored_actions' ? 'executed_monitored' : 'executed';
      review.executedAt = new Date().toISOString();
      review.metadata = { ...(review.metadata ?? {}), ...(executionResult.metadata ?? {}) };
      if (review.executionStatus === 'executed_monitored') {
        const notified = await applyMonitoringNotification(review, {
          subreddit,
          nowIso: new Date().toISOString(),
          createConversation: reddit.modMail.createConversation.bind(reddit.modMail),
        });
        review.modmailDeliveryStatus = notified.modmailDeliveryStatus;
        review.modmailDeliveredAt = notified.modmailDeliveredAt;
        review.modmailDeliveryError = notified.modmailDeliveryError;
      } else {
        review.modmailDeliveryStatus = 'not_required';
      }
      await createPendingModAnchorActionReview(redis, subreddit, review);
      const monitoringDeliveryMessage =
        review.executionStatus !== 'executed_monitored'
          ? ''
          : review.modmailDeliveryStatus === 'sent'
            ? ' Monitoring modmail sent.'
            : review.modmailDeliveryStatus === 'pending'
              ? ' Added to daily digest queue.'
              : review.modmailDeliveryStatus === 'failed'
                ? ' ModAnchor could not send the monitoring modmail.'
                : '';
      return c.json<SubmitUserActionResponse>(
        {
          message:
            review.executionStatus === 'executed_monitored'
              ? `Action ran and was recorded for monitoring: ${formatActionLabel(actionType)}.${monitoringDeliveryMessage}`
              : `Action executed: ${formatActionLabel(actionType)}.`,
          review,
        },
        200
      );
    } catch (error) {
      review.executionStatus = 'failed';
      review.error = error instanceof Error ? error.message : 'Failed to execute action';
      review.executedAt = new Date().toISOString();
      review.metadata = {
        ...(review.metadata ?? {}),
        executionAttemptedAt: review.executedAt,
        redditApiCallStatus: 'failed',
        redditApiError: review.error,
        executionStatusDetail: 'Reddit API call failed',
        verificationStatus: 'failed',
        verificationSource: 'none',
        verificationError: review.error,
        userActionError: review.error,
      };
      await createPendingModAnchorActionReview(redis, subreddit, review);
      return c.json<ApiErrorResponse>({ error: review.error }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit user action';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/action-console/recent-posts', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canUseActionConsole) return c.json<ApiErrorResponse>({ error: 'ModAnchor is available to subreddit moderators only.' }, 403);
  try {
    const subredditName = context.subredditName;
    if (!subredditName) return c.json<ApiErrorResponse>({ error: 'Unable to determine subreddit' }, 400);
    const listing = reddit.getNewPosts({ subredditName, limit: 100, pageSize: 100 });
    const posts = await listing.all();
    return c.json({
      posts: posts
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 100)
        .map((post) => ({
        id: post.id,
        title: post.title,
        authorName: post.authorName ?? undefined,
        bodySnippet: typeof post.body === 'string' ? post.body.slice(0, 180) : undefined,
        permalink: post.permalink,
        createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : undefined,
      })),
    });
  } catch (error) {
    console.error('[modanchor] failed to load action console recent posts', error);
    return c.json<ApiErrorResponse>({ error: error instanceof Error ? error.message : 'Failed to load recent posts' }, 400);
  }
});

api.get('/modonboard/action-console/post-comments', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canUseActionConsole) return c.json<ApiErrorResponse>({ error: 'ModAnchor is available to subreddit moderators only.' }, 403);
  try {
    const postId = String(c.req.query('postId') ?? '').trim();
    if (!postId || !postId.startsWith('t3_')) return c.json<ApiErrorResponse>({ error: 'postId must be a t3_ id' }, 400);
    const post = await reddit.getPostById(postId as `t3_${string}`);
    const comments = await post.comments.all();
    return c.json({
      comments: comments
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 100)
        .map((comment) => ({
        id: comment.id,
        bodySnippet: typeof comment.body === 'string' && comment.body.trim() ? comment.body.slice(0, 180) : '[No comment text]',
        authorName: comment.authorName ?? undefined,
        permalink: comment.permalink,
        createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : undefined,
        parentPostId: post.id,
        parentPostTitle: post.title,
      })),
    });
  } catch (error) {
    console.error('[modanchor] failed to load action console post comments', error);
    return c.json<ApiErrorResponse>({ error: error instanceof Error ? error.message : 'Failed to load post comments' }, 400);
  }
});

api.post('/modonboard/action-reviews/reject', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<{ actionReviewId?: string; reason?: string }>()) ?? {};
    const actionReviewId = body.actionReviewId ?? '';
    if (!actionReviewId) return c.json<ApiErrorResponse>({ error: 'actionReviewId is required' }, 400);
    const decidedBy = normalizeUsername((await reddit.getCurrentUsername()) ?? '') || undefined;
    const updated = await updateModAnchorActionReviewStatus(
      redis,
      getSubreddit(),
      actionReviewId,
      'rejected',
      decidedBy,
      body.reason
    );
    return c.json<ModAnchorActionReviewsResponse>({ reviews: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reject action review';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.get('/modonboard/monitoring-digests', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canViewModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: access.reason ?? 'Only senior moderators can view ModOnboard review data.' },
      403
    );
  }
  try {
    const digests = await getMonitoringDigests(redis, getSubreddit());
    const actor = c.req.query('actor')?.trim().toLowerCase();
    const date = c.req.query('date')?.trim();
    const dateFrom = c.req.query('dateFrom')?.trim();
    const dateTo = c.req.query('dateTo')?.trim();
    const status = c.req.query('status')?.trim();
    const shouldPaginate = Boolean(
      actor ||
      date ||
      dateFrom ||
      dateTo ||
      status ||
      c.req.query('limit') ||
      c.req.query('cursor')
    );
    if (!shouldPaginate) {
      return c.json<MonitoringDigestsResponse>({ digests });
    }
    const limit = parseLimit(c.req.query('limit'), 25, 100);
    const offset = parseOffsetCursor(c.req.query('cursor'));
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;
    const filtered = digests
      .filter((digest) => !actor || normalizeUsername(digest.actorUsername).toLowerCase() === actor)
      .filter((digest) => !date || digest.digestDate === date)
      .filter((digest) => !status || digest.deliveryStatus === status)
      .filter((digest) => {
        const t = new Date(digest.digestDate).getTime();
        if (!Number.isFinite(t)) return false;
        return t >= fromMs && t <= toMs;
      })
      .sort((a, b) => new Date(b.digestDate).getTime() - new Date(a.digestDate).getTime());
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return c.json<PaginatedMonitoringDigestsResponse>({
      items,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      hasMore: nextOffset < filtered.length,
      total: filtered.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load monitoring digests';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});

api.post('/modonboard/monitoring-digests/generate', async (c) => {
  const access = await getModOnboardAccess();
  if (!access.canManageModOnboard) {
    return c.json<ApiErrorResponse>(
      { error: 'Only senior moderators can manage ModOnboard review settings.' },
      403
    );
  }
  try {
    const body = (await c.req.json<{ digestDate?: string; sendModmail?: boolean }>()) ?? {};
    const digestDateUtc = body.digestDate && /^\d{4}-\d{2}-\d{2}$/.test(body.digestDate)
      ? body.digestDate
      : toDigestDate(new Date().toISOString());
    const sendModmail = body.sendModmail !== false;
    const subreddit = getSubreddit();
    const reviews = await getModAnchorActionReviews(redis, subreddit);
    const existing = await getMonitoringDigests(redis, subreddit);
    const result = await generateMonitoringDigestsForDate({
      subreddit,
      digestDateUtc,
      sendModmail,
      reviews,
      existingDigests: existing,
    });
    const updated = result.digests;
    await saveMonitoringDigests(redis, subreddit, updated);
    return c.json<MonitoringDigestsResponse & {
      ok: boolean;
      date: string;
      processedActors: number;
      skippedAlreadySent: number;
      truncated: boolean;
      scannedActions: number;
      generated: number;
      sent: number;
      failed: number;
      message: string;
    }>({
      digests: updated,
      ok: true,
      date: digestDateUtc,
      processedActors: result.processedActors,
      skippedAlreadySent: result.skippedAlreadySent,
      truncated: result.truncated,
      scannedActions: result.scannedActions,
      generated: result.generated,
      sent: result.sent,
      failed: result.failed,
      message: 'Daily digest generation completed.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate monitoring digests';
    return c.json<ApiErrorResponse>({ error: message }, 400);
  }
});
