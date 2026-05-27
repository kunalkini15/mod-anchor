import type {
  ModerationActivityPreview,
  ModOnboardReport,
  ModAnchorActionExecutionStatus,
  ModAnchorActionReview,
  ModAnchorMonitoringDigest,
  ModeratorReviewAssignment,
  NewModConfig,
  RuleGapIssue,
  RuleGapReport,
  SeniorModOverride,
  SeniorAccessPolicy,
  SeniorityRuleConfig,
  StoredReport,
  StartReviewRequest,
  UpdateReviewSetupRequest,
} from '../../shared/api';

const REPORT_LIMIT = 20;

const reportsKey = (subreddit: string) => `modanchor:${subreddit}:reports`;
const newModsKey = (subreddit: string) => `modanchor:${subreddit}:newMods`;
const seniorityRuleKey = (subreddit: string) => `modanchor:${subreddit}:seniorityRule`;
const seniorAccessPolicyKey = (subreddit: string) => `modanchor:${subreddit}:seniorAccessPolicy`;
const seniorOverridesKey = (subreddit: string) => `modanchor:${subreddit}:seniorOverrides`;
const modReviewAssignmentsKey = (subreddit: string) => `modanchor:${subreddit}:modReviewAssignments`;
const modActionReviewsKey = (subreddit: string) => `modanchor:${subreddit}:modActionReviews`;
const monitoringDigestsKey = (subreddit: string) => `modanchor:${subreddit}:monitoringDigests`;

const nowIso = () => new Date().toISOString();
const normalizeUsername = (username: string) =>
  username.replace(/^\/?u\//i, '').trim().toLowerCase();
const clampDays = (days: number) => Math.min(90, Math.max(1, Math.floor(days)));
const clampPhase1Days = (days: number) => Math.min(90, Math.max(0, Math.floor(days)));
const addMinutesIso = (iso: string, minutes: number) => {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + Math.max(0, Math.floor(minutes)));
  return date.toISOString();
};
const DEFAULT_SENIORITY_RULE: SeniorityRuleConfig = {
  minModTenureDays: 0,
  minAccountAgeDays: 180,
  minTotalKarma: 1000,
  allowManualSeniorOverride: true,
};
const DEFAULT_SENIOR_ACCESS_POLICY: SeniorAccessPolicy = {
  autoSeniorByRedditPermissions: true,
  strongRedditPermissions: ['everything'],
  allowManualSeniorOverride: true,
};
const normalizeStrongPermissionList = (values: string[] | undefined): string[] => {
  const base = Array.isArray(values) ? values : [];
  const normalized = base.map((value) => value.trim().toLowerCase()).filter(Boolean);
  const hasEverything = normalized.includes('everything');
  return hasEverything ? ['everything'] : ['everything'];
};

type RedisLike = {
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string) => Promise<unknown>;
  del?: (key: string) => Promise<unknown>;
};

const safeParse = <T>(value: string | undefined | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toUtcDateKey = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
const actionTs = (review: ModAnchorActionReview): string => review.executedAt ?? review.decidedAt ?? review.createdAt;

const ACTION_V2_CREATED_INDEX_CAP = 2000;
const ACTION_V2_STATUS_INDEX_CAP = 1000;
const ACTION_V2_ACTOR_INDEX_CAP = 1000;
const ACTION_V2_ACTOR_SET_CAP = 500;
const ACTION_V2_MIGRATION_MARKER_KEY = (subreddit: string) =>
  `modanchor:${subreddit}:migration:v2:actionReviews`;
const actionV2RecordKey = (subreddit: string, actionId: string) =>
  `modanchor:${subreddit}:action:v2:${actionId}`;
const actionV2CreatedIndexKey = (subreddit: string) =>
  `modanchor:${subreddit}:actions:v2:index:created`;
const actionV2StatusIndexKey = (subreddit: string, status: ModAnchorActionExecutionStatus) =>
  `modanchor:${subreddit}:actions:v2:index:status:${status}`;
const actionV2ActorIndexKey = (subreddit: string, actor: string) =>
  `modanchor:${subreddit}:actions:v2:index:actor:${normalizeUsername(actor)}`;
const actionV2ActorsIndexKey = (subreddit: string) =>
  `modanchor:${subreddit}:actions:v2:index:actors`;
const actionReviewSortScore = (review: ModAnchorActionReview): number => {
  const ts = Date.parse(actionTs(review));
  if (Number.isFinite(ts)) return ts;
  return Date.parse(review.createdAt) || 0;
};
const upsertIndexNewestFirst = (ids: string[], id: string, cap: number): string[] =>
  [id, ...ids.filter((entry) => entry !== id)].slice(0, cap);
const removeFromIndex = (ids: string[], id: string): string[] => ids.filter((entry) => entry !== id);
const getActionV2Index = async (
  redisClient: Pick<RedisLike, 'get'>,
  key: string
): Promise<string[]> => safeParse<string[]>(await redisClient.get(key), []);
const setActionV2Index = async (
  redisClient: Pick<RedisLike, 'set'>,
  key: string,
  ids: string[]
): Promise<void> => {
  await redisClient.set(key, JSON.stringify(ids));
};
const touchActionV2MigrationMarker = async (
  redisClient: Pick<RedisLike, 'set'>,
  subreddit: string
): Promise<void> => {
  await redisClient.set(
    ACTION_V2_MIGRATION_MARKER_KEY(subreddit),
    JSON.stringify({
      enabled: true,
      mode: 'dual-read-write-new',
      updatedAt: nowIso(),
    })
  );
};
const addToActorMetaIndex = async (
  redisClient: RedisLike,
  subreddit: string,
  actor: string
): Promise<void> => {
  const key = actionV2ActorsIndexKey(subreddit);
  const existing = await getActionV2Index(redisClient, key);
  const normalized = normalizeUsername(actor);
  const updated = upsertIndexNewestFirst(existing, normalized, ACTION_V2_ACTOR_SET_CAP);
  await setActionV2Index(redisClient, key, updated);
};
const createModAnchorActionReviewV2 = async (
  redisClient: RedisLike,
  subreddit: string,
  review: ModAnchorActionReview
): Promise<void> => {
  await redisClient.set(actionV2RecordKey(subreddit, review.id), JSON.stringify(review));
  await Promise.all([
    (async () => {
      const key = actionV2CreatedIndexKey(subreddit);
      const existing = await getActionV2Index(redisClient, key);
      await setActionV2Index(redisClient, key, upsertIndexNewestFirst(existing, review.id, ACTION_V2_CREATED_INDEX_CAP));
    })(),
    (async () => {
      const key = actionV2StatusIndexKey(subreddit, review.executionStatus);
      const existing = await getActionV2Index(redisClient, key);
      await setActionV2Index(redisClient, key, upsertIndexNewestFirst(existing, review.id, ACTION_V2_STATUS_INDEX_CAP));
    })(),
    (async () => {
      const key = actionV2ActorIndexKey(subreddit, review.actorUsername);
      const existing = await getActionV2Index(redisClient, key);
      await setActionV2Index(redisClient, key, upsertIndexNewestFirst(existing, review.id, ACTION_V2_ACTOR_INDEX_CAP));
    })(),
    addToActorMetaIndex(redisClient, subreddit, review.actorUsername),
    touchActionV2MigrationMarker(redisClient, subreddit),
  ]);
};
const getModAnchorActionReviewByIdV2 = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string,
  actionId: string
): Promise<ModAnchorActionReview | null> =>
  safeParse<ModAnchorActionReview | null>(await redisClient.get(actionV2RecordKey(subreddit, actionId)), null);
const updateModAnchorActionReviewStatusV2 = async (
  redisClient: RedisLike,
  subreddit: string,
  actionReviewId: string,
  status: ModAnchorActionExecutionStatus,
  decidedBy?: string,
  error?: string,
  metadataPatch?: Record<string, unknown>
): Promise<ModAnchorActionReview | null> => {
  const existing = await getModAnchorActionReviewByIdV2(redisClient, subreddit, actionReviewId);
  if (!existing) return null;
  const now = nowIso();
  const updated: ModAnchorActionReview = {
    ...existing,
    executionStatus: status,
    decidedBy: decidedBy ?? existing.decidedBy,
    decidedAt: decidedBy ? now : existing.decidedAt,
    executedAt:
      status === 'approved_executed' || status === 'executed_monitored' || status === 'executed'
        ? now
        : existing.executedAt,
    error: error ?? existing.error,
    metadata: metadataPatch ? { ...(existing.metadata ?? {}), ...metadataPatch } : existing.metadata,
  };
  await redisClient.set(actionV2RecordKey(subreddit, actionReviewId), JSON.stringify(updated));
  if (existing.executionStatus !== status) {
    const prevStatusKey = actionV2StatusIndexKey(subreddit, existing.executionStatus);
    const nextStatusKey = actionV2StatusIndexKey(subreddit, status);
    const [prevIds, nextIds] = await Promise.all([
      getActionV2Index(redisClient, prevStatusKey),
      getActionV2Index(redisClient, nextStatusKey),
    ]);
    await Promise.all([
      setActionV2Index(redisClient, prevStatusKey, removeFromIndex(prevIds, actionReviewId)),
      setActionV2Index(
        redisClient,
        nextStatusKey,
        upsertIndexNewestFirst(nextIds, actionReviewId, ACTION_V2_STATUS_INDEX_CAP)
      ),
    ]);
  }
  return updated;
};
const getModAnchorActionReviewsV2 = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<ModAnchorActionReview[]> => {
  const ids = await getActionV2Index(redisClient, actionV2CreatedIndexKey(subreddit));
  if (ids.length === 0) return [];
  const records = await Promise.all(ids.map((id) => getModAnchorActionReviewByIdV2(redisClient, subreddit, id)));
  return records.filter((entry): entry is ModAnchorActionReview => Boolean(entry));
};
const getLegacyModAnchorActionReviews = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<ModAnchorActionReview[]> =>
  safeParse<ModAnchorActionReview[]>(await redisClient.get(modActionReviewsKey(subreddit)), []);
const getMergedModAnchorActionReviews = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<ModAnchorActionReview[]> => {
  const [v2, legacy] = await Promise.all([
    getModAnchorActionReviewsV2(redisClient, subreddit),
    getLegacyModAnchorActionReviews(redisClient, subreddit),
  ]);
  const dedup = new Map<string, ModAnchorActionReview>();
  for (const review of [...v2, ...legacy]) {
    if (!review?.id) continue;
    if (!dedup.has(review.id)) dedup.set(review.id, review);
  }
  return [...dedup.values()].sort((a, b) => {
    const delta = actionReviewSortScore(b) - actionReviewSortScore(a);
    if (delta !== 0) return delta;
    return b.id.localeCompare(a.id);
  });
};

type ActionReviewPageOptions = {
  status?: string;
  actor?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
};

const parsePageLimit = (raw: number | undefined, fallback = 25, max = 100): number => {
  const value = Number.isFinite(raw) ? Number(raw) : fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
};

const parsePageOffset = (raw: string | undefined): number => {
  const parsed = Number(raw ?? '0');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export const getModAnchorActionReviewsPage = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string,
  options: ActionReviewPageOptions
): Promise<{ items: ModAnchorActionReview[]; nextCursor: string | null; hasMore: boolean; total: number }> => {
  const limit = parsePageLimit(options.limit, 25, 100);
  const offset = parsePageOffset(options.cursor);
  const normalizedActor = options.actor ? normalizeUsername(options.actor).toLowerCase() : '';
  const status = options.status?.trim();
  const fromMs = options.dateFrom ? new Date(options.dateFrom).getTime() : Number.NEGATIVE_INFINITY;
  const toMs = options.dateTo ? new Date(options.dateTo).getTime() : Number.POSITIVE_INFINITY;

  const selectedIndexKey = status
    ? actionV2StatusIndexKey(subreddit, status as ModAnchorActionExecutionStatus)
    : normalizedActor
      ? actionV2ActorIndexKey(subreddit, normalizedActor)
      : actionV2CreatedIndexKey(subreddit);

  const v2Ids = await getActionV2Index(redisClient, selectedIndexKey);
  const v2Records = await Promise.all(v2Ids.map((id) => getModAnchorActionReviewByIdV2(redisClient, subreddit, id)));
  const filteredV2 = v2Records
    .filter((entry): entry is ModAnchorActionReview => Boolean(entry))
    .filter((review) => !status || review.executionStatus === status)
    .filter(
      (review) =>
        !normalizedActor || normalizeUsername(review.actorUsername).toLowerCase() === normalizedActor
    )
    .filter((review) => {
      const t = actionReviewSortScore(review);
      return t >= fromMs && t <= toMs;
    });

  const legacy = (await getLegacyModAnchorActionReviews(redisClient, subreddit))
    .filter((review) => !status || review.executionStatus === status)
    .filter(
      (review) =>
        !normalizedActor || normalizeUsername(review.actorUsername).toLowerCase() === normalizedActor
    )
    .filter((review) => {
      const t = actionReviewSortScore(review);
      return t >= fromMs && t <= toMs;
    });

  const mergedById = new Map<string, ModAnchorActionReview>();
  for (const review of [...filteredV2, ...legacy]) {
    if (!review?.id || mergedById.has(review.id)) continue;
    mergedById.set(review.id, review);
  }
  const merged = [...mergedById.values()].sort((a, b) => {
    const delta = actionReviewSortScore(b) - actionReviewSortScore(a);
    if (delta !== 0) return delta;
    return b.id.localeCompare(a.id);
  });
  const items = merged.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < merged.length ? String(nextOffset) : null,
    hasMore: nextOffset < merged.length,
    total: merged.length,
  };
};

export const normalizeStoredReports = (
  reports: StoredReport[],
  subreddit: string
): StoredReport[] =>
  reports.map((report, index) => {
    const id = typeof report.id === 'string' && report.id.trim()
      ? report.id
      : `legacy:${(report as { reportType?: string }).reportType ?? report.type}:${(report as { username?: string }).username ?? 'unknown'}:${(report as { generatedAt?: string }).generatedAt ?? 'unknown'}:${subreddit}:${index}`;
    return { ...report, id };
  });

export const generateMockRuleGapReport = (
  subreddit: string,
  periodDays: number
): RuleGapReport => {
  const id = `rg-${Date.now()}`;
  return {
    id,
    type: 'rulegap',
    subreddit,
    generatedAt: nowIso(),
    periodDays,
    summary:
      'Recent moderation patterns suggest recurring confusion around promotions, off-topic boundaries, and removal messaging clarity.',
    issues: [
      {
        id: `${id}-1`,
        title: 'Referral links are often posted without clear context',
        relatedRule: 'Self-promotion / Referral Policy',
        severity: 'high',
        frequency: 12,
        pattern:
          'Users frequently share links that look helpful but include referral tracking or self-promotional framing.',
        exampleSnippets: [
          'Is this tool okay? It helped me save fees: [link]',
          'My setup guide includes partner links, hope this helps.',
        ],
        suggestedWikiUpdate:
          'Add a dedicated section clarifying acceptable educational links vs referral/self-promotional links, with two concrete examples.',
        suggestedSavedResponse:
          'Thanks for contributing. We removed this post because referral/promotional links are restricted under Rule X. Please repost without referral links and include neutral context.',
      },
      {
        id: `${id}-2`,
        title: 'Borderline off-topic posts repeatedly reach review queue',
        relatedRule: 'On-topic Scope',
        severity: 'medium',
        frequency: 9,
        pattern:
          'Posts loosely tied to the subreddit theme pass initial review but trigger later removals after user reports.',
        exampleSnippets: [
          'Not exactly about this subreddit, but maybe relevant to everyone here?',
          'General lifehack thread - sharing this for visibility.',
        ],
        suggestedWikiUpdate:
          'Clarify in-scope vs out-of-scope topics with a short checklist moderators and users can reference quickly.',
        suggestedSavedResponse:
          'This was removed as off-topic for this community. Please check the On-topic section in our rules and resubmit with subreddit-specific relevance.',
      },
      {
        id: `${id}-3`,
        title: 'Removal explanations vary by moderator and reduce consistency',
        relatedRule: 'Removal Messaging Expectations',
        severity: 'medium',
        frequency: 7,
        pattern:
          'Similar removals receive different levels of detail, creating confusion and repeat questions in modmail.',
        exampleSnippets: [
          'Removed - rule violation.',
          'Post removed, check rules.',
        ],
        suggestedWikiUpdate:
          'Add a short moderator-facing template guide for removal reasons, including minimum explanation standards.',
        suggestedSavedResponse:
          'We removed this under Rule X. Key reason: [one sentence]. If you edit and resubmit within scope, we can re-review.',
      },
    ],
  };
};

const hasTextTrigger = (preview: ModerationActivityPreview, terms: string[]): boolean => {
  const haystack = preview.recentActions
    .map((a) => `${a.targetTitle ?? ''} ${a.details ?? ''}`.toLowerCase())
    .join(' ');
  return terms.some((term) => haystack.includes(term));
};

const hasUsableActivityPreview = (
  preview?: ModerationActivityPreview | null
): boolean => {
  if (!preview) return false;

  const hasTotalActions =
    typeof preview.totalActions === 'number' && preview.totalActions > 0;

  const hasRecentActions =
    Array.isArray(preview.recentActions) && preview.recentActions.length > 0;

  const hasActionSummary =
    Array.isArray(preview.actionSummary) &&
    preview.actionSummary.some(
      (item) => typeof item.count === 'number' && item.count > 0
    );

  return hasTotalActions || hasRecentActions || hasActionSummary;
};

export const generateRuleGapReportFromActivity = (
  subreddit: string,
  periodDays: number,
  preview?: ModerationActivityPreview
): RuleGapReport => {
  if (!hasUsableActivityPreview(preview)) {
    const fallback = generateMockRuleGapReport(subreddit, periodDays);
    return {
      ...fallback,
      source: 'mock_demo',
      summary:
        'Deterministic MVP analysis is using demo suggestions because no loaded moderation activity preview was available.',
    };
  }

  if (!preview) {
    const fallback = generateMockRuleGapReport(subreddit, periodDays);
    return {
      ...fallback,
      source: 'mock_demo',
      summary:
        'Deterministic MVP analysis is using demo suggestions because no loaded moderation activity preview was available.',
    };
  }

  const id = `rg-${Date.now()}`;
  const usablePreview = preview;
  const counts = new Map(usablePreview.actionSummary.map((a) => [a.action, a.count]));
  const issues: RuleGapIssue[] = [];
  const addIssue = (issue: RuleGapIssue) => {
    if (!issues.some((i) => i.title === issue.title)) issues.push(issue);
  };

  const removals =
    (counts.get('removelink') ?? 0) +
    (counts.get('removecomment') ?? 0) +
    (counts.get('spamlink') ?? 0) +
    (counts.get('spamcomment') ?? 0);
  const removalReasons = counts.get('addremovalreason') ?? 0;
  if (removals > 0 && removalReasons < removals) {
    const highSeverity = removals >= 10 && removalReasons < removals * 0.5;
    addIssue({
      id: `${id}-1`,
      title: 'Removal explanations may need shared guidance',
      relatedRule: 'Removal Messaging / User Expectations',
      severity: highSeverity ? 'high' : 'medium',
      frequency: removals,
      pattern:
        'Recent moderation activity suggests removals are happening more often than removal-reason actions. This may create repeat questions or appeals from users.',
      exampleSnippets: preview.recentActions.slice(0, 2).map((a) => a.targetTitle ?? a.details ?? a.action),
      suggestedWikiUpdate:
        'Add a short moderator-facing guide for when removal explanations are expected, including examples for common rule categories.',
      suggestedSavedResponse:
        "Your post/comment was removed because it does not meet this community's rules. Please review the relevant rule and resubmit with the required context if applicable.",
    });
  }

  if (
    hasTextTrigger(usablePreview, ['off topic', 'off-topic', 'not relevant', 'unrelated', 'general', 'scope']) ||
    removals > 0
  ) {
    addIssue({
      id: `${id}-2`,
      title: 'Community scope may need clearer examples',
      relatedRule: 'On-topic Scope',
      severity: 'medium',
      frequency: Math.max(removals, 1),
      pattern:
        "Recent moderation activity suggests some content may be removed because it sits near the boundary of the community's scope.",
      exampleSnippets: usablePreview.recentActions.slice(0, 2).map((a) => a.targetTitle ?? a.details ?? a.action),
      suggestedWikiUpdate:
        'Add examples of in-scope and out-of-scope posts so users and newer moderators can quickly check borderline cases.',
      suggestedSavedResponse:
        'This was removed as off-topic for this community. Please review the community scope before reposting.',
    });
  }

  const linkSpamSignals =
    (counts.get('spamlink') ?? 0) +
    (counts.get('removelink') ?? 0) +
    (counts.get('approvelink') ?? 0);
  if (
    linkSpamSignals > 0 ||
    hasTextTrigger(usablePreview, ['link', 'referral', 'promo', 'promotion', 'affiliate', 'self-promotion', 'spam'])
  ) {
    addIssue({
      id: `${id}-3`,
      title: 'Link and promotion rules may need clearer boundaries',
      relatedRule: 'Self-promotion / Referral Policy',
      severity: linkSpamSignals >= 10 ? 'high' : 'medium',
      frequency: Math.max(linkSpamSignals, 1),
      pattern:
        'Recent moderation activity includes link removals or promotion-like content, which often benefits from explicit examples.',
      exampleSnippets: usablePreview.recentActions.slice(0, 2).map((a) => a.targetTitle ?? a.details ?? a.action),
      suggestedWikiUpdate:
        'Clarify which links are allowed, which referral or affiliate links are not allowed, and when educational links need additional context.',
      suggestedSavedResponse:
        'This was removed because promotional, referral, or insufficiently contextual links are restricted here. Please repost only if it adds clear community value and follows the link policy.',
    });
  }

  const onboardingSignals =
    (counts.get('invitemoderator') ?? 0) +
    (counts.get('acceptmoderatorinvite') ?? 0) +
    (counts.get('wikirevise') ?? 0);
  if (onboardingSignals > 0) {
    addIssue({
      id: `${id}-4`,
      title: 'Recent team activity may benefit from onboarding reminders',
      relatedRule: 'Moderator Onboarding',
      severity: 'low',
      frequency: onboardingSignals,
      pattern:
        'Recent moderator invite or wiki activity suggests this may be a good time to review onboarding materials and shared moderation expectations.',
      exampleSnippets: usablePreview.recentActions.slice(0, 2).map((a) => a.targetTitle ?? a.details ?? a.action),
      suggestedWikiUpdate:
        'Maintain a short onboarding checklist for new moderators covering common removal categories, escalation paths, and when to ask for a second opinion.',
      suggestedSavedResponse:
        'Internal note: Review this action against the onboarding checklist and update examples if this case is likely to repeat.',
    });
  }

  const approvals = (counts.get('approvelink') ?? 0) + (counts.get('approvecomment') ?? 0);
  if (approvals > 0 && removals > 0) {
    addIssue({
      id: `${id}-5`,
      title: 'Approval and removal decisions may need shared examples',
      relatedRule: 'Decision Consistency',
      severity: 'medium',
      frequency: approvals + removals,
      pattern:
        'Recent activity may indicate normal queue review or borderline cases where both approvals and removals could benefit from shared examples.',
      exampleSnippets: usablePreview.recentActions.slice(0, 2).map((a) => a.targetTitle ?? a.details ?? a.action),
      suggestedWikiUpdate:
        'Add examples of posts that should be approved versus removed for the most common borderline categories.',
      suggestedSavedResponse:
        "This decision follows the community's current interpretation of the relevant rule. If you edit the content to better match the rule, moderators can review it again.",
    });
  }

  if (issues.length === 0) {
    addIssue({
      id: `${id}-fallback`,
      title: 'Recent moderation activity should be reviewed for recurring patterns',
      relatedRule: 'General Moderation Consistency',
      severity: 'low',
      frequency: usablePreview.totalActions,
      pattern:
        'Recent moderation activity was found, but no strong repeated rule-gap pattern was detected by the deterministic MVP analyzer.',
      exampleSnippets: usablePreview.recentActions.slice(0, 2).map((a) => a.targetTitle ?? a.details ?? a.action),
      suggestedWikiUpdate:
        'Review the latest moderation actions during the next mod check-in and add examples for any repeated edge cases.',
      suggestedSavedResponse:
        'Thanks for contributing. This moderation action was based on the community rules. Please review the rules before reposting.',
    });
  }

  return {
    id,
    type: 'rulegap',
    subreddit,
    generatedAt: nowIso(),
    periodDays,
    summary:
      'Deterministic MVP analysis generated pattern suggestions based on loaded moderation activity. Review suggestions before applying any policy or response changes.',
    issues,
    source: 'real_activity',
    sourceSummary: {
      totalActions:
        typeof usablePreview.totalActions === 'number'
          ? usablePreview.totalActions
          : usablePreview.recentActions?.length ?? 0,
      actionTypes: usablePreview.actionSummary?.length ?? 0,
      hiddenPlatformActions: usablePreview.hiddenPlatformActions ?? 0,
      recentSamples: usablePreview.recentActions?.length ?? 0,
    },
  };
};

export const generateMockModOnboardReport = (
  subreddit: string,
  username: string,
  periodDays: number
): ModOnboardReport => {
  const cleanUsername = normalizeUsername(username);
  return {
    id: `mo-${Date.now()}`,
    type: 'modonboard',
    subreddit,
    username: cleanUsername,
    generatedAt: nowIso(),
    periodDays,
    summary:
      'This onboarding snapshot highlights early moderation activity and coaching suggestions to help with consistency and confidence.',
    actionSummary: {
      removals: 18,
      approvals: 11,
      bans: 2,
      comments: 14,
    },
    focusAreas: [
      'Use more consistent removal explanations for repeat rule categories.',
      'Double-check off-topic decisions against the shared scope checklist.',
      'Use saved responses for high-frequency user questions to reduce reply time.',
    ],
    recommendations: [
      {
        id: 'rec-1',
        title: 'Coaching pass on removal notes',
        detail:
          'A short review of 5 recent removals can help align explanation style with team norms.',
        suggestedAction:
          'Schedule a 15-minute peer review and align on one reusable response template.',
      },
      {
        id: 'rec-2',
        title: 'Rule boundary review reminder',
        detail:
          'A few actions suggest uncertainty around boundary cases for on-topic content.',
        suggestedAction:
          'Review the on-topic examples in mod wiki and flag unclear cases for team discussion.',
      },
    ],
  };
};

export const saveReport = async (
  redisClient: RedisLike,
  subreddit: string,
  report: StoredReport
): Promise<void> => {
  const key = reportsKey(subreddit);
  const existing = normalizeStoredReports(
    safeParse<StoredReport[]>(await redisClient.get(key), []),
    subreddit
  );
  const updated = normalizeStoredReports([report, ...existing], subreddit).slice(0, REPORT_LIMIT);
  await redisClient.set(key, JSON.stringify(updated));
};

export const getReports = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<StoredReport[]> => {
  const key = reportsKey(subreddit);
  const raw = safeParse<StoredReport[]>(await redisClient.get(key), []);
  const normalized = normalizeStoredReports(raw, subreddit);
  return normalized;
};

export const saveReports = async (
  redisClient: Pick<RedisLike, 'set'>,
  subreddit: string,
  reports: StoredReport[]
): Promise<void> => {
  const key = reportsKey(subreddit);
  await redisClient.set(key, JSON.stringify(reports.slice(0, REPORT_LIMIT)));
};

export const buildModOnboardReport = (input: {
  subreddit: string;
  username: string;
  assignment: ModeratorReviewAssignment;
  actionReviews: ModAnchorActionReview[];
  generatedAtIso: string;
  reportType: 'manual' | 'final_review';
  reportId: string;
}): ModOnboardReport => {
  const { subreddit, username, assignment, actionReviews, generatedAtIso, reportType, reportId } = input;
  const startMs = new Date(assignment.assignedAt).getTime();
  const completedLike = assignment.status === 'completed' || assignment.phase === 'graduated';
  const endIso = completedLike ? assignment.expectedPhaseEndAt : generatedAtIso;
  const endMs = new Date(endIso).getTime();
  const filtered = actionReviews
    .filter((r) => normalizeUsername(r.actorUsername) === normalizeUsername(username))
    .filter((r) => {
      const t = new Date(actionTs(r)).getTime();
      return Number.isFinite(t) && t >= startMs && t <= endMs;
    });
  const byStatus = (s: string) => filtered.filter((r) => r.executionStatus === s).length;
  const actionCounts = filtered.reduce<Record<string, number>>((acc, r) => {
    acc[r.actionType] = (acc[r.actionType] ?? 0) + 1;
    return acc;
  }, {});
  const targetCounts = filtered.reduce<Record<string, number>>((acc, r) => {
    acc[r.targetType] = (acc[r.targetType] ?? 0) + 1;
    return acc;
  }, {});
  const totalActions = filtered.length;
  const pendingApproval = byStatus('pending_approval');
  const approvedExecuted = byStatus('approved_executed');
  const rejected = byStatus('rejected');
  const executedMonitored = byStatus('executed_monitored');
  const executed = byStatus('executed');
  const failed = byStatus('failed');
  const focusAreas: string[] = [];
  const recommendations: ModOnboardReport['recommendations'] = [];
  if (rejected > 0) {
    focusAreas.push('Review rejected actions and align decision criteria.');
    recommendations.push({ id: 'rejected', title: 'Rejected actions', detail: `Rejected actions: ${rejected}`, suggestedAction: 'Coach on rejected action examples.' });
  }
  if (failed > 0) {
    focusAreas.push('Investigate failed actions and permission/API issues.');
    recommendations.push({ id: 'failed', title: 'Failed actions', detail: `Failed actions: ${failed}`, suggestedAction: 'Review failure reasons and retry path.' });
  }
  if (executedMonitored > 0 && failed === 0) {
    recommendations.push({ id: 'monitoring', title: 'Monitoring consistency', detail: 'Monitored actions executed with low failure.', suggestedAction: 'Continue monitored coaching cadence.' });
  }
  if (totalActions === 0) {
    focusAreas.push('No ModAnchor actions recorded in this review window.');
    recommendations.push({ id: 'no-actions', title: 'No actions recorded', detail: 'No evidence captured for this review period.', suggestedAction: 'Extend review or request low-risk actions.' });
  }
  const reportTitle = reportType === 'final_review'
    ? `Final review report — u/${username} — ${toUtcDateKey(generatedAtIso)} UTC`
    : `Review report — u/${username} — ${toUtcDateKey(generatedAtIso)} UTC`;
  return {
    id: reportId,
    type: 'modonboard',
    subreddit,
    username,
    generatedAt: generatedAtIso,
    periodDays: Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000))),
    periodStart: new Date(startMs).toISOString(),
    periodEnd: new Date(endMs).toISOString(),
    reviewPhase: assignment.phase,
    reviewStatus: assignment.status,
    summary: reportTitle,
    actionSummary: {
      removals: (actionCounts.remove_post ?? 0) + (actionCounts.remove_post_spam ?? 0) + (actionCounts.remove_comment ?? 0) + (actionCounts.remove_comment_spam ?? 0),
      approvals: (actionCounts.approve_post ?? 0) + (actionCounts.approve_comment ?? 0),
      bans: (actionCounts.ban_user ?? 0),
      comments: (actionCounts.add_mod_note ?? 0),
    },
    focusAreas,
    recommendations,
    actionCounts: { ...actionCounts, ...Object.fromEntries(Object.entries(targetCounts).map(([k, v]) => [`target_${k}`, v])) },
    metrics: { totalActions, pendingApproval, approvedExecuted, rejected, executedMonitored, executed, failed },
    recentActions: filtered
      .slice()
      .sort((a, b) => new Date(actionTs(b)).getTime() - new Date(actionTs(a)).getTime())
      .slice(0, 10)
      .map((a) => ({
        id: a.id,
        createdAt: actionTs(a),
        actionType: a.actionType,
        friendlyAction: a.actionType.replaceAll('_', ' '),
        targetType: a.targetType,
        targetId: a.targetId,
        executionStatus: a.executionStatus,
        friendlyStatus: a.executionStatus.replaceAll('_', ' '),
        reason: a.reason,
        removalNote: typeof a.metadata?.removalNote === 'string' ? a.metadata.removalNote : typeof a.metadata?.modNote === 'string' ? a.metadata.modNote : undefined,
        targetTitle: typeof a.metadata?.title === 'string' ? a.metadata.title : undefined,
        targetSnippet: typeof a.metadata?.bodySnippet === 'string' ? a.metadata.bodySnippet : undefined,
        targetAuthor: typeof a.metadata?.authorName === 'string' ? a.metadata.authorName : undefined,
        targetPermalink: typeof a.metadata?.permalink === 'string' ? a.metadata.permalink : undefined,
        parentPostTitle: typeof a.metadata?.parentPostTitle === 'string' ? a.metadata.parentPostTitle : undefined,
      })),
    nativeActionSummary: {
      totalCount: 0,
      breakdown: {},
      note: 'Native Reddit action tracking was not available for this report.',
    },
  };
};

export const getNewMods = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<NewModConfig[]> => {
  const key = newModsKey(subreddit);
  return safeParse<NewModConfig[]>(await redisClient.get(key), []);
};

export const addNewMod = async (
  redisClient: RedisLike,
  subreddit: string,
  username: string,
  reviewPeriodDays: number
): Promise<NewModConfig[]> => {
  const key = newModsKey(subreddit);
  const existing = safeParse<NewModConfig[]>(await redisClient.get(key), []);
  const normalized = normalizeUsername(username);
  const deduped = existing.filter((m) => normalizeUsername(m.username) !== normalized);
  const next: NewModConfig = {
    username: normalized,
    addedAt: nowIso(),
    reviewPeriodDays,
    status: 'active',
  };
  const updated = [next, ...deduped];
  await redisClient.set(key, JSON.stringify(updated));
  return updated;
};

export const completeNewMod = async (
  redisClient: RedisLike,
  subreddit: string,
  username: string
): Promise<NewModConfig[]> => {
  const key = newModsKey(subreddit);
  const existing = safeParse<NewModConfig[]>(await redisClient.get(key), []);
  const normalized = normalizeUsername(username);
  const updated = existing.map((mod) =>
    normalizeUsername(mod.username) === normalized ? { ...mod, status: 'completed' as const } : mod
  );
  await redisClient.set(key, JSON.stringify(updated));
  return updated;
};

export const getSeniorityRule = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<SeniorityRuleConfig> => {
  const stored = safeParse<Partial<SeniorityRuleConfig>>(
    await redisClient.get(seniorityRuleKey(subreddit)),
    {}
  );
  return {
    ...DEFAULT_SENIORITY_RULE,
    ...stored,
  };
};

export const getSeniorAccessPolicy = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<SeniorAccessPolicy> => {
  const direct = safeParse<Partial<SeniorAccessPolicy>>(
    await redisClient.get(seniorAccessPolicyKey(subreddit)),
    {}
  );
  if (Object.keys(direct).length > 0) {
    return {
      ...DEFAULT_SENIOR_ACCESS_POLICY,
      ...direct,
      strongRedditPermissions:
        Array.isArray(direct.strongRedditPermissions) && direct.strongRedditPermissions.length > 0
          ? normalizeStrongPermissionList(direct.strongRedditPermissions)
          : normalizeStrongPermissionList(DEFAULT_SENIOR_ACCESS_POLICY.strongRedditPermissions),
    };
  }
  const legacy = await getSeniorityRule(redisClient, subreddit);
  return {
    autoSeniorByRedditPermissions: true,
    strongRedditPermissions: normalizeStrongPermissionList(DEFAULT_SENIOR_ACCESS_POLICY.strongRedditPermissions),
    allowManualSeniorOverride: legacy.allowManualSeniorOverride,
    updatedAt: legacy.updatedAt,
    updatedBy: legacy.updatedBy,
  };
};

export const saveSeniorAccessPolicy = async (
  redisClient: RedisLike,
  subreddit: string,
  policy: SeniorAccessPolicy
): Promise<SeniorAccessPolicy> => {
  const next: SeniorAccessPolicy = {
    autoSeniorByRedditPermissions: policy.autoSeniorByRedditPermissions !== false,
    strongRedditPermissions:
      Array.isArray(policy.strongRedditPermissions) && policy.strongRedditPermissions.length > 0
        ? normalizeStrongPermissionList(policy.strongRedditPermissions)
        : normalizeStrongPermissionList(DEFAULT_SENIOR_ACCESS_POLICY.strongRedditPermissions),
    allowManualSeniorOverride: policy.allowManualSeniorOverride !== false,
    updatedAt: policy.updatedAt ?? nowIso(),
    updatedBy: policy.updatedBy,
  };
  await redisClient.set(seniorAccessPolicyKey(subreddit), JSON.stringify(next));
  return next;
};

export const saveSeniorityRule = async (
  redisClient: RedisLike,
  subreddit: string,
  config: SeniorityRuleConfig
): Promise<SeniorityRuleConfig> => {
  const next: SeniorityRuleConfig = {
    minModTenureDays: clampDays(config.minModTenureDays),
    minAccountAgeDays: clampDays(config.minAccountAgeDays),
    minTotalKarma: Math.max(0, Math.floor(config.minTotalKarma)),
    allowManualSeniorOverride: config.allowManualSeniorOverride !== false,
    updatedAt: config.updatedAt ?? nowIso(),
    updatedBy: config.updatedBy,
  };
  await redisClient.set(seniorityRuleKey(subreddit), JSON.stringify(next));
  return next;
};

export const getSeniorOverrides = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<SeniorModOverride[]> =>
  safeParse<SeniorModOverride[]>(await redisClient.get(seniorOverridesKey(subreddit)), []);

export const addSeniorOverride = async (
  redisClient: RedisLike,
  subreddit: string,
  username: string,
  assignedBy?: string
): Promise<SeniorModOverride[]> => {
  const existing = await getSeniorOverrides(redisClient, subreddit);
  const normalized = normalizeUsername(username);
  const deduped = existing.filter((entry) => normalizeUsername(entry.username) !== normalized);
  const updated: SeniorModOverride[] = [
    { username: normalized, assignedAt: nowIso(), assignedBy },
    ...deduped,
  ];
  await redisClient.set(seniorOverridesKey(subreddit), JSON.stringify(updated));
  return updated;
};

export const removeSeniorOverride = async (
  redisClient: RedisLike,
  subreddit: string,
  username: string
): Promise<SeniorModOverride[]> => {
  const existing = await getSeniorOverrides(redisClient, subreddit);
  const normalized = normalizeUsername(username);
  const updated = existing.filter((entry) => normalizeUsername(entry.username) !== normalized);
  await redisClient.set(seniorOverridesKey(subreddit), JSON.stringify(updated));
  return updated;
};

export const getReviewAssignments = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<ModeratorReviewAssignment[]> =>
  safeParse<ModeratorReviewAssignment[]>(
    await redisClient.get(modReviewAssignmentsKey(subreddit)),
    []
  );

export const advanceExpiredReviewPhases = async (
  redisClient: RedisLike,
  subreddit: string
): Promise<ModeratorReviewAssignment[]> => {
  const existing = await getReviewAssignments(redisClient, subreddit);
  const nowMs = Date.now();
  let changed = false;
  const updated = existing.map((entry) => {
    if (entry.status !== 'active') return entry;
    const dueAtMs = new Date(entry.expectedPhaseEndAt).getTime();
    if (!Number.isFinite(dueAtMs) || dueAtMs > nowMs) return entry;
    const now = nowIso();
    if (entry.phase === 'approval_required') {
      changed = true;
      const monitoringMinutes = typeof entry.phase2DurationMinutes === 'number'
        ? Math.max(1, Math.floor(entry.phase2DurationMinutes))
        : clampDays(entry.phase2Days) * 24 * 60;
      return {
        ...entry,
        phase: 'monitored_actions' as const,
        phaseStartedAt: now,
        expectedPhaseEndAt: addMinutesIso(now, monitoringMinutes),
      };
    }
    if (entry.phase === 'monitored_actions') {
      changed = true;
      if (entry.autoGraduate) {
        return {
          ...entry,
          phase: 'graduated' as const,
          status: 'completed' as const,
          phaseStartedAt: now,
          expectedPhaseEndAt: now,
        };
      }
      return {
        ...entry,
        phase: 'ready_for_graduation' as const,
        phaseStartedAt: now,
        expectedPhaseEndAt: now,
      };
    }
    return entry;
  });
  if (changed) {
    await redisClient.set(modReviewAssignmentsKey(subreddit), JSON.stringify(updated));
  }
  return updated;
};

export const startReviewAssignment = async (
  redisClient: RedisLike,
  subreddit: string,
  request: StartReviewRequest,
  assignedBy?: string
): Promise<ModeratorReviewAssignment[]> => {
  const existing = await getReviewAssignments(redisClient, subreddit);
  const username = normalizeUsername(request.username);
  const phase1Days = clampPhase1Days(request.phase1Days);
  const phase2Days = clampDays(request.phase2Days);
  const phase1DurationMinutes = typeof request.phase1DurationMinutes === 'number'
    ? Math.max(0, Math.floor(request.phase1DurationMinutes))
    : phase1Days * 24 * 60;
  const phase2DurationMinutes = typeof request.phase2DurationMinutes === 'number'
    ? Math.max(1, Math.floor(request.phase2DurationMinutes))
    : phase2Days * 24 * 60;
  const now = nowIso();
  const startsInMonitored = phase1DurationMinutes === 0;
  const next: ModeratorReviewAssignment = {
    username,
    assignedBy,
    assignedAt: now,
    phase: startsInMonitored ? 'monitored_actions' : 'approval_required',
    phaseStartedAt: now,
    expectedPhaseEndAt: addMinutesIso(now, startsInMonitored ? phase2DurationMinutes : phase1DurationMinutes),
    phase1Days,
    phase2Days,
    phase1DurationMinutes,
    phase2DurationMinutes,
    autoGraduate: request.autoGraduate === true,
    reportMode: request.reportMode === 'daily_digest' ? 'daily_digest' : 'per_action',
    status: 'active',
  };
  const updated = [next, ...existing.filter((entry) => normalizeUsername(entry.username) !== username)];
  await redisClient.set(modReviewAssignmentsKey(subreddit), JSON.stringify(updated));
  return updated;
};

export const advanceReviewPhase = async (
  redisClient: RedisLike,
  subreddit: string,
  username: string
): Promise<ModeratorReviewAssignment[]> => {
  const existing = await getReviewAssignments(redisClient, subreddit);
  const normalized = normalizeUsername(username);
  const updated = existing.map((entry) => {
    if (normalizeUsername(entry.username) !== normalized) return entry;
    const now = nowIso();
    if (entry.phase === 'approval_required') {
      const monitoringMinutes = typeof entry.phase2DurationMinutes === 'number'
        ? Math.max(1, Math.floor(entry.phase2DurationMinutes))
        : clampDays(entry.phase2Days) * 24 * 60;
      return {
        ...entry,
        phase: 'monitored_actions' as const,
        phaseStartedAt: now,
        expectedPhaseEndAt: addMinutesIso(now, monitoringMinutes),
      };
    }
    if (entry.phase === 'monitored_actions') {
      return {
        ...entry,
        phase: 'ready_for_graduation' as const,
        phaseStartedAt: now,
        expectedPhaseEndAt: now,
      };
    }
    if (entry.phase === 'ready_for_graduation') {
      return {
        ...entry,
        phase: 'graduated' as const,
        status: 'completed' as const,
        phaseStartedAt: now,
        expectedPhaseEndAt: now,
      };
    }
    return entry;
  });
  await redisClient.set(modReviewAssignmentsKey(subreddit), JSON.stringify(updated));
  return updated;
};

export const completeReviewAssignment = async (
  redisClient: RedisLike,
  subreddit: string,
  username: string
): Promise<ModeratorReviewAssignment[]> => {
  const existing = await getReviewAssignments(redisClient, subreddit);
  const normalized = normalizeUsername(username);
  const now = nowIso();
  const updated = existing.map((entry) =>
    normalizeUsername(entry.username) === normalized
      ? {
          ...entry,
          status: 'completed' as const,
          phase: 'graduated' as const,
          phaseStartedAt: now,
          expectedPhaseEndAt: now,
        }
      : entry
  );
  await redisClient.set(modReviewAssignmentsKey(subreddit), JSON.stringify(updated));
  return updated;
};

export const updateReviewAssignmentSetup = async (
  redisClient: RedisLike,
  subreddit: string,
  request: UpdateReviewSetupRequest
): Promise<ModeratorReviewAssignment[]> => {
  const existing = await getReviewAssignments(redisClient, subreddit);
  const normalized = normalizeUsername(request.username);
  const index = existing.findIndex((entry) => normalizeUsername(entry.username) === normalized);
  if (index < 0) throw new Error('No review assignment found for this moderator.');
  const current = existing[index];
  if (!current || current.status !== 'active' || current.phase === 'graduated') {
    throw new Error('This review is no longer active. Refresh and try again.');
  }
  if (
    typeof request.phase1DurationMinutes !== 'undefined' &&
    (!Number.isInteger(request.phase1DurationMinutes) || request.phase1DurationMinutes < 0)
  ) {
    throw new Error('Approval duration must be an integer >= 0 minutes.');
  }
  if (
    typeof request.phase2DurationMinutes !== 'undefined' &&
    (!Number.isInteger(request.phase2DurationMinutes) || request.phase2DurationMinutes < 1)
  ) {
    throw new Error('Monitoring duration must be an integer >= 1 minute.');
  }
  if (
    typeof request.reportMode !== 'undefined' &&
    request.reportMode !== 'per_action' &&
    request.reportMode !== 'daily_digest'
  ) {
    throw new Error('Invalid monitoring report style.');
  }
  if (typeof request.autoGraduate !== 'undefined' && typeof request.autoGraduate !== 'boolean') {
    throw new Error('autoGraduate must be a boolean.');
  }
  const nextPhase1DurationMinutes =
    typeof request.phase1DurationMinutes === 'number'
      ? request.phase1DurationMinutes
      : typeof current.phase1DurationMinutes === 'number'
        ? Math.max(0, Math.floor(current.phase1DurationMinutes))
        : clampPhase1Days(current.phase1Days) * 24 * 60;
  const nextPhase2DurationMinutes =
    typeof request.phase2DurationMinutes === 'number'
      ? request.phase2DurationMinutes
      : typeof current.phase2DurationMinutes === 'number'
        ? Math.max(1, Math.floor(current.phase2DurationMinutes))
        : clampDays(current.phase2Days) * 24 * 60;
  let nextExpectedPhaseEndAt = current.expectedPhaseEndAt;
  const nextAutoGraduate =
    typeof request.autoGraduate === 'boolean' ? request.autoGraduate : current.autoGraduate === true;
  let nextPhase: ModeratorReviewAssignment['phase'] = current.phase;
  let nextStatus: ModeratorReviewAssignment['status'] = current.status;
  if (current.phase === 'approval_required') {
    nextExpectedPhaseEndAt = addMinutesIso(current.phaseStartedAt, nextPhase1DurationMinutes);
  } else if (current.phase === 'monitored_actions') {
    nextExpectedPhaseEndAt = addMinutesIso(current.phaseStartedAt, nextPhase2DurationMinutes);
  } else if (current.phase === 'ready_for_graduation' && nextAutoGraduate) {
    const now = nowIso();
    nextPhase = 'graduated';
    nextStatus = 'completed';
    nextExpectedPhaseEndAt = now;
  }
  const updatedEntry: ModeratorReviewAssignment = {
    ...current,
    phase1DurationMinutes: nextPhase1DurationMinutes,
    phase2DurationMinutes: nextPhase2DurationMinutes,
    phase1Days: Math.max(0, Math.floor(nextPhase1DurationMinutes / (24 * 60))),
    phase2Days: Math.max(1, Math.floor(nextPhase2DurationMinutes / (24 * 60))),
    reportMode:
      typeof request.reportMode === 'string'
        ? request.reportMode
        : current.reportMode === 'daily_digest'
          ? 'daily_digest'
          : 'per_action',
    autoGraduate: nextAutoGraduate,
    expectedPhaseEndAt: nextExpectedPhaseEndAt,
    phase: nextPhase,
    status: nextStatus,
  };
  const updated = [...existing];
  updated[index] = updatedEntry;
  await redisClient.set(modReviewAssignmentsKey(subreddit), JSON.stringify(updated));
  return updated;
};

export const getModAnchorActionReviews = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<ModAnchorActionReview[]> => getMergedModAnchorActionReviews(redisClient, subreddit);

export const createPendingModAnchorActionReview = async (
  redisClient: RedisLike,
  subreddit: string,
  review: ModAnchorActionReview
): Promise<ModAnchorActionReview[]> => {
  await createModAnchorActionReviewV2(redisClient, subreddit, review);
  return getMergedModAnchorActionReviews(redisClient, subreddit);
};

export const updateModAnchorActionReviewStatus = async (
  redisClient: RedisLike,
  subreddit: string,
  actionReviewId: string,
  status: ModAnchorActionExecutionStatus,
  decidedBy?: string,
  error?: string,
  metadataPatch?: Record<string, unknown>
): Promise<ModAnchorActionReview[]> => {
  const updatedV2 = await updateModAnchorActionReviewStatusV2(
    redisClient,
    subreddit,
    actionReviewId,
    status,
    decidedBy,
    error,
    metadataPatch
  );
  if (updatedV2) {
    return getMergedModAnchorActionReviews(redisClient, subreddit);
  }
  const existingLegacy = await getLegacyModAnchorActionReviews(redisClient, subreddit);
  const now = nowIso();
  let matchedLegacy = false;
  const updatedLegacy = existingLegacy.map((item) => {
    if (item.id !== actionReviewId) return item;
    matchedLegacy = true;
    return {
      ...item,
      executionStatus: status,
      decidedBy: decidedBy ?? item.decidedBy,
      decidedAt: decidedBy ? now : item.decidedAt,
      executedAt:
        status === 'approved_executed' || status === 'executed_monitored' || status === 'executed'
          ? now
          : item.executedAt,
      error: error ?? item.error,
      metadata: metadataPatch ? { ...(item.metadata ?? {}), ...metadataPatch } : item.metadata,
    };
  });
  if (matchedLegacy) {
    await redisClient.set(modActionReviewsKey(subreddit), JSON.stringify(updatedLegacy));
  }
  return getMergedModAnchorActionReviews(redisClient, subreddit);
};

export const getMonitoringDigests = async (
  redisClient: Pick<RedisLike, 'get'>,
  subreddit: string
): Promise<ModAnchorMonitoringDigest[]> =>
  safeParse<ModAnchorMonitoringDigest[]>(await redisClient.get(monitoringDigestsKey(subreddit)), []);

export const saveMonitoringDigests = async (
  redisClient: RedisLike,
  subreddit: string,
  digests: ModAnchorMonitoringDigest[]
): Promise<ModAnchorMonitoringDigest[]> => {
  await redisClient.set(monitoringDigestsKey(subreddit), JSON.stringify(digests));
  return digests;
};

export const resetModAnchorWorkspaceData = async (
  redisClient: Pick<RedisLike, 'set' | 'get'> & Partial<Pick<RedisLike, 'del'>>,
  subreddit: string
): Promise<void> => {
  const createdActionIds = await getActionV2Index(redisClient, actionV2CreatedIndexKey(subreddit));
  const knownStatuses: ModAnchorActionExecutionStatus[] = [
    'pending_approval',
    'approved_executed',
    'rejected',
    'executed_monitored',
    'executed',
    'failed',
  ];
  const knownActors = await getActionV2Index(redisClient, actionV2ActorsIndexKey(subreddit));
  const keysToReset: string[] = [
    actionV2CreatedIndexKey(subreddit),
    actionV2ActorsIndexKey(subreddit),
    ACTION_V2_MIGRATION_MARKER_KEY(subreddit),
    ...knownStatuses.map((status) => actionV2StatusIndexKey(subreddit, status)),
    ...knownActors.map((actor) => actionV2ActorIndexKey(subreddit, actor)),
  ];
  if (redisClient.del) {
    await Promise.all(
      [...createdActionIds.map((id) => actionV2RecordKey(subreddit, id)), ...keysToReset].map((key) =>
        redisClient.del!(key)
      )
    );
  } else {
    await Promise.all(
      [...createdActionIds.map((id) => actionV2RecordKey(subreddit, id)), ...keysToReset].map((key) =>
        redisClient.set(key, JSON.stringify([]))
      )
    );
  }
  await Promise.all([
    redisClient.set(reportsKey(subreddit), JSON.stringify([])),
    redisClient.set(newModsKey(subreddit), JSON.stringify([])),
    redisClient.set(seniorityRuleKey(subreddit), JSON.stringify(DEFAULT_SENIORITY_RULE)),
    redisClient.set(seniorAccessPolicyKey(subreddit), JSON.stringify(DEFAULT_SENIOR_ACCESS_POLICY)),
    redisClient.set(seniorOverridesKey(subreddit), JSON.stringify([])),
    redisClient.set(modReviewAssignmentsKey(subreddit), JSON.stringify([])),
    redisClient.set(modActionReviewsKey(subreddit), JSON.stringify([])),
    redisClient.set(monitoringDigestsKey(subreddit), JSON.stringify([])),
  ]);
};
