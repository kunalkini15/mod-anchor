export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

export type ReportType = 'rulegap' | 'modonboard';

export type ISODateString = string;

export type RuleGapIssue = {
  id: string;
  title: string;
  relatedRule: string;
  severity: 'low' | 'medium' | 'high';
  frequency: number;
  pattern: string;
  exampleSnippets: string[];
  suggestedWikiUpdate: string;
  suggestedSavedResponse: string;
};

export type RuleGapReport = {
  id: string;
  type: 'rulegap';
  subreddit: string;
  generatedAt: ISODateString;
  periodDays: number;
  summary: string;
  issues: RuleGapIssue[];
  source?: 'real_activity' | 'mock_demo';
  sourceSummary?: {
    totalActions?: number;
    actionTypes?: number;
    hiddenPlatformActions?: number;
    recentSamples?: number;
  };
};

export type NewModConfig = {
  username: string;
  addedAt: ISODateString;
  reviewPeriodDays: number;
  status: 'active' | 'completed';
};

export type ModAnchorRole = 'senior' | 'regular' | 'under_review';
export type ModReviewPhase =
  | 'approval_required'
  | 'monitored_actions'
  | 'ready_for_graduation'
  | 'graduated';

export interface SeniorityRuleConfig {
  minModTenureDays: number;
  minAccountAgeDays: number;
  minTotalKarma: number;
  allowManualSeniorOverride: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SeniorAccessPolicy {
  autoSeniorByRedditPermissions: boolean;
  strongRedditPermissions: string[];
  allowManualSeniorOverride: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ModeratorReviewConfig {
  phase1Days: number;
  phase2Days: number;
  phase1DurationMinutes?: number;
  phase2DurationMinutes?: number;
  autoGraduate: boolean;
  reportMode: 'per_action' | 'daily_digest';
}

export interface ModeratorReviewAssignment {
  username: string;
  assignedBy?: string;
  assignedAt: string;
  phase: ModReviewPhase;
  phaseStartedAt: string;
  expectedPhaseEndAt: string;
  phase1Days: number;
  phase2Days: number;
  phase1DurationMinutes?: number;
  phase2DurationMinutes?: number;
  autoGraduate: boolean;
  reportMode: 'per_action' | 'daily_digest';
  status: 'active' | 'completed' | 'paused';
}

export interface SeniorModOverride {
  username: string;
  assignedBy?: string;
  assignedAt: string;
}

export type ModOnboardRecommendation = {
  id: string;
  title: string;
  detail: string;
  suggestedAction: string;
};

export type ModOnboardReport = {
  id: string;
  type: 'modonboard';
  subreddit: string;
  username: string;
  generatedAt: ISODateString;
  periodDays: number;
  summary: string;
  actionSummary: {
    removals: number;
    approvals: number;
    bans: number;
    comments: number;
  };
  focusAreas: string[];
  recommendations: ModOnboardRecommendation[];
  coachingSuggestions?: string[];
  assessment?: {
    status: 'on_track' | 'needs_calibration' | 'insufficient_activity' | 'pending_review' | 'workflow_issue';
    label: string;
    summary: string;
    recommendedNextStep: string;
  };
  decisionMetrics?: {
    approvalRate?: number;
    rejectionRate?: number;
    pendingCount: number;
    failedCount: number;
  };
  periodStart?: ISODateString;
  periodEnd?: ISODateString;
  reviewPhase?: ModReviewPhase | null;
  reviewStatus?: 'active' | 'completed' | 'paused' | null;
  metrics?: {
    totalActions: number;
    pendingApproval: number;
    approvedExecuted: number;
    rejected: number;
    executedMonitored: number;
    executed: number;
    failed: number;
  };
  recentActions?: Array<{
    id: string;
    createdAt: string;
    actionType: string;
    friendlyAction: string;
    targetType: string;
    targetId?: string;
    executionStatus: string;
    friendlyStatus: string;
    reason?: string;
    removalNote?: string;
    removalNoteStatus?: 'not_required' | 'pending' | 'added' | 'failed' | 'unsupported';
    removalNoteError?: string;
    targetTitle?: string;
    targetSnippet?: string;
    targetAuthor?: string;
    targetPermalink?: string;
    parentPostTitle?: string;
  }>;
  actionCounts?: Record<string, number>;
  nativeActionSummary?: {
    totalCount: number;
    breakdown: Record<string, number>;
    note: string;
  };
  nativeActionsRecent?: Array<{
    id: string;
    action: string;
    createdAt: string;
    targetType?: string;
    targetId?: string;
    details?: string;
  }>;
};

export type StoredReport = RuleGapReport | ModOnboardReport;

export type RuleGapReportResponse = {
  report: RuleGapReport;
};

export type RuleGapAnalyzeResponse =
  | {
      report: RuleGapReport;
      preview?: ModerationActivityPreview;
      message?: string;
    }
  | {
      report: null;
      preview?: ModerationActivityPreview;
      message: string;
    };

export type ModOnboardReportResponse = {
  report: ModOnboardReport;
};

export type ReportHistoryResponse = {
  reports: StoredReport[];
};

export type ReportHistoryListItem = {
  id: string;
  type: ReportType;
  title: string;
  username?: string;
  generatedAt: ISODateString;
  periodDays?: number;
  actionCount?: number;
  metrics?: {
    totalActions?: number;
    approvedExecuted?: number;
    executedMonitored?: number;
    rejected?: number;
    failed?: number;
  };
  focusAreasCount?: number;
};

export type PaginatedReportHistoryResponse = {
  items: ReportHistoryListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
};

export type NewModConfigResponse = {
  newMods: NewModConfig[];
};

export type CreateNewModConfigRequest = {
  username: string;
  reviewPeriodDays: number;
};

export type ApiErrorResponse = {
  error: string;
};

export type SubredditModerator = {
  username: string;
  displayName: string;
  isCurrentUser?: boolean;
  modTenureDays?: number | null;
  accountAgeDays?: number | null;
  totalKarma?: number | null;
  linkKarma?: number | null;
  commentKarma?: number | null;
  redditPermissions?: string[];
  isSeniorByRedditPermissions?: boolean;
  modAnchorRole?: ModAnchorRole;
  reviewPhase?: ModReviewPhase | null;
  reviewStatus?: 'active' | 'completed' | 'paused' | null;
  isSeniorByRule?: boolean;
  isSeniorByOverride?: boolean;
  isApprovedUser?: boolean;
};

export type ModeratorListResponse = {
  moderators: SubredditModerator[];
};

export interface SeniorityRuleResponse {
  seniorityRule: SeniorityRuleConfig;
  seniorOverrides: SeniorModOverride[];
}

export interface SeniorAccessPolicyResponse {
  seniorAccessPolicy: SeniorAccessPolicy;
  seniorOverrides: SeniorModOverride[];
}

export interface SaveSeniorAccessPolicyRequest {
  seniorAccessPolicy: SeniorAccessPolicy;
}

export interface SaveSeniorityRuleRequest {
  seniorityRule: SeniorityRuleConfig;
}

export interface SeniorOverrideRequest {
  username: string;
}

export interface StartReviewRequest {
  username: string;
  phase1Days: number;
  phase2Days: number;
  phase1DurationMinutes?: number;
  phase2DurationMinutes?: number;
  autoGraduate?: boolean;
  reportMode?: 'per_action' | 'daily_digest';
}

export interface UpdateReviewSetupRequest {
  username: string;
  phase1DurationMinutes?: number;
  phase2DurationMinutes?: number;
  autoGraduate?: boolean;
  reportMode?: 'per_action' | 'daily_digest';
}

export interface AdvanceReviewPhaseRequest {
  username: string;
}

export interface ReviewAssignmentsResponse {
  reviewAssignments: ModeratorReviewAssignment[];
  message?: string;
  finalReportId?: string;
  finalReportStatus?: 'saved' | 'failed' | 'skipped';
}

export interface ModOnboardAccessResponse {
  currentUsername: string | null;
  isModerator: boolean;
  canViewModOnboard: boolean;
  canUseActionConsole: boolean;
  canManageModOnboard: boolean;
  canApproveActions: boolean;
  canViewReports: boolean;
  isSeniorMod: boolean;
  isUnderReview: boolean;
  reviewPhase?: ModReviewPhase | null;
  reviewStatus?: 'active' | 'completed' | 'paused' | null;
  reason?: string;
}

export type ModAnchorActionTargetType = 'post' | 'comment' | 'user';

export type ModAnchorActionType =
  | 'approve_post'
  | 'remove_post'
  | 'remove_post_spam'
  | 'lock_post'
  | 'unlock_post'
  | 'approve_comment'
  | 'remove_comment'
  | 'remove_comment_spam'
  | 'lock_comment'
  | 'unlock_comment'
  | 'ban_user'
  | 'temp_ban_user'
  | 'unban_user'
  | 'mute_user'
  | 'unmute_user'
  | 'add_mod_note';

export type ModAnchorActionExecutionStatus =
  | 'pending_approval'
  | 'approved_executed'
  | 'rejected'
  | 'executed_monitored'
  | 'executed'
  | 'failed';

export type MonitoringReportMode = 'per_action' | 'daily_digest';
export type ModmailDeliveryStatus = 'not_required' | 'pending' | 'sent' | 'failed';
export interface ModAnchorTargetMetadata {
  [key: string]: unknown;
  title?: string;
  bodySnippet?: string;
  authorName?: string;
  permalink?: string;
  url?: string;
  parentPostTitle?: string;
  removalNote?: string;
  removalNoteStatus?: 'not_required' | 'pending' | 'added' | 'failed' | 'unsupported';
  removalNoteError?: string;
}

export interface ModAnchorActionReview {
  id: string;
  subreddit: string;
  actorUsername: string;
  targetType: ModAnchorActionTargetType;
  targetId?: string;
  targetUsername?: string;
  actionType: ModAnchorActionType;
  reason?: string;
  metadata?: ModAnchorTargetMetadata & Record<string, unknown>;
  reportMode?: MonitoringReportMode;
  modmailDeliveryStatus?: ModmailDeliveryStatus;
  modmailDeliveredAt?: string;
  modmailDeliveryError?: string;
  digestId?: string;
  reviewAssignmentPhase?: ModReviewPhase | null;
  executionStatus: ModAnchorActionExecutionStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  executedAt?: string;
  error?: string;
}

export interface ModAnchorActionReviewsResponse {
  reviews: ModAnchorActionReview[];
}

export interface PaginatedModAnchorActionReviewsResponse {
  items: ModAnchorActionReview[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface MyActionReviewsResponse {
  reviews: ModAnchorActionReview[];
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number;
}

export interface SubmitUserActionRequest {
  targetType: 'user' | 'post' | 'comment';
  targetUsername?: string;
  targetId?: string;
  actionType: ModAnchorActionType;
  reason?: string;
  modNote?: string;
  metadata?: Record<string, unknown>;
}

export interface SubmitUserActionResponse {
  message: string;
  review: ModAnchorActionReview;
}
export interface ActionConsolePostSummary {
  id: string;
  title: string;
  authorName?: string;
  bodySnippet?: string;
  permalink?: string;
  createdAt?: string | number;
}
export interface ActionConsoleCommentSummary {
  id: string;
  bodySnippet: string;
  authorName?: string;
  permalink?: string;
  createdAt?: string | number;
  parentPostId?: string;
  parentPostTitle?: string;
}
export interface ActionConsoleRecentPostsResponse {
  posts: ActionConsolePostSummary[];
}
export interface ActionConsolePostCommentsResponse {
  comments: ActionConsoleCommentSummary[];
}

export interface ModAnchorMonitoringDigest {
  id: string;
  subreddit: string;
  actorUsername: string;
  reviewAssignmentUsername?: string;
  digestDate: string;
  periodStart: string;
  periodEnd: string;
  actionReviewIds: string[];
  totalActions: number;
  actionCounts: Record<string, number>;
  summary: string;
  deliveryStatus: ModmailDeliveryStatus;
  deliveredAt?: string;
  deliveryError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitoringDigestsResponse {
  digests: ModAnchorMonitoringDigest[];
}

export interface PaginatedMonitoringDigestsResponse {
  items: ModAnchorMonitoringDigest[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export type ModerationActionSummary = {
  action: string;
  count: number;
};

export type ModerationLogAction = {
  id: string;
  action: string;
  moderator?: string;
  targetAuthor?: string;
  targetTitle?: string;
  targetPermalink?: string;
  details?: string;
  createdAt: ISODateString;
};

export type ModerationActivityPreview = {
  subreddit: string;
  periodDays: number;
  generatedAt: ISODateString;
  totalActions: number;
  filteredActions?: number;
  hiddenPlatformActions?: number;
  includePlatformActions?: boolean;
  actionSummary: ModerationActionSummary[];
  recentActions: ModerationLogAction[];
  notes: string[];
};

export type ModerationActivityPreviewResponse = {
  preview: ModerationActivityPreview;
};

export type GenerateRuleGapReportRequest = {
  periodDays?: number;
  activityPreview?: ModerationActivityPreview;
};

export type SeedScenario =
  | 'removal_messaging_gap'
  | 'self_promotion_links'
  | 'off_topic_scope'
  | 'approval_removal_mix'
  | 'mixed_rulegap_demo';

export type SeedTestActivityRequest = {
  scenario: SeedScenario;
  count?: number;
  confirmation: string;
};

export type SeededItem = {
  title: string;
  permalink?: string;
  action?: string;
  status: 'created' | 'moderated' | 'skipped' | 'failed';
  message?: string;
};

export type SeedTestActivityResponse = {
  scenario: SeedScenario;
  subreddit: string;
  created: number;
  moderated: number;
  skipped: number;
  failed: number;
  items: SeededItem[];
  message: string;
};

export type WikiAnchorSection = {
  id: string;
  title: string;
  text: string;
  category?: 'allowed' | 'restricted' | 'neutral';
};

export type WikiAnchorSource = 'manual' | 'mock' | 'wiki';

export type WikiAnchorIndexSummary = {
  source: WikiAnchorSource;
  indexedAt: string;
  sectionCount: number;
  vocabularySize: number;
};

export type WikiSimilarityMatch = {
  sectionId: string;
  sectionTitle: string;
  category: 'allowed' | 'restricted' | 'neutral';
  score: number;
};

export type PostAlignmentSignal = 'high' | 'medium' | 'low' | 'review';

export type PostAlignmentResult = {
  postId: string;
  title: string;
  bodyPreview?: string;
  permalink?: string;
  score: number;
  signal: PostAlignmentSignal;
  label: string;
  allowedSimilarity: number;
  restrictedSimilarity: number;
  neutralSimilarity: number;
  closestSections: WikiSimilarityMatch[];
  lowContext?: boolean;
  advisory: string;
};

export type ContentAlignmentPreviewRequest = {
  wikiText?: string;
  useMockWiki?: boolean;
  useMockPosts?: boolean;
  sampleSize?: number;
};

export type ContentAlignmentPreviewResponse = {
  source: {
    wikiSource: WikiAnchorSource;
    postSource: 'mock' | 'recent_posts';
    scannedPostCount: number;
  };
  index: WikiAnchorIndexSummary;
  summary: {
    high: number;
    medium: number;
    low: number;
    review: number;
    averageScore: number;
  };
  sections: Array<{
    id: string;
    title: string;
  }>;
  results: PostAlignmentResult[];
  notes: string[];
};

export type ContentAnchorPost = {
  id: string;
  title: string;
  body?: string;
  permalink?: string;
  removed?: boolean;
};

export type RemovedContentPatternSummary = {
  commonTerms: Array<{ term: string; count: number }>;
  commonBigrams: Array<{ term: string; count: number }>;
  commonTrigrams: Array<{ term: string; count: number }>;
  commonDomains: Array<{ term: string; count: number }>;
  lowContextRatio: number;
  linkHeavyRatio: number;
};

export type ContentAnchorSignal = {
  postId: string;
  title: string;
  permalink?: string;
  signal: 'aligned' | 'review' | 'removed_similarity' | 'low_context';
  label: string;
  standardsSimilarity: number;
  removedSimilarity: number;
  closestRemovedTerms: string[];
  advisory: string;
  lowContext?: boolean;
};

export type ContentReviewRequest = {
  standardsText?: string;
  reviewRecentPosts?: boolean;
  includeRemovedPosts?: boolean;
  useMockData?: boolean;
  sampleSize?: number;
};

export type ContentReviewResponse = {
  source: {
    useMockData: boolean;
    scannedPosts: number;
    removedPostsAnalyzed: number;
  };
  standardsText: string;
  removedPatterns: RemovedContentPatternSummary;
  summary: {
    aligned: number;
    needsReview: number;
    similarToRemoved: number;
    lowContext: number;
  };
  posts: ContentAnchorSignal[];
  notes: string[];
};
