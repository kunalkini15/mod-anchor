import { reddit } from '@devvit/web/server';
import type {
  ModerationActivityPreview,
  ModerationLogAction,
} from '../../shared/api';
type ModActionLike = {
  id?: string;
  type?: string;
  moderatorName?: string;
  createdAt?: Date;
  details?: string;
  description?: string;
  target?: {
    author?: string;
    permalink?: string;
    title?: string;
  };
};

export const normalizeUsername = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/^\/?u\//i, '').trim();
  return normalized || undefined;
};

export const normalizeAction = (value?: string | null): string => {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized || 'unknown';
};

export const getCurrentSubredditName = (ctx: {
  subredditName?: string;
}): string | undefined => {
  return ctx.subredditName;
};

export const isPlatformAction = (action: string): boolean => {
  const normalized = normalizeAction(action);
  const knownPlatformActions = new Set([
    'dev_platform_app_changed',
    'dev_platform_app_installed',
    'dev_platform_app_uninstalled',
    'dev_platform_app_settings_changed',
  ]);
  return normalized.startsWith('dev_platform_') || knownPlatformActions.has(normalized);
};

export const isModerationRelevantAction = (action: string): boolean => {
  const normalized = normalizeAction(action);
  const knownRelevant = new Set([
    'removelink',
    'removecomment',
    'approvelink',
    'approvecomment',
    'addremovalreason',
    'spamlink',
    'spamcomment',
    'lock',
    'unlock',
    'banuser',
    'unbanuser',
    'wikirevise',
    'invite moderator',
    'invitemoderator',
    'acceptmoderatorinvite',
    'distinguish',
    'unsticky',
    'sticky',
  ]);
  return knownRelevant.has(normalized);
};

const toIso = (raw: unknown): string => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  if (typeof raw === 'number') {
    const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof raw === 'string') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  return new Date().toISOString();
};

export const fetchModerationActivityPreview = async (
  ctx: { subredditName?: string },
  periodDays: number,
  limit: number,
  includePlatformActions = false
): Promise<ModerationActivityPreview> => {
  const subreddit = getCurrentSubredditName(ctx);
  if (!subreddit) {
    throw new Error('SUBREDDIT_UNAVAILABLE');
  }

  const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const safeLimit = Math.max(1, Math.min(limit, 250));

  try {
    const listing = reddit.getModerationLog({
      subredditName: subreddit,
      limit: safeLimit,
      pageSize: Math.min(100, safeLimit),
    });
    const entries = await listing.all();
    const normalized: ModerationLogAction[] = entries.map((entry, index) => {
      const modAction = entry as ModActionLike;
      const entryRecord = entry as unknown as Record<string, unknown>;
      const createdAt = toIso(
        modAction.createdAt ??
          entryRecord.created_at ??
          entryRecord.created_utc ??
          entryRecord.timestamp
      );
      const idRaw = modAction.id ?? (entryRecord.name as string | undefined);
      const action = normalizeAction(modAction.type ?? (entryRecord.action as string | undefined));
      const moderator = normalizeUsername(
        modAction.moderatorName ??
          (entryRecord.moderator as string | undefined) ??
          (entryRecord.mod as string | undefined)
      );

      const target = (entryRecord.target as Record<string, unknown> | undefined) ?? {};

      return {
        id: idRaw ?? `mod-action-${Date.parse(createdAt)}-${index}`,
        action,
        moderator,
        targetAuthor: normalizeUsername(
          (entryRecord.targetAuthor as string | undefined) ??
            (entryRecord.target_author as string | undefined) ??
            (modAction.target?.author as string | undefined) ??
            (target.author as string | undefined)
        ),
        targetTitle:
          (entryRecord.targetTitle as string | undefined) ??
          (entryRecord.target_title as string | undefined) ??
          (modAction.target?.title as string | undefined) ??
          (target.title as string | undefined),
        targetPermalink:
          (entryRecord.targetPermalink as string | undefined) ??
          (entryRecord.permalink as string | undefined) ??
          (modAction.target?.permalink as string | undefined) ??
          (target.permalink as string | undefined),
        details: modAction.details ?? modAction.description ?? (entryRecord.description as string | undefined),
        createdAt,
      };
    });

    const withinPeriod = normalized
      .filter((entry) => Date.parse(entry.createdAt) >= cutoffMs)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const hiddenPlatformActions = includePlatformActions
      ? 0
      : withinPeriod.filter((entry) => isPlatformAction(entry.action)).length;

    const filtered = includePlatformActions
      ? withinPeriod
      : withinPeriod.filter((entry) => !isPlatformAction(entry.action));

    const grouped = filtered.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.action] = (acc[entry.action] ?? 0) + 1;
      return acc;
    }, {});

    const actionSummary = Object.entries(grouped)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));

    const notes = [
      'This preview is based on recent moderation-log activity.',
      'RuleGap suggestions are still mock-generated until analysis is connected to real actions.',
      includePlatformActions
        ? 'Platform/app actions are included in this preview.'
        : 'Platform/app actions are hidden by default because RuleGap focuses on moderation decisions.',
      'No moderation actions were changed by ModAnchor.',
    ];
    if (filtered.length === 0) {
      notes.push(
        'No content moderation actions were found after filtering platform/app events. Try removing or approving a test post to generate sample activity.'
      );
    }

    return {
      subreddit,
      periodDays,
      generatedAt: new Date().toISOString(),
      totalActions: filtered.length,
      filteredActions: filtered.length,
      hiddenPlatformActions,
      includePlatformActions,
      actionSummary,
      recentActions: filtered.slice(0, 20),
      notes,
    };
  } catch (error) {
    console.error('[modanchor] moderation preview fetch failed', error);
    throw new Error('MODLOG_FETCH_FAILED', { cause: error });
  }
};
