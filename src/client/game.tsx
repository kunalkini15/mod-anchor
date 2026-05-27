import './index.css';

import { context, navigateTo } from '@devvit/web/client';
import { StrictMode, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ModOnboardReport,
  ModOnboardReportResponse,
  ModeratorListResponse,
  ReportHistoryResponse,
  PaginatedReportHistoryResponse,
  RuleGapReport,
  SeniorAccessPolicy,
  SeniorAccessPolicyResponse,
  ReviewAssignmentsResponse,
  ModeratorReviewAssignment,
  StartReviewRequest,
  UpdateReviewSetupRequest,
  ModOnboardAccessResponse,
  ModAnchorActionReview,
  ModAnchorActionType,
  ModAnchorTargetMetadata,
  ModAnchorActionReviewsResponse,
  PaginatedModAnchorActionReviewsResponse,
  MyActionReviewsResponse,
  MonitoringDigestsResponse,
  PaginatedMonitoringDigestsResponse,
  ModAnchorMonitoringDigest,
  StoredReport,
  SubredditModerator,
  ActionConsolePostSummary,
  ActionConsoleCommentSummary,
} from '../shared/api';

type Tab = 'modonboard' | 'guide' | 'history';
type ModOnboardSection =
  | 'overview'
  | 'start_review'
  | 'approvals'
  | 'monitoring'
  | 'action_console'
  | 'moderators'
  | 'guide'
  | 'settings';
type ActionConsolePage = 'user' | 'post' | 'comment';
const ACTION_CONSOLE_STATE_KEY = 'modanchor:actionConsoleState:v2';
type ActionConsoleSavedState = Partial<{
  page: ActionConsolePage;
  userTarget: string;
  userActionType: ModAnchorActionType;
  userReason: string;
  userModNote: string;
  postActionType: ModAnchorActionType;
  postSearch: string;
  selectedPost: ActionConsolePostSummary | null;
  postManualOpen: boolean;
  postTargetInput: string;
  postReason: string;
  postRemovalNote: string;
  commentActionType: ModAnchorActionType;
  commentPostSearch: string;
  selectedCommentPost: ActionConsolePostSummary | null;
  commentSearch: string;
  selectedComment: ActionConsoleCommentSummary | null;
  commentManualOpen: boolean;
  commentTargetInput: string;
  commentReason: string;
  commentRemovalNote: string;
}>;
const loadSavedActionConsoleState = (): ActionConsoleSavedState => {
  try {
    const raw = window.localStorage.getItem(ACTION_CONSOLE_STATE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ActionConsoleSavedState;
  } catch {
    return {};
  }
};

const normalizeUserDisplay = (username: string) =>
  username.startsWith('u/') ? username : `u/${username}`;

const normalizeSubredditDisplay = (name: string) =>
  name.startsWith('r/') ? name : `r/${name}`;

const formatDate = (iso: string) => new Date(iso).toLocaleString();
const toUtcDateKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const formatDurationMinutes = (totalMinutes: number) => {
  const safe = Math.max(0, Math.floor(totalMinutes || 0));
  const days = Math.floor(safe / (24 * 60));
  const hours = Math.floor((safe % (24 * 60)) / 60);
  const minutes = safe % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.join(' ');
};
const splitDurationMinutes = (totalMinutes: number): { days: number; hours: number; minutes: number } => {
  const safe = Math.max(0, Math.floor(totalMinutes || 0));
  const days = Math.floor(safe / (24 * 60));
  const hours = Math.floor((safe % (24 * 60)) / 60);
  const minutes = safe % 60;
  return { days, hours, minutes };
};
const toDurationMinutes = (days: number, hours: number, minutes: number): number =>
  Math.max(0, Math.floor(days) * 24 * 60 + Math.floor(hours) * 60 + Math.floor(minutes));
const formatReviewPhase = (phase?: string | null) => {
  if (!phase) return 'None';
  if (phase === 'approval_required') return 'Approval Required';
  if (phase === 'monitored_actions') return 'Monitored Actions';
  if (phase === 'ready_for_graduation') return 'Ready for Graduation';
  if (phase === 'graduated') return 'Graduated';
  return phase.replaceAll('_', ' ');
};
const formatRole = (role?: string | null) => {
  if (role === 'senior') return 'Senior';
  if (role === 'under_review') return 'Under review';
  return 'Regular';
};

const formatActionLabel = (actionType: string) => {
  const labels: Record<string, string> = {
    approve_post: 'Approved post',
    remove_post: 'Removed post',
    remove_post_spam: 'Removed post as spam',
    lock_post: 'Locked post',
    unlock_post: 'Unlocked post',
    approve_comment: 'Approved comment',
    remove_comment: 'Removed comment',
    remove_comment_spam: 'Removed comment as spam',
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
const formatPercent = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
const formatRemovalNoteStatus = (status?: string) => {
  if (status === 'added') return 'Attached via Reddit removal-note API';
  if (status === 'unsupported') return 'Saved in ModAnchor';
  if (status === 'failed') return 'Could not add to Reddit';
  if (status === 'pending') return 'Will be added on approval';
  return undefined;
};
const formatVerificationStatus = (metadata?: ModAnchorTargetMetadata): string | null => {
  const status = typeof metadata?.verificationStatus === 'string' ? metadata.verificationStatus : undefined;
  const source = typeof metadata?.verificationSource === 'string' ? metadata.verificationSource : undefined;
  if (!status) return null;
  if (status === 'confirmed') {
    if (source === 'getBannedUsers') return 'Confirmed in banned users list';
    if (source === 'getModerationLog') return 'Confirmed in moderation log';
    return 'Confirmed';
  }
  if (status === 'not_confirmed') return 'Verification not confirmed yet';
  if (status === 'skipped') return 'Verification skipped';
  if (status === 'failed') return 'Verification failed';
  return null;
};
const toAbsoluteRedditUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `https://www.reddit.com${trimmed}`;
  if (trimmed.startsWith('r/')) return `https://www.reddit.com/${trimmed}`;
  return undefined;
};
const truncateText = (value: string, max = 200) =>
  value.length > max ? `${value.slice(0, max)}…` : value;
const openLinkInNewTabOnNormalClick = (
  event: MouseEvent<HTMLAnchorElement>,
  url?: string
) => {
  event.stopPropagation();
  if (!url) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  navigateTo({ url });
};
const getTargetContext = (
  targetType: string,
  targetId: string | undefined,
  metadata?: ModAnchorTargetMetadata
) => {
  if (targetType === 'post') {
    return {
      primaryLabel: metadata?.title ? `Post: ${metadata.title}` : `Post: ${targetId ?? 'unknown'}`,
      snippet: metadata?.bodySnippet,
      author: metadata?.authorName,
      permalink: toAbsoluteRedditUrl(metadata?.permalink ?? metadata?.url),
      parentPostTitle: undefined,
    };
  }
  if (targetType === 'comment') {
    return {
      primaryLabel: metadata?.bodySnippet ? `Comment: ${metadata.bodySnippet}` : `Comment: ${targetId ?? 'unknown'}`,
      snippet: metadata?.bodySnippet,
      author: metadata?.authorName,
      permalink: toAbsoluteRedditUrl(metadata?.permalink ?? metadata?.url),
      parentPostTitle: metadata?.parentPostTitle,
    };
  }
  if (targetType === 'user') {
    const usernameRaw =
      typeof metadata?.targetUsername === 'string' && metadata.targetUsername.trim()
        ? metadata.targetUsername
        : (targetId ?? 'unknown');
    return {
      primaryLabel: `Target user: ${normalizeUserDisplay(usernameRaw)}`,
      snippet: undefined,
      author: undefined,
      permalink: undefined,
      parentPostTitle: undefined,
    };
  }
  return {
    primaryLabel: `Target: ${targetType}${targetId ? ` ${targetId}` : ''}`,
    snippet: undefined,
    author: undefined,
    permalink: undefined,
    parentPostTitle: undefined,
  };
};
const makeTargetMetadata = (values: {
  title?: string | undefined;
  bodySnippet?: string | undefined;
  authorName?: string | undefined;
  permalink?: string | undefined;
  parentPostTitle?: string | undefined;
}): ModAnchorTargetMetadata | undefined => {
  const metadata: ModAnchorTargetMetadata = {};
  if (values.title) metadata.title = values.title;
  if (values.bodySnippet) metadata.bodySnippet = values.bodySnippet;
  if (values.authorName) metadata.authorName = values.authorName;
  if (values.permalink) metadata.permalink = values.permalink;
  if (values.parentPostTitle) metadata.parentPostTitle = values.parentPostTitle;
  return Object.keys(metadata).length ? metadata : undefined;
};
const summarizeActionBreakdown = (actionCounts?: Record<string, number>) => {
  const counts = actionCounts ?? {};
  const removedPosts = counts.remove_post ?? 0;
  const removedComments = counts.remove_comment ?? 0;
  const approvedPosts = counts.approve_post ?? 0;
  const approvedComments = counts.approve_comment ?? 0;
  const spamRemovals = (counts.remove_post_spam ?? 0) + (counts.remove_comment_spam ?? 0);
  const mappedTotal = removedPosts + removedComments + approvedPosts + approvedComments + spamRemovals;
  const overallTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const otherActions = Math.max(0, overallTotal - mappedTotal);
  const rows = [
    { label: 'Removed posts', count: removedPosts },
    { label: 'Removed comments', count: removedComments },
    { label: 'Approved posts', count: approvedPosts },
    { label: 'Approved comments', count: approvedComments },
    { label: 'Spam removals', count: spamRemovals },
    { label: 'Other actions', count: otherActions },
  ];
  const nonZero = rows.filter((r) => r.count > 0);
  return nonZero.length ? nonZero : [{ label: 'No action categories recorded', count: 0 }];
};

const copyText = async (text: string) => {
  if (!navigator.clipboard) throw new Error('Clipboard is not available in this environment.');
  await navigator.clipboard.writeText(text);
};

const defaultSeniorAccessPolicy: SeniorAccessPolicy = {
  autoSeniorByRedditPermissions: true,
  strongRedditPermissions: ['everything'],
  allowManualSeniorOverride: true,
};

export const App = () => {
  const savedActionConsoleState = loadSavedActionConsoleState();
  const [tab, setTab] = useState<Tab>('modonboard');
  const [modOnboardSection, setModOnboardSection] = useState<ModOnboardSection>('overview');

  const [modCopyStatus, setModCopyStatus] = useState<string | null>(null);
  const [historyCopyStatus, setHistoryCopyStatus] = useState<string | null>(null);

  const [moderators, setModerators] = useState<SubredditModerator[]>([]);
  const [moderatorsLoading, setModeratorsLoading] = useState(false);
  const [reviewReportsByUsername, setReviewReportsByUsername] = useState<Record<string, ModOnboardReport>>({});
  const [seniorAccessPolicy, setSeniorAccessPolicy] = useState<SeniorAccessPolicy>(defaultSeniorAccessPolicy);
  const [seniorOverrides, setSeniorOverrides] = useState<string[]>([]);
  const [reviewAssignments, setReviewAssignments] = useState<ModeratorReviewAssignment[]>([]);
  const [actionReviews, setActionReviews] = useState<ModAnchorActionReview[]>([]);
  const [myActionReviews, setMyActionReviews] = useState<ModAnchorActionReview[]>([]);
  const [monitoringDigests, setMonitoringDigests] = useState<ModAnchorMonitoringDigest[]>([]);
  const [phase1Days, setPhase1Days] = useState(0);
  const [phase1Hours, setPhase1Hours] = useState(0);
  const [phase1Minutes, setPhase1Minutes] = useState(0);
  const [phase2Days, setPhase2Days] = useState(14);
  const [phase2Hours, setPhase2Hours] = useState(0);
  const [phase2Minutes, setPhase2Minutes] = useState(0);
  const [autoGraduate, setAutoGraduate] = useState(false);
  const [reportMode, setReportMode] = useState<'per_action' | 'daily_digest'>('daily_digest');
  const [reviewTargetUsername, setReviewTargetUsername] = useState('');
  const [modOnboardActionError, setModOnboardActionError] = useState<string | null>(null);
  const [modOnboardActionSuccess, setModOnboardActionSuccess] = useState<string | null>(null);
  const [modOnboardAccess, setModOnboardAccess] = useState<ModOnboardAccessResponse | null>(null);
  const [modOnboardAccessLoading, setModOnboardAccessLoading] = useState(false);
  const [modOnboardAccessError, setModOnboardAccessError] = useState<string | null>(null);
  const [showSeniorAccessPolicy, setShowSeniorAccessPolicy] = useState(false);
  const [showApprovalHelp, setShowApprovalHelp] = useState(false);
  const [showMonitoringHelp, setShowMonitoringHelp] = useState(false);
  const [hasLoadedModOnboardWorkspace, setHasLoadedModOnboardWorkspace] = useState(false);
  const [modOnboardWorkspaceRefreshing, setModOnboardWorkspaceRefreshing] = useState(false);
  const [actionConsoleTargetUsername, setActionConsoleTargetUsername] = useState(savedActionConsoleState.userTarget ?? '');
  const [actionConsoleUserActionType, setActionConsoleUserActionType] = useState<ModAnchorActionType>(savedActionConsoleState.userActionType ?? 'ban_user');
  const [actionConsoleUserDurationDays, setActionConsoleUserDurationDays] = useState(7);
  const [actionConsoleUserReason, setActionConsoleUserReason] = useState(savedActionConsoleState.userReason ?? '');
  const [actionConsoleUserModNote, setActionConsoleUserModNote] = useState(savedActionConsoleState.userModNote ?? '');
  const [actionConsolePostActionType, setActionConsolePostActionType] = useState<ModAnchorActionType>(savedActionConsoleState.postActionType ?? 'approve_post');
  const [actionConsoleRecentPosts, setActionConsoleRecentPosts] = useState<ActionConsolePostSummary[]>([]);
  const [actionConsolePostSearch, setActionConsolePostSearch] = useState(savedActionConsoleState.postSearch ?? '');
  const [actionConsoleSelectedPost, setActionConsoleSelectedPost] = useState<ActionConsolePostSummary | null>(savedActionConsoleState.selectedPost ?? null);
  const [actionConsolePostPickerOpen, setActionConsolePostPickerOpen] = useState(true);
  const [actionConsolePostManualOpen, setActionConsolePostManualOpen] = useState(savedActionConsoleState.postManualOpen ?? false);
  const [actionConsolePostTargetInput, setActionConsolePostTargetInput] = useState(savedActionConsoleState.postTargetInput ?? '');
  const [actionConsolePostReason, setActionConsolePostReason] = useState(savedActionConsoleState.postReason ?? '');
  const [actionConsolePostRemovalNote, setActionConsolePostRemovalNote] = useState(savedActionConsoleState.postRemovalNote ?? '');
  const [actionConsoleCommentActionType, setActionConsoleCommentActionType] = useState<ModAnchorActionType>(savedActionConsoleState.commentActionType ?? 'approve_comment');
  const [actionConsoleCommentPostSearch, setActionConsoleCommentPostSearch] = useState(savedActionConsoleState.commentPostSearch ?? '');
  const [actionConsoleSelectedCommentPost, setActionConsoleSelectedCommentPost] = useState<ActionConsolePostSummary | null>(savedActionConsoleState.selectedCommentPost ?? null);
  const [actionConsoleCommentPostPickerOpen, setActionConsoleCommentPostPickerOpen] = useState(!savedActionConsoleState.selectedCommentPost);
  const [actionConsolePostComments, setActionConsolePostComments] = useState<ActionConsoleCommentSummary[]>([]);
  const [actionConsoleCommentsLoading, setActionConsoleCommentsLoading] = useState(false);
  const [actionConsoleCommentsError, setActionConsoleCommentsError] = useState<string | null>(null);
  const [actionConsoleCommentSearch, setActionConsoleCommentSearch] = useState(savedActionConsoleState.commentSearch ?? '');
  const [actionConsoleSelectedComment, setActionConsoleSelectedComment] = useState<ActionConsoleCommentSummary | null>(savedActionConsoleState.selectedComment ?? null);
  const [actionConsoleCommentPickerOpen, setActionConsoleCommentPickerOpen] = useState(!savedActionConsoleState.selectedComment);
  const [actionConsoleCommentManualOpen, setActionConsoleCommentManualOpen] = useState(savedActionConsoleState.commentManualOpen ?? false);
  const [actionConsoleCommentTargetInput, setActionConsoleCommentTargetInput] = useState(savedActionConsoleState.commentTargetInput ?? '');
  const [actionConsoleCommentReason, setActionConsoleCommentReason] = useState(savedActionConsoleState.commentReason ?? '');
  const [actionConsoleCommentRemovalNote, setActionConsoleCommentRemovalNote] = useState(savedActionConsoleState.commentRemovalNote ?? '');
  const [actionConsoleSubmitting, setActionConsoleSubmitting] = useState(false);
  const [actionConsolePage, setActionConsolePage] = useState<ActionConsolePage>(savedActionConsoleState.page ?? 'user');
  const [actionConsolePreviewError, setActionConsolePreviewError] = useState<string | null>(null);
  const [expandedPostSnippets, setExpandedPostSnippets] = useState<Record<string, boolean>>({});
  const [showAllMyActions, setShowAllMyActions] = useState(false);
  const [approvalsVisibleCount, setApprovalsVisibleCount] = useState(25);
  const [monitoringVisibleCount, setMonitoringVisibleCount] = useState(25);
  const [toast, setToast] = useState<{ id: number; type: 'success' | 'error'; message: string } | null>(null);
  const [startReviewSubmitting, setStartReviewSubmitting] = useState(false);
  const [pendingDecisionAction, setPendingDecisionAction] = useState<{ id: string; decision: 'approve' | 'reject' } | null>(null);
  const [phaseMutationPending, setPhaseMutationPending] = useState<{ username: string; action: 'advance' | 'complete' } | null>(null);
  const [seniorPolicySaving, setSeniorPolicySaving] = useState(false);
  const [digestGenerating, setDigestGenerating] = useState(false);
  const [reportGeneratingFor, setReportGeneratingFor] = useState<string | null>(null);
  const [editingReviewUsername, setEditingReviewUsername] = useState<string | null>(null);
  const [editReviewPhase1Days, setEditReviewPhase1Days] = useState(0);
  const [editReviewPhase1Hours, setEditReviewPhase1Hours] = useState(0);
  const [editReviewPhase1Minutes, setEditReviewPhase1Minutes] = useState(0);
  const [editReviewPhase2Days, setEditReviewPhase2Days] = useState(14);
  const [editReviewPhase2Hours, setEditReviewPhase2Hours] = useState(0);
  const [editReviewPhase2Minutes, setEditReviewPhase2Minutes] = useState(0);
  const [editReviewReportMode, setEditReviewReportMode] = useState<'per_action' | 'daily_digest'>('per_action');
  const [editReviewAutoGraduate, setEditReviewAutoGraduate] = useState(false);
  const [editReviewError, setEditReviewError] = useState<string | null>(null);
  const [editReviewSavingFor, setEditReviewSavingFor] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ACTION_CONSOLE_STATE_KEY,
        JSON.stringify({
          page: actionConsolePage,
          userTarget: actionConsoleTargetUsername,
          userActionType: actionConsoleUserActionType,
          userReason: actionConsoleUserReason,
          userModNote: actionConsoleUserModNote,
          postActionType: actionConsolePostActionType,
          postSearch: actionConsolePostSearch,
          selectedPost: actionConsoleSelectedPost,
          postManualOpen: actionConsolePostManualOpen,
          postTargetInput: actionConsolePostTargetInput,
          postReason: actionConsolePostReason,
          postRemovalNote: actionConsolePostRemovalNote,
          commentActionType: actionConsoleCommentActionType,
          commentPostSearch: actionConsoleCommentPostSearch,
          selectedCommentPost: actionConsoleSelectedCommentPost,
          commentSearch: actionConsoleCommentSearch,
          selectedComment: actionConsoleSelectedComment,
          commentManualOpen: actionConsoleCommentManualOpen,
          commentTargetInput: actionConsoleCommentTargetInput,
          commentReason: actionConsoleCommentReason,
          commentRemovalNote: actionConsoleCommentRemovalNote,
        })
      );
    } catch {
      // Ignore storage failures in restricted surfaces.
    }
  }, [
    actionConsolePage,
    actionConsoleTargetUsername,
    actionConsoleUserActionType,
    actionConsoleUserReason,
    actionConsoleUserModNote,
    actionConsolePostActionType,
    actionConsolePostSearch,
    actionConsoleSelectedPost,
    actionConsolePostManualOpen,
    actionConsolePostTargetInput,
    actionConsolePostReason,
    actionConsolePostRemovalNote,
    actionConsoleCommentActionType,
    actionConsoleCommentPostSearch,
    actionConsoleSelectedCommentPost,
    actionConsoleCommentSearch,
    actionConsoleSelectedComment,
    actionConsoleCommentManualOpen,
    actionConsoleCommentTargetInput,
    actionConsoleCommentReason,
    actionConsoleCommentRemovalNote,
  ]);

  const [history, setHistory] = useState<StoredReport[]>([]);
  const [historyListMode, setHistoryListMode] = useState(false);
  const [historyDetailById, setHistoryDetailById] = useState<Record<string, StoredReport>>({});
  const [historyDetailLoadingById, setHistoryDetailLoadingById] = useState<Record<string, boolean>>({});
  const [historyDetailErrorById, setHistoryDetailErrorById] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyResetting, setHistoryResetting] = useState(false);
  const [historyResetConfirmOpen, setHistoryResetConfirmOpen] = useState(false);
  const [deleteAllReportsConfirmOpen, setDeleteAllReportsConfirmOpen] = useState(false);
  const [reportsDeletingAll, setReportsDeletingAll] = useState(false);
  const [reportDeletingId, setReportDeletingId] = useState<string | null>(null);
  const [confirmDeleteReportId, setConfirmDeleteReportId] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [historyVisibleCount, setHistoryVisibleCount] = useState(20);
  const [recentlyGeneratedReportId, setRecentlyGeneratedReportId] = useState<string | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ id: Date.now(), type, message });
  }, []);
  const showSuccessToast = useCallback((message: string) => showToast('success', message), [showToast]);
  const showErrorToast = useCallback((message: string) => showToast('error', message), [showToast]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!recentlyGeneratedReportId) return;
    const timer = window.setTimeout(() => setRecentlyGeneratedReportId(null), 5000);
    return () => window.clearTimeout(timer);
  }, [recentlyGeneratedReportId]);

  const whoami = useMemo(() => context.username ?? 'moderator', []);
  const subreddit = useMemo(() => context.subredditName ?? 'modanchor_dev', []);
  const pendingApprovalActions = useMemo(
    () => actionReviews.filter((item) => item.executionStatus === 'pending_approval'),
    [actionReviews]
  );
  const reviewedActions = useMemo(
    () =>
      actionReviews
        .filter((item) => item.executionStatus === 'approved_executed' || item.executionStatus === 'rejected')
        .slice(0, 6),
    [actionReviews]
  );
  const monitoredActions = useMemo(
    () => actionReviews.filter((item) => item.executionStatus === 'executed_monitored'),
    [actionReviews]
  );
  const activeReviewAssignments = useMemo(
    () => reviewAssignments.filter((assignment) => assignment.status === 'active'),
    [reviewAssignments]
  );

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/reports?summaryOnly=true&limit=100');
      const data: (PaginatedReportHistoryResponse & ReportHistoryResponse) = await res.json();
      if (!res.ok) throw new Error('Failed to fetch report history.');
      if ('items' in data && Array.isArray(data.items)) {
        const listAsReports = data.items.map((item) => ({
          id: item.id,
          type: item.type,
          summary: item.title,
          generatedAt: item.generatedAt,
          periodDays: item.periodDays ?? 0,
          subreddit,
          ...(item.type === 'modonboard'
            ? {
                username: item.username ?? 'unknown',
                actionSummary: { removals: 0, approvals: 0, bans: 0, comments: 0 },
                focusAreas: Array.from({ length: item.focusAreasCount ?? 0 }).map(() => ''),
                recommendations: [],
                metrics: item.metrics
                  ? {
                      totalActions: item.metrics.totalActions ?? 0,
                      pendingApproval: 0,
                      approvedExecuted: item.metrics.approvedExecuted ?? 0,
                      rejected: item.metrics.rejected ?? 0,
                      executedMonitored: item.metrics.executedMonitored ?? 0,
                      executed: 0,
                      failed: item.metrics.failed ?? 0,
                    }
                  : undefined,
              }
            : { issues: [] }),
        })) as StoredReport[];
        setHistoryListMode(true);
        setHistory(listAsReports);
      } else {
        setHistoryListMode(false);
        setHistory((data as ReportHistoryResponse).reports ?? []);
      }
      setHistoryVisibleCount(20);
    } catch (error) {
      console.error(error);
    } finally {
      setHistoryLoading(false);
    }
  }, [subreddit]);
  const ensureHistoryReportDetail = useCallback(async (reportId: string): Promise<void> => {
    if (!reportId) return;
    if (historyDetailById[reportId] || historyDetailLoadingById[reportId]) return;
    setHistoryDetailLoadingById((prev) => ({ ...prev, [reportId]: true }));
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
      const data: { report?: StoredReport; error?: string } = await res.json();
      if (res.ok && data.report) {
        setHistoryDetailById((prev) => ({ ...prev, [reportId]: data.report as StoredReport }));
        setHistoryDetailErrorById((prev) => {
          const next = { ...prev };
          delete next[reportId];
          return next;
        });
      } else {
        setHistoryDetailErrorById((prev) => ({ ...prev, [reportId]: data.error ?? 'Failed to load report details.' }));
      }
    } catch {
      setHistoryDetailErrorById((prev) => ({ ...prev, [reportId]: 'Failed to load report details.' }));
    } finally {
      setHistoryDetailLoadingById((prev) => ({ ...prev, [reportId]: false }));
    }
  }, [historyDetailById, historyDetailLoadingById]);
  useEffect(() => {
    if (!historyListMode) return;
    const expandedIds = Object.entries(expandedHistory)
      .filter(([, isExpanded]) => isExpanded)
      .map(([id]) => id);
    for (const reportId of expandedIds) {
      if (!historyDetailById[reportId] && !historyDetailLoadingById[reportId]) {
        queueMicrotask(() => {
          void ensureHistoryReportDetail(reportId);
        });
      }
    }
  }, [expandedHistory, historyListMode, historyDetailById, historyDetailLoadingById, ensureHistoryReportDetail]);
  const resetModAnchorData = async () => {
    if (historyResetting) return;
    setHistoryResetting(true);
    try {
      const res = await fetch('/api/modonboard/reset-data', { method: 'POST' });
      const data: { message?: string; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to clear ModAnchor workspace data.');
      showSuccessToast(data.message ?? 'ModAnchor workspace data cleared.');
      setHistory([]);
      setExpandedHistory({});
      setHistoryDetailById({});
      setHistoryDetailLoadingById({});
      setHistoryDetailErrorById({});
      setHistoryCopyStatus(null);
      await Promise.all([
        fetchHistory(),
        fetchModOnboardAccess(),
        fetchReviewAssignments(),
        fetchActionReviews(),
        fetchMyActionReviews(),
        fetchMonitoringDigests(),
        loadSubredditModerators(),
        fetchSeniorAccessPolicy(),
      ]);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to clear ModAnchor workspace data.');
    } finally {
      setHistoryResetting(false);
      setHistoryResetConfirmOpen(false);
    }
  };

  const toCountText = (value: number | undefined): string =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';

  const fetchModOnboardAccess = async () => {
    setModOnboardAccessLoading(true);
    setModOnboardAccessError(null);
    try {
      const res = await fetch('/api/modonboard/access');
      const data: (ModOnboardAccessResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to check ModOnboard access.');
      setModOnboardAccess(data);
    } catch (error) {
      setModOnboardAccess(null);
      setModOnboardAccessError(error instanceof Error ? error.message : 'Failed to check ModOnboard access.');
    } finally {
      setModOnboardAccessLoading(false);
    }
  };

  const fetchSeniorAccessPolicy = async () => {
    const res = await fetch('/api/modonboard/senior-access-policy');
    const data: (SeniorAccessPolicyResponse & { error?: string }) = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to fetch senior access policy.');
    setSeniorAccessPolicy(data.seniorAccessPolicy ?? defaultSeniorAccessPolicy);
    setSeniorOverrides((data.seniorOverrides ?? []).map((item) => item.username));
  };

  const fetchReviewAssignments = async () => {
    const res = await fetch('/api/modonboard/reviews');
    const data: (ReviewAssignmentsResponse & { error?: string }) = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to fetch review assignments.');
    setReviewAssignments(data.reviewAssignments ?? []);
  };

  const fetchActionReviews = async () => {
    const pendingRes = await fetch('/api/modonboard/action-reviews?status=pending_approval&limit=100');
    const pendingData: (PaginatedModAnchorActionReviewsResponse & ModAnchorActionReviewsResponse & { error?: string }) = await pendingRes.json();
    if (!pendingRes.ok) throw new Error(pendingData.error ?? 'Failed to fetch pending action reviews.');
    const monitoredRes = await fetch('/api/modonboard/action-reviews?status=executed_monitored&limit=100');
    const monitoredData: (PaginatedModAnchorActionReviewsResponse & ModAnchorActionReviewsResponse & { error?: string }) = await monitoredRes.json();
    if (!monitoredRes.ok) throw new Error(monitoredData.error ?? 'Failed to fetch monitored action reviews.');
    const recentRes = await fetch('/api/modonboard/action-reviews?limit=100');
    const recentData: (PaginatedModAnchorActionReviewsResponse & ModAnchorActionReviewsResponse & { error?: string }) = await recentRes.json();
    if (!recentRes.ok) throw new Error(recentData.error ?? 'Failed to fetch recent action reviews.');
    const pending = 'items' in pendingData ? pendingData.items : (pendingData as ModAnchorActionReviewsResponse).reviews ?? [];
    const monitored = 'items' in monitoredData ? monitoredData.items : (monitoredData as ModAnchorActionReviewsResponse).reviews ?? [];
    const recent = 'items' in recentData ? recentData.items : (recentData as ModAnchorActionReviewsResponse).reviews ?? [];
    const deduped = new Map<string, import('../shared/api').ModAnchorActionReview>();
    for (const item of [...pending, ...monitored, ...recent]) deduped.set(item.id, item);
    setActionReviews(Array.from(deduped.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setApprovalsVisibleCount(25);
    setMonitoringVisibleCount(25);
  };
  const fetchMyActionReviews = async () => {
    const res = await fetch('/api/modonboard/my-action-reviews');
    const data: (MyActionReviewsResponse & { error?: string }) = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to fetch your action reviews.');
    setMyActionReviews(data.reviews ?? []);
  };
  const fetchMonitoringDigests = async () => {
    const res = await fetch('/api/modonboard/monitoring-digests?limit=100');
    const data: (MonitoringDigestsResponse & PaginatedMonitoringDigestsResponse & { error?: string }) = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to fetch monitoring digests.');
    if ('items' in data && Array.isArray(data.items)) setMonitoringDigests(data.items);
    else setMonitoringDigests((data as MonitoringDigestsResponse).digests ?? []);
  };

  const refreshModOnboardWorkspace = useCallback(async () => {
    if (modOnboardWorkspaceRefreshing) return;
    setModOnboardWorkspaceRefreshing(true);
    try {
      await Promise.all([
        fetchSeniorAccessPolicy(),
        fetchReviewAssignments(),
        ...(modOnboardAccess?.canManageModOnboard ? [fetchActionReviews()] : []),
        ...(modOnboardAccess?.canUseActionConsole ? [fetchMyActionReviews()] : []),
        fetchMonitoringDigests(),
        loadSubredditModerators(),
      ]);
    } finally {
      setModOnboardWorkspaceRefreshing(false);
    }
  }, [modOnboardWorkspaceRefreshing, modOnboardAccess?.canManageModOnboard, modOnboardAccess?.canUseActionConsole]);


  useEffect(() => {
    if (tab === 'modonboard') {
      queueMicrotask(() => {
        void fetchModOnboardAccess();
      });
    }
  }, [tab]);

  useEffect(() => {
    if (
      tab === 'modonboard' &&
      modOnboardAccess?.canViewModOnboard &&
      !hasLoadedModOnboardWorkspace
    ) {
      queueMicrotask(() => {
        setHasLoadedModOnboardWorkspace(true);
        void refreshModOnboardWorkspace();
      });
    }
  }, [tab, modOnboardAccess?.canViewModOnboard, hasLoadedModOnboardWorkspace, refreshModOnboardWorkspace]);

  useEffect(() => {
    if (tab === 'history' && modOnboardAccess?.canViewReports) {
      queueMicrotask(() => {
        void fetchHistory();
      });
    }
  }, [tab, modOnboardAccess?.canViewReports, fetchHistory]);

  useEffect(() => {
    if (!modOnboardAccess?.canViewModOnboard) return;
    if (!modOnboardAccess.canManageModOnboard && modOnboardSection !== 'action_console') {
      queueMicrotask(() => {
        setModOnboardSection('action_console');
      });
    }
  }, [modOnboardAccess?.canViewModOnboard, modOnboardAccess?.canManageModOnboard, modOnboardSection]);

  const loadSubredditModerators = async () => {
    setModeratorsLoading(true);
    try {
      const res = await fetch('/api/modonboard/moderators');
      const data: ModeratorListResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load subreddit moderators. You can still add a username manually.');
      setModerators(data.moderators ?? []);
    } catch {
      setModerators([]);
    } finally {
      setModeratorsLoading(false);
    }
  };

  const saveSeniorAccessPolicyConfig = async () => {
    setModOnboardActionError(null);
    setModOnboardActionSuccess(null);
    setSeniorPolicySaving(true);
    try {
      const res = await fetch('/api/modonboard/senior-access-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seniorAccessPolicy }),
      });
      const data: (SeniorAccessPolicyResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save senior access policy.');
      setSeniorAccessPolicy(data.seniorAccessPolicy);
      setSeniorOverrides((data.seniorOverrides ?? []).map((item) => item.username));
      setModOnboardActionSuccess('Senior access policy saved.');
      showSuccessToast('Senior access policy saved.');
      await fetchSeniorAccessPolicy();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save senior access policy.';
      setModOnboardActionError(message);
      showErrorToast(message);
    } finally {
      setSeniorPolicySaving(false);
    }
  };

  const startReviewMode = async () => {
    const username = reviewTargetUsername.trim();
    if (!username) {
      setModOnboardActionError('username is required');
      return;
    }
    setModOnboardActionError(null);
    setModOnboardActionSuccess(null);
    setStartReviewSubmitting(true);
    try {
      const payload: StartReviewRequest = {
        username,
        phase1Days,
        phase2Days,
        phase1DurationMinutes: phase1Days * 24 * 60 + phase1Hours * 60 + phase1Minutes,
        phase2DurationMinutes: Math.max(1, phase2Days * 24 * 60 + phase2Hours * 60 + phase2Minutes),
        autoGraduate,
        reportMode,
      };
      const res = await fetch('/api/modonboard/reviews/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: (ReviewAssignmentsResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to start review assignment.');
      setReviewAssignments(data.reviewAssignments ?? []);
      setReviewTargetUsername('');
      const message = data.message ?? 'Review assignment started.';
      setModOnboardActionSuccess(message);
      showSuccessToast(message);
      await Promise.all([fetchReviewAssignments(), fetchActionReviews(), fetchMonitoringDigests(), loadSubredditModerators()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start review assignment.';
      setModOnboardActionError(message);
      showErrorToast(message);
    } finally {
      setStartReviewSubmitting(false);
    }
  };

  const mutateReviewPhase = async (username: string, action: 'advance' | 'complete') => {
    setModOnboardActionError(null);
    setModOnboardActionSuccess(null);
    setPhaseMutationPending({ username, action });
    try {
      const res = await fetch(action === 'advance' ? '/api/modonboard/reviews/advance' : '/api/modonboard/reviews/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data: (ReviewAssignmentsResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to update review assignment.');
      setReviewAssignments(data.reviewAssignments ?? []);
      const message = data.message ?? (action === 'advance' ? 'Review phase advanced.' : 'Review assignment completed.');
      setModOnboardActionSuccess(message);
      showSuccessToast(message);
      await Promise.all([fetchReviewAssignments(), fetchActionReviews(), fetchMonitoringDigests(), loadSubredditModerators()]);
      if (action === 'complete' && data.finalReportStatus === 'saved' && data.finalReportId) {
        await fetchHistory();
        await ensureHistoryReportDetail(data.finalReportId);
        setExpandedHistory((prev) => ({ ...prev, [data.finalReportId as string]: true }));
        setRecentlyGeneratedReportId(data.finalReportId);
        setTab('history');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update review assignment.';
      setModOnboardActionError(message);
      showErrorToast(message);
    } finally {
      setPhaseMutationPending(null);
    }
  };

  const deleteHistoryReport = async (reportId: string) => {
    if (reportDeletingId) return;
    setReportDeletingId(reportId);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      const res = await fetch('/api/modonboard/reports/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ reportId }),
      });
      window.clearTimeout(timeout);
      const raw = await res.text();
      let data: ReportHistoryResponse & { error?: string } = { reports: [] };
      try {
        data = JSON.parse(raw) as ReportHistoryResponse & { error?: string };
      } catch {
        data = { reports: [], error: raw || 'Unexpected server response.' };
      }
      if (!res.ok) {
        if (res.status === 404) throw new Error('Report was not found. Refresh history and try again.');
        throw new Error(data.error ?? 'Failed to delete report.');
      }
      setHistory(data.reports ?? []);
      setHistoryDetailById((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      setHistoryDetailLoadingById((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      setHistoryDetailErrorById((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      setExpandedHistory((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      setConfirmDeleteReportId(null);
      showSuccessToast('Report deleted.');
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Delete request timed out. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Failed to delete report.';
      showErrorToast(message);
    } finally {
      setReportDeletingId(null);
    }
  };

  const deleteAllHistoryReports = async () => {
    if (reportsDeletingAll) return;
    setReportsDeletingAll(true);
    try {
      const res = await fetch('/api/modonboard/reports/delete-all', { method: 'POST' });
      const data: (ReportHistoryResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete all reports.');
      setHistory(data.reports ?? []);
      setExpandedHistory({});
      setHistoryDetailById({});
      setHistoryDetailLoadingById({});
      setHistoryDetailErrorById({});
      showSuccessToast('Report history cleared.');
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete all reports.');
    } finally {
      setReportsDeletingAll(false);
      setDeleteAllReportsConfirmOpen(false);
    }
  };

  const startEditReviewSetup = (assignment: ModeratorReviewAssignment) => {
    const approvalMinutes = typeof assignment.phase1DurationMinutes === 'number'
      ? assignment.phase1DurationMinutes
      : assignment.phase1Days * 24 * 60;
    const monitoringMinutes = typeof assignment.phase2DurationMinutes === 'number'
      ? assignment.phase2DurationMinutes
      : assignment.phase2Days * 24 * 60;
    const approval = splitDurationMinutes(approvalMinutes);
    const monitoring = splitDurationMinutes(monitoringMinutes);
    setEditingReviewUsername(assignment.username);
    setEditReviewPhase1Days(approval.days);
    setEditReviewPhase1Hours(approval.hours);
    setEditReviewPhase1Minutes(approval.minutes);
    setEditReviewPhase2Days(monitoring.days);
    setEditReviewPhase2Hours(monitoring.hours);
    setEditReviewPhase2Minutes(monitoring.minutes);
    setEditReviewReportMode(assignment.reportMode === 'daily_digest' ? 'daily_digest' : 'per_action');
    setEditReviewAutoGraduate(assignment.autoGraduate === true);
    setEditReviewError(null);
  };

  const cancelEditReviewSetup = () => {
    if (editReviewSavingFor) return;
    setEditingReviewUsername(null);
    setEditReviewError(null);
  };

  const saveEditReviewSetup = async (assignment: ModeratorReviewAssignment) => {
    const approvalDurationMinutes = toDurationMinutes(editReviewPhase1Days, editReviewPhase1Hours, editReviewPhase1Minutes);
    const monitoringDurationMinutes = toDurationMinutes(editReviewPhase2Days, editReviewPhase2Hours, editReviewPhase2Minutes);
    if (editReviewPhase1Days < 0 || editReviewPhase1Hours < 0 || editReviewPhase1Hours > 23 || editReviewPhase1Minutes < 0 || editReviewPhase1Minutes > 59) {
      setEditReviewError('Approval duration is invalid. Hours must be 0-23 and minutes 0-59.');
      return;
    }
    if (editReviewPhase2Days < 0 || editReviewPhase2Hours < 0 || editReviewPhase2Hours > 23 || editReviewPhase2Minutes < 0 || editReviewPhase2Minutes > 59) {
      setEditReviewError('Monitoring duration is invalid. Hours must be 0-23 and minutes 0-59.');
      return;
    }
    if (monitoringDurationMinutes < 1) {
      setEditReviewError('Monitoring duration must be at least 1 minute.');
      return;
    }
    setEditReviewError(null);
    setEditReviewSavingFor(assignment.username);
    try {
      const payload: UpdateReviewSetupRequest = {
        username: assignment.username,
        phase1DurationMinutes: approvalDurationMinutes,
        phase2DurationMinutes: monitoringDurationMinutes,
        reportMode: editReviewReportMode,
        autoGraduate: editReviewAutoGraduate,
      };
      const res = await fetch('/api/modonboard/reviews/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: (ReviewAssignmentsResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to update review setup.');
      setReviewAssignments(data.reviewAssignments ?? []);
      setEditingReviewUsername(null);
      setModOnboardActionSuccess(data.message ?? 'Review setup updated.');
      showSuccessToast('Review setup updated.');
      await Promise.all([fetchReviewAssignments(), fetchActionReviews(), fetchMonitoringDigests(), loadSubredditModerators()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update review setup.';
      setEditReviewError(message);
      setModOnboardActionError(message);
      showErrorToast(message);
    } finally {
      setEditReviewSavingFor(null);
    }
  };

  const generateModReport = async (username: string, periodDays: number, reviewAssignmentId?: string) => {
    setReportGeneratingFor(username);
    try {
      const res = await fetch('/api/modonboard/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, periodDays, reviewAssignmentId }),
      });
      const data: ModOnboardReportResponse = await res.json();
      if (!res.ok) throw new Error('Failed to generate ModOnboard report.');
      setReviewReportsByUsername((prev) => ({ ...prev, [data.report.username.toLowerCase()]: data.report }));
      if (data.report?.id) {
        setHistoryDetailById((prev) => ({ ...prev, [data.report.id]: data.report }));
      }
      await fetchHistory();
      if (data.report?.id) {
        await ensureHistoryReportDetail(data.report.id);
        setExpandedHistory((prev) => ({ ...prev, [data.report.id]: true }));
        setRecentlyGeneratedReportId(data.report.id);
      }
      setTab('history');
      showSuccessToast('Report generated and saved to history.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate ModOnboard report.';
      setModOnboardActionError(message);
      showErrorToast(message);
    } finally {
      setReportGeneratingFor(null);
    }
  };

  const decideActionReview = async (actionReviewId: string, action: 'approve' | 'reject') => {
    setModOnboardActionError(null);
    setModOnboardActionSuccess(null);
    setPendingDecisionAction({ id: actionReviewId, decision: action });
    try {
      const res = await fetch(
        action === 'approve' ? '/api/modonboard/action-reviews/approve' : '/api/modonboard/action-reviews/reject',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionReviewId }),
        }
      );
      const data: (ModAnchorActionReviewsResponse & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to update action review.');
      setActionReviews(data.reviews ?? []);
      if (action === 'approve') {
        const updatedReview = (data.reviews ?? []).find((r) => r.id === actionReviewId);
        const noteStatus = typeof updatedReview?.metadata?.removalNoteStatus === 'string'
          ? formatRemovalNoteStatus(updatedReview.metadata.removalNoteStatus)
          : undefined;
        if (noteStatus === 'Attached via Reddit removal-note API') {
          setModOnboardActionSuccess('Action approved and content removed. Moderator removal note attached via Reddit.');
          showSuccessToast('Action approved and content removed. Moderator removal note attached via Reddit.');
        } else if (noteStatus) {
          setModOnboardActionSuccess(`Action approved and content removed. Moderator removal note was saved in ModAnchor but status is: ${noteStatus}.`);
          showSuccessToast(`Action approved and content removed. Moderator removal note status: ${noteStatus}.`);
        } else {
          setModOnboardActionSuccess('Action approved and content removed.');
          showSuccessToast('Action approved and content removed.');
        }
      } else {
        setModOnboardActionSuccess('Pending ModAnchor action rejected.');
        showSuccessToast('Pending ModAnchor action rejected.');
      }
      await Promise.all([fetchActionReviews(), fetchMonitoringDigests(), loadSubredditModerators()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update action review.';
      setModOnboardActionError(message);
      showErrorToast(message);
    } finally {
      setPendingDecisionAction(null);
    }
  };


  const submitActionConsole = async (payload: {
    targetType: 'user' | 'post' | 'comment';
    targetUsername?: string;
    targetId?: string;
    actionType: ModAnchorActionType;
    reason?: string | undefined;
    modNote?: string | undefined;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: boolean; message?: string }> => {
    if (actionConsoleSubmitting) return { ok: false };
    setModOnboardActionError(null);
    setModOnboardActionSuccess(null);
    setActionConsoleSubmitting(true);
    try {
      const res = await fetch('/api/modonboard/action-console/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: { message?: string; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit action');
      const successMessage = data.message ?? 'Action submitted through ModAnchor.';
      setModOnboardActionSuccess(successMessage);
      showSuccessToast(successMessage);
      if (modOnboardAccess?.canManageModOnboard) {
        await fetchActionReviews();
      } else if (modOnboardAccess?.canUseActionConsole) {
        await fetchMyActionReviews();
      }
      return { ok: true, message: successMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit action';
      setModOnboardActionError(message);
      showErrorToast(message);
      return { ok: false };
    } finally {
      setActionConsoleSubmitting(false);
    }
  };

  const fetchActionConsoleRecentPosts = async () => {
    try {
      const res = await fetch('/api/modonboard/action-console/recent-posts');
      const data: { posts?: ActionConsolePostSummary[]; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load recent posts');
      setActionConsoleRecentPosts(data.posts ?? []);
    } catch (error) {
      setModOnboardActionError(error instanceof Error ? error.message : 'Failed to load recent posts');
    }
  };

  const fetchActionConsolePostComments = async (postId: string) => {
    if (!postId) return;
    setActionConsoleCommentsLoading(true);
    setActionConsoleCommentsError(null);
    try {
      const res = await fetch(`/api/modonboard/action-console/post-comments?postId=${encodeURIComponent(postId)}`);
      const data: { comments?: ActionConsoleCommentSummary[]; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load comments');
      setActionConsolePostComments(data.comments ?? []);
      setActionConsoleSelectedComment(null);
    } catch (error) {
      setActionConsoleCommentsError(error instanceof Error ? error.message : 'Could not load comments for this post. Try Refresh comments.');
    } finally {
      setActionConsoleCommentsLoading(false);
    }
  };

  const buildRuleGapReportText = (report: RuleGapReport) =>
    [
      '# Wiki Improvement Report',
      '',
      `Subreddit: ${normalizeSubredditDisplay(subreddit)}`,
      `Period: Last ${report.periodDays} days`,
      `Generated: ${formatDate(report.generatedAt)}`,
      `Source: ${report.source === 'real_activity' ? 'Recent moderation activity' : 'Legacy demo report'}`,
      '',
      'Summary:',
      report.summary,
      '',
      '## Source Summary',
      `- Visible actions: ${report.sourceSummary?.totalActions ?? 0}`,
      `- Action types: ${report.sourceSummary?.actionTypes ?? 0}`,
      `- Hidden platform actions: ${report.sourceSummary?.hiddenPlatformActions ?? 0}`,
      `- Recent samples: ${report.sourceSummary?.recentSamples ?? 0}`,
      '',
      '## Issues',
      '',
      ...report.issues.flatMap((issue) => [
        `### ${issue.title}`,
        `Related rule: ${issue.relatedRule}`,
        `Severity: ${issue.severity}`,
        `Frequency: ${issue.frequency}`,
        '',
        'Pattern:',
        issue.pattern,
        '',
        'Examples:',
        ...issue.exampleSnippets.map((s) => `- ${s}`),
        '',
        'Suggested wiki update:',
        issue.suggestedWikiUpdate,
        '',
        'Suggested saved response:',
        issue.suggestedSavedResponse,
        '',
      ]),
    ].join('\n');

  const buildModOnboardReportText = (report: ModOnboardReport) =>
    [
      `# ModOnboard Report for ${normalizeUserDisplay(report.username)}`,
      '',
      `Subreddit: ${normalizeSubredditDisplay(subreddit)}`,
      `Period: Last ${report.periodDays} days`,
      `Generated: ${formatDate(report.generatedAt)}`,
      '',
      `Assessment: ${report.assessment?.label ?? 'Not available'}`,
      `${report.assessment?.summary ?? ''}`,
      `Recommended next step: ${report.assessment?.recommendedNextStep ?? 'Not available'}`,
      '',
      'Summary:',
      report.summary,
      '',
      '## Summary Metrics',
      `- Total actions: ${report.metrics?.totalActions ?? 0}`,
      `- Pending approval: ${report.metrics?.pendingApproval ?? 0}`,
      `- Approved and ran: ${report.metrics?.approvedExecuted ?? 0}`,
      `- Rejected: ${report.metrics?.rejected ?? 0}`,
      `- Ran and recorded: ${report.metrics?.executedMonitored ?? 0}`,
      `- Failed: ${report.metrics?.failed ?? 0}`,
      '',
      '## Decision quality',
      `- Approval rate: ${formatPercent(report.decisionMetrics?.approvalRate)}`,
      `- Rejection rate: ${formatPercent(report.decisionMetrics?.rejectionRate)}`,
      `- Pending actions: ${report.decisionMetrics?.pendingCount ?? 0}`,
      `- Failed actions: ${report.decisionMetrics?.failedCount ?? 0}`,
      '',
      '## Action breakdown',
      ...summarizeActionBreakdown(report.actionCounts).map((row) => `- ${row.label}: ${row.count}`),
      '',
      '## Native Reddit action usage',
      `- Total detected actions: ${report.nativeActionSummary?.totalCount ?? 0}`,
      ...Object.entries(report.nativeActionSummary?.breakdown ?? {}).map(([action, count]) => `- ${action}: ${count}`),
      `- Note: ${report.nativeActionSummary?.note ?? 'Not available'}`,
      '',
      '## What needs attention',
      ...report.focusAreas.map((f) => `- ${f}`),
      '',
      '## Coaching Suggestions',
      ...(report.coachingSuggestions?.length
        ? report.coachingSuggestions.map((item) => `- ${item}`)
        : report.recommendations.map((rec) => `- ${rec.suggestedAction}`)),
      '',
      '## Recent actions',
      ...(report.recentActions?.length
        ? report.recentActions.map((a) => {
            const context = getTargetContext(
              a.targetType,
              a.targetId,
              makeTargetMetadata({
                title: a.targetTitle,
                bodySnippet: a.targetSnippet,
                authorName: a.targetAuthor,
                permalink: a.targetPermalink,
                parentPostTitle: a.parentPostTitle,
              })
            );
            return `- ${a.friendlyAction} · ${a.friendlyStatus} · ${context.primaryLabel}${context.author ? ` · u/${context.author}` : ''}${context.parentPostTitle ? ` · Parent post: ${context.parentPostTitle}` : ''}${context.permalink ? ` · Link: ${context.permalink}` : ' · Link unavailable'} · When: ${formatDate(a.createdAt)} · Reason: ${a.reason?.trim() ? a.reason : 'No reason provided'}${a.removalNote ? ` · Removal note: ${a.removalNote}` : ''}${formatRemovalNoteStatus(a.removalNoteStatus) ? ` · Removal note status: ${formatRemovalNoteStatus(a.removalNoteStatus)}` : ''}`;
          })
        : ['- No recent actions recorded in this period.']),
    ].join('\n');

  const copyModOnboardReport = async (report: ModOnboardReport) => {
    try {
      await copyText(buildModOnboardReportText(report));
      setModCopyStatus('ModOnboard report copied.');
    } catch {
      setModCopyStatus('Could not copy automatically. Please copy the report text manually.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-3 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-3">
        {toast && (
          <div className="sticky top-2 z-50">
            <div className={`mx-auto flex max-w-3xl items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-sm ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
              <p>{toast.message}</p>
              <button type="button" className="text-xs opacity-80 hover:opacity-100" onClick={() => setToast(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
            Private Mod Tool
          </div>
          <h1 className="mt-2 text-2xl font-semibold">ModAnchor</h1>
          <p className="mt-1 text-sm text-slate-600">
            ModAnchor helps senior moderators onboard new mods with Review Mode, approval workflows, monitored actions, and review reports.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {normalizeUserDisplay(whoami)} · {normalizeSubredditDisplay(subreddit)}
          </p>
        </header>

        <div className="flex gap-2">
          {([
            'modonboard',
            ...(modOnboardAccess?.canViewModOnboard ? (['guide'] as const) : ([] as const)),
            ...(modOnboardAccess?.canViewReports ? (['history'] as const) : ([] as const)),
          ] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-blue-700 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
            >
              {t === 'modonboard' ? 'ModOnboard' : t === 'guide' ? 'Guide' : 'Report History'}
            </button>
          ))}
        </div>

        {tab === 'modonboard' && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void refreshModOnboardWorkspace()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                disabled={modOnboardWorkspaceRefreshing}
              >
                {modOnboardWorkspaceRefreshing ? 'Refreshing workspace...' : 'Refresh workspace'}
              </button>
            </div>
            <p className="text-xs text-slate-500">ModAnchor runs inside this private subreddit workspace post.</p>
            {modOnboardAccessLoading && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Checking ModOnboard access...</div>
            )}
            {modOnboardAccessError && <p className="text-sm text-slate-700">{modOnboardAccessError}</p>}
            {!modOnboardAccessLoading && modOnboardAccess && !modOnboardAccess.canViewModOnboard ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-base font-semibold text-slate-900">ModAnchor is restricted.</h3>
                <p className="text-sm text-slate-700">ModAnchor is available to subreddit moderators only.</p>
                {modOnboardAccess.reason && <p className="text-xs text-slate-500">{modOnboardAccess.reason}</p>}
              </div>
            ) : (
              <>
            {modOnboardActionSuccess && <p className="text-sm text-slate-700">{modOnboardActionSuccess}</p>}
            {modOnboardActionError && <p className="text-sm text-slate-700">{modOnboardActionError}</p>}
            {modOnboardAccess && modOnboardAccess.canViewModOnboard && !modOnboardAccess.canManageModOnboard && (
              <p className="text-xs text-slate-600">You can view ModOnboard, but only senior moderators can change review settings.</p>
            )}
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">ModOnboard</h2>
              <p className="text-sm text-slate-600">Safely train new moderators with Review Mode. Senior mods can approve sensitive ModAnchor actions, monitor actions, and review progress until a moderator is ready.</p>
              <p className="text-xs text-slate-500">Senior moderators can manage full ModOnboard. Junior moderators can use Action Console and Guide.</p>
              <p className="text-xs text-slate-500">Use the sections below to start reviews, approve queued actions, monitor activity, and manage moderator access.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(modOnboardAccess?.canManageModOnboard
                ? [
                    ['overview', 'Overview'],
                    ['start_review', 'Start Review'],
                    ['approvals', 'Approvals'],
                    ['monitoring', 'Monitoring'],
                    ['action_console', 'Action Console'],
                    ['moderators', 'Moderators'],
                    ['settings', 'Settings'],
                  ]
                : [['action_console', 'Action Console']]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setModOnboardSection(key as ModOnboardSection)}
                  className={`rounded-lg px-2.5 py-1.5 text-sm ${modOnboardSection === key ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {modOnboardSection === 'overview' && modOnboardAccess?.canManageModOnboard && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <button onClick={() => setModOnboardSection('approvals')} className={`flex min-h-[88px] flex-col justify-between rounded-lg border p-3 text-left ${pendingApprovalActions.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}><p className="text-xs leading-snug text-slate-500">Needs approval</p><p className="mt-2 text-lg font-semibold">{modOnboardWorkspaceRefreshing ? '—' : pendingApprovalActions.length}</p></button>
                  <button onClick={() => setModOnboardSection('moderators')} className="flex min-h-[88px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-left"><p className="text-xs leading-snug text-slate-500">Ongoing reviews</p><p className="mt-2 text-lg font-semibold">{modOnboardWorkspaceRefreshing ? '—' : reviewAssignments.filter((a) => a.status === 'active').length}</p></button>
                  <div className="flex min-h-[88px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs leading-snug text-slate-500">Senior mods</p><p className="mt-2 text-lg font-semibold">{modOnboardWorkspaceRefreshing ? '—' : moderators.filter((m) => m.modAnchorRole === 'senior').length}</p></div>
                  <div className="flex min-h-[88px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs leading-snug text-slate-500">Moderators loaded</p><p className="mt-2 text-lg font-semibold">{moderatorsLoading || modOnboardWorkspaceRefreshing ? '—' : moderators.length || '—'}</p></div>
                  <button onClick={() => setModOnboardSection('monitoring')} className="flex min-h-[88px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-left"><p className="text-xs leading-snug text-slate-500">Monitored actions</p><p className="mt-2 text-lg font-semibold">{modOnboardWorkspaceRefreshing ? '—' : monitoredActions.length}</p></button>
                  <button onClick={() => setModOnboardSection('monitoring')} className="flex min-h-[88px] flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-left"><p className="text-xs leading-snug text-slate-500">Daily digests</p><p className="mt-2 text-lg font-semibold">{modOnboardWorkspaceRefreshing ? '—' : monitoringDigests.length}</p></button>
                </div>
                <p className="text-xs text-slate-500">Start with actions that need approval, then review ongoing moderator progress.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setModOnboardSection('start_review')} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">Start a review</button>
                  <button onClick={() => setModOnboardSection('approvals')} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">Review approvals</button>
                  <button onClick={() => setModOnboardSection('monitoring')} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">View monitoring</button>
                  <button onClick={() => setModOnboardSection('moderators')} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">Open moderator directory</button>
                </div>
              </>
            )}

            {modOnboardSection === 'start_review' && modOnboardAccess?.canManageModOnboard && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Start a moderator review</h3>
              <p className="text-xs text-slate-600">Use this page to place a moderator into Review Mode. Approval phase queues ModAnchor actions for senior approval. Monitoring phase records actions after they run.</p>
              <p className="text-xs text-slate-600">
                {reviewTargetUsername
                  ? `Selected moderator: ${normalizeUserDisplay(reviewTargetUsername)}`
                  : 'No moderator selected. Choose one from the list below.'}
              </p>
              {(() => {
                const selected = moderators.find((m) => m.username.toLowerCase() === reviewTargetUsername.toLowerCase());
                const hasPostsAndComments = Boolean(
                  selected?.redditPermissions?.some((permission) => {
                    const normalized = permission.toLowerCase();
                    return normalized.includes('posts') || normalized.includes('comments');
                  })
                );
                const approvedUserStatus = selected?.isApprovedUser === true ? 'Available' : selected?.isApprovedUser === false ? 'Missing' : 'Unknown';
                if (!reviewTargetUsername) return null;
                return (
                  <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                    <p className="font-medium text-slate-700">Onboarding prerequisites</p>
                    <p className="text-emerald-700">Moderator access: Available</p>
                    <p className={hasPostsAndComments ? 'text-emerald-700' : 'text-amber-700'}>
                      Posts & Comments permission: {hasPostsAndComments ? 'Available — menu actions should be visible' : 'Missing — Action Console available; menu actions may be hidden'}
                    </p>
                    <p className={approvedUserStatus === 'Available' ? 'text-emerald-700' : approvedUserStatus === 'Missing' ? 'text-amber-700' : 'text-slate-600'}>
                      Approved user access: {approvedUserStatus}
                    </p>
                  </div>
                );
              })()}
              <div className="space-y-2">
                <label className="text-xs text-slate-600">Moderator
                  <select
                    value={reviewTargetUsername}
                    onChange={(e) => setReviewTargetUsername(e.target.value)}
                    disabled={moderatorsLoading || moderators.length === 0}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white disabled:opacity-60"
                  >
                    <option value="">{moderatorsLoading ? 'Loading moderators...' : 'Select moderator'}</option>
                    {moderators.map((mod) => (
                      <option key={mod.username} value={mod.username}>
                        {normalizeUserDisplay(mod.username)}{mod.isCurrentUser ? ' (you)' : ''}{mod.modAnchorRole ? ` · ${formatRole(mod.modAnchorRole)}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-600">Approval phase</label>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] text-slate-600 hover:bg-slate-100"
                      onClick={() => setShowApprovalHelp((v) => !v)}
                      aria-label="Explain approval phase"
                      title="Explain approval phase"
                    >
                      ⓘ
                    </button>
                  </div>
                  {showApprovalHelp && (
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      <p>During the approval phase, ModAnchor menu actions from this moderator are queued for senior approval before they run.</p>
                      <p>Native Reddit actions taken outside ModAnchor cannot be blocked before execution.</p>
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="text-xs text-slate-600">
                      Days
                      <input type="number" min={0} max={90} value={phase1Days} onChange={(e) => setPhase1Days(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Days" />
                    </label>
                    <label className="text-xs text-slate-600">
                      Hours
                      <input type="number" min={0} max={23} value={phase1Hours} onChange={(e) => setPhase1Hours(Math.min(23, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Hours" />
                    </label>
                    <label className="text-xs text-slate-600">
                      Minutes
                      <input type="number" min={0} max={59} value={phase1Minutes} onChange={(e) => setPhase1Minutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Minutes" />
                    </label>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Actions are queued for senior approval during this duration.</p>
                  <p className="text-xs text-slate-500">Hours: 0-23 · Minutes: 0-59</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-600">Monitoring phase</label>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] text-slate-600 hover:bg-slate-100"
                      onClick={() => setShowMonitoringHelp((v) => !v)}
                      aria-label="Explain monitoring phase"
                      title="Explain monitoring phase"
                    >
                      ⓘ
                    </button>
                  </div>
                  {showMonitoringHelp && (
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      <p>During the monitoring phase, ModAnchor menu actions run immediately and are recorded for senior review.</p>
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="text-xs text-slate-600">
                      Days
                      <input type="number" min={0} max={90} value={phase2Days} onChange={(e) => setPhase2Days(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Days" />
                    </label>
                    <label className="text-xs text-slate-600">
                      Hours
                      <input type="number" min={0} max={23} value={phase2Hours} onChange={(e) => setPhase2Hours(Math.min(23, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Hours" />
                    </label>
                    <label className="text-xs text-slate-600">
                      Minutes
                      <input type="number" min={0} max={59} value={phase2Minutes} onChange={(e) => setPhase2Minutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Minutes" />
                    </label>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Actions can run through ModAnchor and are reviewed after they run.</p>
                  <p className="text-xs text-slate-500">Hours: 0-23 · Minutes: 0-59</p>
                  <label className="mt-2 block text-xs text-slate-600">Monitoring report style<select value={reportMode} onChange={(e) => setReportMode(e.target.value as 'per_action' | 'daily_digest')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="per_action">Per action</option><option value="daily_digest">Daily digest</option></select></label>
                  <p className="mt-1 text-xs text-slate-500">Per action sends a modmail for each monitored ModAnchor action. Daily digest groups monitored actions into one summary per moderator per day.</p>
                  {reportMode === 'per_action' && (
                    <p className="mt-1 text-xs text-amber-700">Per-action modmail can be noisy in busy communities. Daily digest is recommended for high-volume subreddits.</p>
                  )}
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={autoGraduate} onChange={(e) => setAutoGraduate(e.target.checked)} /> Auto-graduate after review period</label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={startReviewSubmitting || !modOnboardAccess?.canManageModOnboard} onClick={() => void startReviewMode()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{startReviewSubmitting ? 'Starting...' : reviewTargetUsername ? `Start Review Mode for ${normalizeUserDisplay(reviewTargetUsername)}` : 'Start Review Mode'}</button>
                <button
                  type="button"
                  disabled={startReviewSubmitting}
                  onClick={() => {
                    setReviewTargetUsername('');
                    setPhase1Days(0);
                    setPhase1Hours(0);
                    setPhase1Minutes(0);
                    setPhase2Days(14);
                    setPhase2Hours(0);
                    setPhase2Minutes(0);
                    setAutoGraduate(false);
                    setReportMode('daily_digest');
                    setShowApprovalHelp(false);
                    setShowMonitoringHelp(false);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                >
                  Reset
                </button>
              </div>
              {reviewTargetUsername && !moderators.find((m) => m.username.toLowerCase() === reviewTargetUsername.toLowerCase())?.redditPermissions?.some((permission) => permission.toLowerCase().includes('posts') || permission.toLowerCase().includes('comments')) && (
                <p className="text-xs text-amber-700">Posts & Comments permission is optional. Without it, this moderator can still use Action Console, but may not see ModAnchor post/comment menu actions.</p>
              )}
            </div>
            )}

            {modOnboardSection === 'approvals' && modOnboardAccess?.canManageModOnboard && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Approvals</h3>
                <p className="text-sm text-slate-600">Use this page to review ModAnchor actions requested by moderators in the Approval phase. These actions have not run yet. A senior moderator can approve and run them, or reject them.</p>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-medium">Moderators in Approval phase</p>
                  {reviewAssignments.filter((a) => a.status === 'active' && a.phase === 'approval_required').length === 0 ? (
                    <p className="text-slate-600">No moderators are currently in Approval phase.</p>
                  ) : (
                    <ul className="mt-1 list-disc pl-5 text-slate-600">
                      {reviewAssignments
                        .filter((a) => a.status === 'active' && a.phase === 'approval_required')
                        .map((a) => (
                          <li key={`${a.username}-${a.assignedAt}`}>
                            {normalizeUserDisplay(a.username)} · Phase end: {formatDate(a.expectedPhaseEndAt)} · Report style: {a.reportMode === 'daily_digest' ? 'Daily digest' : 'Per action'}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Actions waiting for senior approval</h3>
                {pendingApprovalActions.length === 0 ? (
                  <p className="text-sm text-slate-600">No actions need approval right now. When a moderator in approval phase uses a ModAnchor menu action, it will appear here before execution.</p>
                ) : (
                  <div className="space-y-2">
                    {pendingApprovalActions
                      .slice(0, approvalsVisibleCount)
                      .map((item) => (
                        (() => {
                          const target = getTargetContext(item.targetType, item.targetId, item.metadata);
                          return (
                        <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                          <p className="font-medium">Moderator: {normalizeUserDisplay(item.actorUsername)}</p>
                          <p className="text-slate-600">Requested action: {item.actionType.replaceAll('_', ' ')}</p>
                          <p className="text-slate-600">{target.primaryLabel}</p>
                          {item.targetType !== 'user' && (
                            <p className="text-slate-600">
                              {target.author ? `${normalizeUserDisplay(target.author)}` : 'Author unavailable'}
                              {target.parentPostTitle ? ` · Parent post: ${target.parentPostTitle}` : ''}
                            </p>
                          )}
                          {toAbsoluteRedditUrl(target.permalink) && (
                            <a
                              className="text-xs text-blue-700"
                              href={toAbsoluteRedditUrl(target.permalink)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => openLinkInNewTabOnNormalClick(event, toAbsoluteRedditUrl(target.permalink))}
                              onMouseDown={(event) => event.stopPropagation()}
                            >
                              Open {item.targetType}
                            </a>
                          )}
                          <p className="text-slate-600">Requested: {formatDate(item.createdAt)}</p>
                          {item.reason && <p className="text-slate-600">Reason: {item.reason}</p>}
                          {typeof item.metadata?.redditApiCallStatus === 'string' && (
                            <p className="text-slate-600">Execution: {item.metadata.redditApiCallStatus === 'succeeded' ? 'Succeeded' : 'Failed'}</p>
                          )}
                          {formatVerificationStatus(item.metadata) && (
                            <p className="text-slate-600">Verification: {formatVerificationStatus(item.metadata)}</p>
                          )}
                          {typeof item.metadata?.verificationError === 'string' && (
                            <p className="text-xs text-slate-500">Verification detail: {item.metadata.verificationError}</p>
                          )}
                          {typeof (item.metadata?.removalNote ?? item.metadata?.modNote) === 'string' && <p className="text-slate-600">Removal note: {String(item.metadata?.removalNote ?? item.metadata?.modNote)}</p>}
                          {formatRemovalNoteStatus(typeof item.metadata?.removalNoteStatus === 'string' ? item.metadata.removalNoteStatus : undefined) && (
                            <p className="text-slate-600">Removal note status: {formatRemovalNoteStatus(item.metadata?.removalNoteStatus as string)}</p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <button disabled={pendingDecisionAction?.id === item.id} onClick={() => void decideActionReview(item.id, 'approve')} className="rounded bg-blue-700 px-3 py-1 text-xs text-white disabled:opacity-60">{pendingDecisionAction?.id === item.id && pendingDecisionAction?.decision === 'approve' ? 'Approving...' : 'Approve and run'}</button>
                            <button disabled={pendingDecisionAction?.id === item.id} onClick={() => void decideActionReview(item.id, 'reject')} className="rounded border border-slate-300 px-3 py-1 text-xs disabled:opacity-60">{pendingDecisionAction?.id === item.id && pendingDecisionAction?.decision === 'reject' ? 'Rejecting...' : 'Reject'}</button>
                          </div>
                        </div>
                      )})()
                      ))}
                    {pendingApprovalActions.length > approvalsVisibleCount && (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
                        onClick={() => setApprovalsVisibleCount((count) => count + 25)}
                      >
                        Load more approvals
                      </button>
                    )}
                  </div>
                )}
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-medium">Recently reviewed actions</p>
                  {reviewedActions.length === 0 ? (
                    <p className="text-slate-600">No recently reviewed actions yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {reviewedActions
                        .map((item) => (
                          <li key={item.id}>
                            {formatDate(item.createdAt)} · {item.actionType.replaceAll('_', ' ')} · {item.executionStatus === 'approved_executed' ? 'Approved and ran' : 'Rejected'}
                            {formatRemovalNoteStatus(typeof item.metadata?.removalNoteStatus === 'string' ? item.metadata.removalNoteStatus : undefined)
                              ? ` · Note: ${formatRemovalNoteStatus(item.metadata?.removalNoteStatus as string)}`
                              : ''}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {modOnboardSection === 'monitoring' && modOnboardAccess?.canManageModOnboard && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Monitoring</h3>
                <p className="text-sm text-slate-600">Use this page to review actions taken by moderators in the Monitoring phase. Their ModAnchor actions run immediately and are recorded here for senior review.</p>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-medium">Moderators in Monitoring phase</p>
                  {reviewAssignments.filter((a) => a.status === 'active' && a.phase === 'monitored_actions').length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 text-slate-600">
                      {reviewAssignments
                        .filter((a) => a.status === 'active' && a.phase === 'monitored_actions')
                        .map((a) => (
                          <li key={`${a.username}-${a.assignedAt}`}>
                            {normalizeUserDisplay(a.username)} · Phase end: {formatDate(a.expectedPhaseEndAt)} · Report style: {a.reportMode === 'daily_digest' ? 'Daily digest' : 'Per action'} · Auto-graduate: {a.autoGraduate ? 'Enabled' : 'Disabled'}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <div className="space-y-1 text-slate-600">
                      <p>No moderators are currently in Monitoring phase.</p>
                      <p>Moderators in Approval phase will appear here after they move to Monitoring.</p>
                      {reviewAssignments
                        .filter((a) => a.status === 'active' && a.phase === 'approval_required')
                        .slice(0, 1)
                        .map((a) => (
                          <p key={`${a.username}-${a.assignedAt}`}>{normalizeUserDisplay(a.username)} is currently in Approval phase. Move them to the next phase when you are ready to begin monitoring.</p>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {modOnboardSection === 'action_console' && (
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-900">Action Console</h3>
                  <p className="text-sm text-slate-600">Submit moderation actions through ModAnchor Review Mode.</p>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Only actions submitted through ModAnchor are routed through Review Mode. Native Reddit actions are tracked separately where possible.
                  </div>
                </div>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {([
                    ['user', 'User'],
                    ['post', 'Post'],
                    ['comment', 'Comment'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActionConsolePage(key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${actionConsolePage === key ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3">
                  {actionConsolePreviewError && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      {actionConsolePreviewError}
                    </p>
                  )}
                  {actionConsolePage === 'user' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">User actions</h4>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose target</p>
                    <label className="block text-sm font-medium text-slate-700">Target username<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" placeholder="u/username" value={actionConsoleTargetUsername} onChange={(e) => setActionConsoleTargetUsername(e.target.value)} /></label>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose action</p>
                    <label className="block text-sm font-medium text-slate-700">Action<select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" value={actionConsoleUserActionType} onChange={(e) => setActionConsoleUserActionType(e.target.value as ModAnchorActionType)}><option value="ban_user">Ban user</option><option value="temp_ban_user">Temporary ban user</option><option value="unban_user">Unban user</option><option value="mute_user">Mute user</option><option value="unmute_user">Unmute user</option><option value="add_mod_note">Add mod note</option></select></label>
                    {actionConsoleUserActionType === 'temp_ban_user' && (
                      <label className="block text-sm font-medium text-slate-700">Ban duration<select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" value={String(actionConsoleUserDurationDays)} onChange={(e) => setActionConsoleUserDurationDays(Number(e.target.value))}><option value="3">3 days</option><option value="7">7 days</option><option value="28">28 days</option></select></label>
                    )}
                    {actionConsoleUserActionType === 'mute_user' && (
                      <p className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">Reddit controls mute duration for this action.</p>
                    )}
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</p>
                    <label className="block text-sm font-medium text-slate-700">Internal reason (optional)<textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" rows={2} value={actionConsoleUserReason} onChange={(e) => setActionConsoleUserReason(e.target.value)} /></label>
                    {actionConsoleUserActionType === 'add_mod_note' && <label className="block text-sm font-medium text-slate-700">Mod note<textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" rows={2} value={actionConsoleUserModNote} onChange={(e) => setActionConsoleUserModNote(e.target.value)} /></label>}
                    <div className="flex items-center gap-2 pt-1">
                      <button type="button" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" disabled={actionConsoleSubmitting} onClick={async () => {
                        const result = await submitActionConsole({
                          targetType: 'user',
                          targetUsername: actionConsoleTargetUsername,
                          actionType: actionConsoleUserActionType,
                          reason: actionConsoleUserReason || undefined,
                          modNote: actionConsoleUserActionType === 'add_mod_note' ? actionConsoleUserModNote || undefined : undefined,
                          ...(actionConsoleUserActionType === 'temp_ban_user'
                            ? { metadata: { durationDays: actionConsoleUserDurationDays, durationLabel: `${actionConsoleUserDurationDays} days` } }
                            : {}),
                        });
                        if (!result.ok) return;
                        setActionConsoleTargetUsername('');
                        setActionConsoleUserActionType('ban_user');
                        setActionConsoleUserDurationDays(7);
                        setActionConsoleUserReason('');
                        setActionConsoleUserModNote('');
                      }}>{actionConsoleSubmitting ? 'Submitting...' : 'Submit user action'}</button>
                      <button
                        type="button"
                        disabled={actionConsoleSubmitting}
                        onClick={() => {
                          setActionConsoleTargetUsername('');
                          setActionConsoleUserActionType('ban_user');
                          setActionConsoleUserDurationDays(7);
                          setActionConsoleUserReason('');
                          setActionConsoleUserModNote('');
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  )}
                  {actionConsolePage === 'post' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">Post actions</h4>
                    <p className="text-xs text-slate-600">Choose from the latest 100 subreddit posts, or paste a post ID/URL if the post is older.</p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose post</p>
                    <div className="flex items-center gap-2">
                      <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" placeholder="Search recent posts by title or author..." value={actionConsolePostSearch} onChange={(e) => setActionConsolePostSearch(e.target.value)} />
                      <button type="button" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium" onClick={() => void fetchActionConsoleRecentPosts()}>Refresh</button>
                    </div>
                    {actionConsolePostPickerOpen && (
                    <div className="space-y-1">
                      {actionConsoleRecentPosts
                        .filter((post) => {
                          const q = actionConsolePostSearch.trim().toLowerCase();
                          if (!q) return true;
                          return (
                            post.title.toLowerCase().includes(q) ||
                            (post.authorName ?? '').toLowerCase().includes(q) ||
                            (post.bodySnippet ?? '').toLowerCase().includes(q) ||
                            post.id.toLowerCase().includes(q)
                          );
                        })
                        .slice(0, 8)
                        .map((post) => (
                          <div key={post.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900">{post.title}</p>
                                <p className="text-slate-600">
                                  {post.authorName ? normalizeUserDisplay(post.authorName) : 'u/unknown'}
                                  {toAbsoluteRedditUrl(post.permalink) && (
                                    <>
                                      {' · '}
                                      <a
                                        className="text-blue-700 underline"
                                        href={toAbsoluteRedditUrl(post.permalink)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(event) => {
                                          try {
                                            setActionConsolePreviewError(null);
                                            openLinkInNewTabOnNormalClick(event, toAbsoluteRedditUrl(post.permalink));
                                          } catch {
                                            setActionConsolePreviewError('Could not open post preview. Try Cmd/Ctrl-click or copy the link.');
                                          }
                                        }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                      >
                                        Open post
                                      </a>
                                    </>
                                  )}
                                </p>
                              </div>
                              <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setActionConsoleSelectedPost(post); setActionConsolePostPickerOpen(false); setActionConsolePostManualOpen(false); }}>Select</button>
                            </div>
                            {post.bodySnippet && (
                              <div className="mt-1 text-slate-500">
                                <p className="whitespace-pre-wrap">
                                  {expandedPostSnippets[post.id] ? post.bodySnippet : truncateText(post.bodySnippet, 200)}
                                </p>
                                {post.bodySnippet.length > 200 && (
                                  <button
                                    type="button"
                                    className="mt-1 text-xs text-blue-700 underline"
                                    onClick={() =>
                                      setExpandedPostSnippets((prev) => ({
                                        ...prev,
                                        [post.id]: !prev[post.id],
                                      }))
                                    }
                                  >
                                    {expandedPostSnippets[post.id] ? 'Show less' : 'Show more'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      {actionConsoleRecentPosts.length === 0 && (
                        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">No recent posts loaded yet. Click Refresh.</p>
                      )}
                    </div>
                    )}
                    {actionConsoleSelectedPost && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        <p className="truncate">
                          Selected post: {actionConsoleSelectedPost.title} — {actionConsoleSelectedPost.authorName ? normalizeUserDisplay(actionConsoleSelectedPost.authorName) : 'u/unknown'}
                          {toAbsoluteRedditUrl(actionConsoleSelectedPost.permalink) && (
                            <>
                              {' · '}
                              <a
                                className="text-blue-700 underline"
                                href={toAbsoluteRedditUrl(actionConsoleSelectedPost.permalink)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => {
                                  try {
                                    setActionConsolePreviewError(null);
                                    openLinkInNewTabOnNormalClick(event, toAbsoluteRedditUrl(actionConsoleSelectedPost.permalink));
                                  } catch {
                                    setActionConsolePreviewError('Could not open post preview. Try Cmd/Ctrl-click or copy the link.');
                                  }
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                              >
                                Open post
                              </a>
                            </>
                          )}
                        </p>
                        <button type="button" className="rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-800" onClick={() => setActionConsolePostPickerOpen(true)}>Change</button>
                      </div>
                    )}
                    <button type="button" className="w-fit text-xs text-blue-700" onClick={() => setActionConsolePostManualOpen((v) => !v)}>{actionConsolePostManualOpen ? 'Hide pasted post ID/URL' : 'Paste post ID/URL instead'}</button>
                    {actionConsolePostManualOpen && <label className="block text-sm font-medium text-slate-700">Post ID/URL<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" placeholder="t3_xxx or Reddit post URL" value={actionConsolePostTargetInput} onChange={(e) => { setActionConsolePostTargetInput(e.target.value); if (e.target.value.trim()) setActionConsoleSelectedPost(null); }} /></label>}
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose action</p>
                    <label className="block text-sm font-medium text-slate-700">Action<select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" value={actionConsolePostActionType} onChange={(e) => setActionConsolePostActionType(e.target.value as ModAnchorActionType)}><option value="approve_post">Approve post</option><option value="remove_post">Remove post</option><option value="remove_post_spam">Remove post as spam</option><option value="lock_post">Lock post</option><option value="unlock_post">Unlock post</option></select></label>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</p>
                    <label className="block text-sm font-medium text-slate-700">Internal reason (optional)<textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" rows={2} value={actionConsolePostReason} onChange={(e) => setActionConsolePostReason(e.target.value)} /></label>
                    {(actionConsolePostActionType === 'remove_post' || actionConsolePostActionType === 'remove_post_spam') && <label className="block text-sm font-medium text-slate-700">Moderator removal note (optional)<textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" rows={2} value={actionConsolePostRemovalNote} onChange={(e) => setActionConsolePostRemovalNote(e.target.value)} /></label>}
                    <div className="flex items-center gap-2">
                    <button type="button" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" disabled={actionConsoleSubmitting} onClick={async () => {
                      const manualTarget = actionConsolePostTargetInput.trim();
                      const selectedTarget = actionConsoleSelectedPost?.id?.trim();
                      const finalTarget = selectedTarget || manualTarget;
                      if (!finalTarget) {
                        setModOnboardActionError('Select a post or paste a post ID/URL.');
                        return;
                      }
                      const result = await submitActionConsole({
                        targetType: 'post',
                        targetId: finalTarget,
                        actionType: actionConsolePostActionType,
                        reason: actionConsolePostReason || undefined,
                        modNote: actionConsolePostActionType === 'remove_post' || actionConsolePostActionType === 'remove_post_spam' ? actionConsolePostRemovalNote || undefined : undefined,
                        ...(actionConsoleSelectedPost ? { metadata: { title: actionConsoleSelectedPost.title, ...(actionConsoleSelectedPost.authorName ? { authorName: actionConsoleSelectedPost.authorName } : {}), ...(actionConsoleSelectedPost.bodySnippet ? { bodySnippet: actionConsoleSelectedPost.bodySnippet } : {}), ...(actionConsoleSelectedPost.permalink ? { permalink: actionConsoleSelectedPost.permalink } : {}) } } : {}),
                      });
                      if (!result.ok) return;
                      setActionConsoleSelectedPost(null);
                      setActionConsolePostSearch('');
                      setActionConsolePostTargetInput('');
                      setActionConsolePostReason('');
                      setActionConsolePostRemovalNote('');
                      setActionConsolePostActionType('approve_post');
                      setActionConsolePostManualOpen(false);
                      setActionConsolePostPickerOpen(false);
                    }}>{actionConsoleSubmitting ? 'Submitting...' : 'Submit post action'}</button>
                    <button
                      type="button"
                      disabled={actionConsoleSubmitting}
                      onClick={() => {
                        setActionConsoleSelectedPost(null);
                        setActionConsolePostSearch('');
                        setActionConsolePostTargetInput('');
                        setActionConsolePostReason('');
                        setActionConsolePostRemovalNote('');
                        setActionConsolePostActionType('approve_post');
                        setActionConsolePostManualOpen(false);
                        setActionConsolePostPickerOpen(true);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      Reset
                    </button>
                    </div>
                  </div>
                  )}
                  {actionConsolePage === 'comment' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">Comment actions</h4>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">1. Choose post</p>
                    {actionConsoleCommentPostPickerOpen || !actionConsoleSelectedCommentPost ? (
                      <>
                        <div className="flex items-center gap-2">
                          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" placeholder="Search recent posts by title or author..." value={actionConsoleCommentPostSearch} onChange={(e) => setActionConsoleCommentPostSearch(e.target.value)} />
                          <button type="button" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium" onClick={() => void fetchActionConsoleRecentPosts()}>Refresh</button>
                        </div>
                        <div className="space-y-1">
                          {actionConsoleRecentPosts
                            .filter((post) => {
                              const q = actionConsoleCommentPostSearch.trim().toLowerCase();
                              if (!q) return true;
                              return post.title.toLowerCase().includes(q) || (post.authorName ?? '').toLowerCase().includes(q) || (post.bodySnippet ?? '').toLowerCase().includes(q) || post.id.toLowerCase().includes(q);
                            })
                            .slice(0, 8)
                            .map((post) => (
                              <div key={`comment-post-${post.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-900">{post.title}</p>
                                    <p className="text-slate-600">{post.authorName ? normalizeUserDisplay(post.authorName) : 'u/unknown'}</p>
                                  </div>
                                  <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setActionConsoleSelectedCommentPost(post); setActionConsoleCommentPostPickerOpen(false); setActionConsoleSelectedComment(null); setActionConsolePostComments([]); void fetchActionConsolePostComments(post.id); }}>Select</button>
                                </div>
                              </div>
                            ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-start justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        <p>Selected post: {actionConsoleSelectedCommentPost.title} — {actionConsoleSelectedCommentPost.authorName ? normalizeUserDisplay(actionConsoleSelectedCommentPost.authorName) : 'u/unknown'}</p>
                        <button type="button" className="rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-800" onClick={() => setActionConsoleCommentPostPickerOpen(true)}>Change</button>
                      </div>
                    )}
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">2. Choose comment</p>
                    {(actionConsoleCommentPickerOpen || !actionConsoleSelectedComment) && (
                      <div className="flex items-center gap-2">
                        <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" placeholder="Search comments by text or author..." value={actionConsoleCommentSearch} onChange={(e) => setActionConsoleCommentSearch(e.target.value)} />
                        <button type="button" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium" disabled={!actionConsoleSelectedCommentPost || actionConsoleCommentsLoading} onClick={() => actionConsoleSelectedCommentPost && void fetchActionConsolePostComments(actionConsoleSelectedCommentPost.id)}>{actionConsoleCommentsLoading ? 'Loading…' : 'Refresh'}</button>
                      </div>
                    )}
                    {actionConsoleCommentsLoading && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Loading comments…</p>}
                    {actionConsoleCommentsError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">Could not load comments for this post. Try Refresh comments.</p>}
                    {!actionConsoleSelectedCommentPost && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Select a post to load comments.</p>}
                    {actionConsoleCommentPickerOpen || !actionConsoleSelectedComment ? (
                      <div className="space-y-1">
                        {actionConsolePostComments
                          .filter((comment) => {
                            const q = actionConsoleCommentSearch.trim().toLowerCase();
                            if (!q) return true;
                            return comment.bodySnippet.toLowerCase().includes(q) || (comment.authorName ?? '').toLowerCase().includes(q) || comment.id.toLowerCase().includes(q);
                          })
                          .slice(0, 8)
                          .map((comment) => (
                            <div key={comment.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="line-clamp-2 text-slate-900">{comment.bodySnippet}</p>
                                  <p className="text-slate-600">{comment.authorName ? normalizeUserDisplay(comment.authorName) : 'u/unknown'}{comment.parentPostTitle ? ` · ${comment.parentPostTitle}` : ''}</p>
                                </div>
                                <button type="button" className="rounded border border-slate-300 px-2 py-0.5 text-xs" onClick={() => { setActionConsoleSelectedComment(comment); setActionConsoleCommentPickerOpen(false); }}>Select</button>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        <p>Selected comment: {actionConsoleSelectedComment.bodySnippet} — {actionConsoleSelectedComment.authorName ? normalizeUserDisplay(actionConsoleSelectedComment.authorName) : 'u/unknown'}</p>
                        <button type="button" className="rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-800" onClick={() => setActionConsoleCommentPickerOpen(true)}>Change</button>
                      </div>
                    )}
                    <button type="button" className="w-fit text-xs text-blue-700" onClick={() => setActionConsoleCommentManualOpen((v) => !v)}>{actionConsoleCommentManualOpen ? 'Hide pasted comment ID/URL' : 'Paste comment ID/URL instead'}</button>
                    {actionConsoleCommentManualOpen && <label className="block text-sm font-medium text-slate-700">Or paste comment ID/URL<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" placeholder="t1_xxx or Reddit comment URL" value={actionConsoleCommentTargetInput} onChange={(e) => setActionConsoleCommentTargetInput(e.target.value)} /></label>}
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">3. Choose action</p>
                    <label className="block text-sm font-medium text-slate-700">Action<select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" value={actionConsoleCommentActionType} onChange={(e) => setActionConsoleCommentActionType(e.target.value as ModAnchorActionType)}><option value="approve_comment">Approve comment</option><option value="remove_comment">Remove comment</option><option value="remove_comment_spam">Remove comment as spam</option><option value="lock_comment">Lock comment</option><option value="unlock_comment">Unlock comment</option></select></label>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</p>
                    <label className="block text-sm font-medium text-slate-700">Internal reason (optional)<textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" rows={2} value={actionConsoleCommentReason} onChange={(e) => setActionConsoleCommentReason(e.target.value)} /></label>
                    {(actionConsoleCommentActionType === 'remove_comment' || actionConsoleCommentActionType === 'remove_comment_spam') && <label className="block text-sm font-medium text-slate-700">Moderator removal note (optional)<textarea className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" rows={2} value={actionConsoleCommentRemovalNote} onChange={(e) => setActionConsoleCommentRemovalNote(e.target.value)} /></label>}
                    <div className="flex items-center gap-2">
                    <button type="button" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" disabled={actionConsoleSubmitting} onClick={async () => {
                      const selectedTarget = actionConsoleSelectedComment?.id?.trim();
                      const manualTarget = actionConsoleCommentTargetInput.trim();
                      const finalTarget = selectedTarget || manualTarget;
                      if (!finalTarget) {
                        setModOnboardActionError('Select a comment or paste a comment ID/URL.');
                        return;
                      }
                      const result = await submitActionConsole({
                        targetType: 'comment',
                        targetId: finalTarget,
                        actionType: actionConsoleCommentActionType,
                        reason: actionConsoleCommentReason || undefined,
                        modNote: actionConsoleCommentActionType === 'remove_comment' || actionConsoleCommentActionType === 'remove_comment_spam' ? actionConsoleCommentRemovalNote || undefined : undefined,
                        ...(actionConsoleSelectedComment ? {
                          metadata: {
                            bodySnippet: actionConsoleSelectedComment.bodySnippet,
                            ...(actionConsoleSelectedComment.authorName ? { authorName: actionConsoleSelectedComment.authorName } : {}),
                            ...(actionConsoleSelectedComment.permalink ? { permalink: actionConsoleSelectedComment.permalink } : {}),
                            ...(actionConsoleSelectedComment.parentPostId ? { parentPostId: actionConsoleSelectedComment.parentPostId } : {}),
                            ...(actionConsoleSelectedComment.parentPostTitle ? { parentPostTitle: actionConsoleSelectedComment.parentPostTitle } : {}),
                          },
                        } : {}),
                      });
                      if (!result.ok) return;
                      setActionConsoleSelectedComment(null);
                      setActionConsoleCommentTargetInput('');
                      setActionConsoleCommentReason('');
                      setActionConsoleCommentRemovalNote('');
                      setActionConsoleCommentActionType('approve_comment');
                      setActionConsoleCommentManualOpen(false);
                    }}>{actionConsoleSubmitting ? 'Submitting...' : 'Submit comment action'}</button>
                    <button
                      type="button"
                      disabled={actionConsoleSubmitting}
                      onClick={() => {
                        setActionConsoleSelectedCommentPost(null);
                        setActionConsoleCommentPostSearch('');
                        setActionConsoleCommentPostPickerOpen(true);
                        setActionConsolePostComments([]);
                        setActionConsoleSelectedComment(null);
                        setActionConsoleCommentSearch('');
                        setActionConsoleCommentPickerOpen(true);
                        setActionConsoleCommentTargetInput('');
                        setActionConsoleCommentReason('');
                        setActionConsoleCommentRemovalNote('');
                        setActionConsoleCommentActionType('approve_comment');
                        setActionConsoleCommentManualOpen(false);
                        setActionConsoleCommentsError(null);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    >
                      Reset
                    </button>
                    </div>
                  </div>
                  )}
                </div>
                {!modOnboardAccess?.canManageModOnboard && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <h4 className="text-sm font-semibold text-slate-900">My submitted actions</h4>
                    {myActionReviews.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">No actions submitted yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {(showAllMyActions ? myActionReviews : myActionReviews.slice(0, 10)).map((item) => {
                          const statusLabel =
                            item.executionStatus === 'pending_approval'
                              ? 'Pending senior approval'
                              : item.executionStatus === 'approved_executed'
                                ? 'Approved and executed'
                                : item.executionStatus === 'rejected'
                                  ? 'Rejected'
                                  : item.executionStatus === 'executed_monitored'
                                    ? 'Executed and monitored'
                                    : item.executionStatus === 'failed'
                                      ? 'Failed'
                                      : 'Executed';
                          const statusBadgeClass =
                            item.executionStatus === 'pending_approval'
                              ? 'bg-amber-100 text-amber-800'
                              : item.executionStatus === 'approved_executed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : item.executionStatus === 'executed_monitored'
                                  ? 'bg-blue-100 text-blue-800'
                                  : item.executionStatus === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-slate-200 text-slate-700';
                          return (
                            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-slate-900">{formatActionLabel(item.actionType)}</p>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass}`}>{statusLabel}</span>
                              </div>
                              <p>{getTargetContext(item.targetType, item.targetId, item.metadata).primaryLabel}</p>
                              {item.reason && <p>Reason: {item.reason}</p>}
                              {typeof item.metadata?.redditApiCallStatus === 'string' && (
                                <p>Execution: {item.metadata.redditApiCallStatus === 'succeeded' ? 'Succeeded' : 'Failed'}</p>
                              )}
                              {formatVerificationStatus(item.metadata) && (
                                <p>Verification: {formatVerificationStatus(item.metadata)}</p>
                              )}
                              {item.executionStatus === 'executed_monitored' && (
                                <p>
                                  Modmail: {item.modmailDeliveryStatus === 'sent'
                                    ? 'Sent'
                                    : item.modmailDeliveryStatus === 'pending'
                                      ? 'Pending digest'
                                      : item.modmailDeliveryStatus === 'failed'
                                        ? 'Delivery failed'
                                        : 'Not required'}
                                </p>
                              )}
                              {item.executionStatus === 'executed_monitored' && item.modmailDeliveryError && (
                                <p className="text-slate-500">Modmail detail: {item.modmailDeliveryError}</p>
                              )}
                              <p className="text-slate-500">When: {formatDate(item.createdAt)}</p>
                            </div>
                          );
                        })}
                        {myActionReviews.length > 10 && (
                          <button
                            type="button"
                            className="text-xs text-blue-700 underline"
                            onClick={() => setShowAllMyActions((prev) => !prev)}
                          >
                            {showAllMyActions ? 'Show fewer' : `Show all (${myActionReviews.length})`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
            {modOnboardSection === 'monitoring' && modOnboardAccess?.canManageModOnboard && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Recent monitored actions</h3>
                {monitoredActions.length === 0 ? (
                  <p className="text-sm text-slate-600">No monitored actions yet. When a moderator in monitoring phase uses a ModAnchor menu action, it will appear here after it runs.</p>
                ) : (
                  <div className="space-y-2">
                    {monitoredActions
                      .slice(0, monitoringVisibleCount)
                      .map((item) => (
                        (() => {
                          const target = getTargetContext(item.targetType, item.targetId, item.metadata);
                          return (
                        <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                          <p className="font-medium">Moderator: {normalizeUserDisplay(item.actorUsername)}</p>
                          <p className="text-slate-600">Action: {formatActionLabel(item.actionType)}</p>
                          <p className="text-slate-600">{target.primaryLabel}</p>
                          {item.targetType !== 'user' && (
                            <p className="text-slate-600">
                              {target.author ? `${normalizeUserDisplay(target.author)}` : 'Author unavailable'}
                              {target.parentPostTitle ? ` · Parent post: ${target.parentPostTitle}` : ''}
                            </p>
                          )}
                          {toAbsoluteRedditUrl(target.permalink) && (
                            <a
                              className="text-xs text-blue-700"
                              href={toAbsoluteRedditUrl(target.permalink)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => openLinkInNewTabOnNormalClick(event, toAbsoluteRedditUrl(target.permalink))}
                              onMouseDown={(event) => event.stopPropagation()}
                            >
                              Open {item.targetType}
                            </a>
                          )}
                          {item.reason && <p className="text-slate-600">Reason: {item.reason}</p>}
                          {typeof item.metadata?.redditApiCallStatus === 'string' && (
                            <p className="text-slate-600">Execution: {item.metadata.redditApiCallStatus === 'succeeded' ? 'Succeeded' : 'Failed'}</p>
                          )}
                          {formatVerificationStatus(item.metadata) && (
                            <p className="text-slate-600">Verification: {formatVerificationStatus(item.metadata)}</p>
                          )}
                          {typeof (item.metadata?.removalNote ?? item.metadata?.modNote) === 'string' && <p className="text-slate-600">Removal note: {String(item.metadata?.removalNote ?? item.metadata?.modNote)}</p>}
                          {formatRemovalNoteStatus(typeof item.metadata?.removalNoteStatus === 'string' ? item.metadata.removalNoteStatus : undefined) && (
                            <p className="text-slate-600">Removal note status: {formatRemovalNoteStatus(item.metadata?.removalNoteStatus as string)}</p>
                          )}
                          <p className="text-slate-600">When: {formatDate(item.createdAt)} · Report style: {item.reportMode === 'daily_digest' ? 'Daily digest' : 'Per action'} · Modmail: {item.modmailDeliveryStatus === 'sent' ? 'Sent' : item.modmailDeliveryStatus === 'pending' ? 'Pending digest' : item.modmailDeliveryStatus === 'failed' ? 'Delivery failed' : 'Not required'} · Status: Ran and recorded</p>
                        </div>
                      )})()
                      ))}
                    {monitoredActions.length > monitoringVisibleCount && (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
                        onClick={() => setMonitoringVisibleCount((count) => count + 25)}
                      >
                        Load more monitored actions
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {modOnboardSection === 'monitoring' && modOnboardAccess?.canManageModOnboard && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Daily monitoring digests</h3>
                  <button
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    disabled={digestGenerating}
                    onClick={async () => {
                      setModOnboardActionError(null);
                      setDigestGenerating(true);
                      try {
                        const res = await fetch('/api/modonboard/monitoring-digests/generate', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ sendModmail: true }),
                        });
                        const data: (MonitoringDigestsResponse & { error?: string }) = await res.json();
                        if (!res.ok) throw new Error(data.error ?? 'Failed to generate daily digest.');
                        setMonitoringDigests(data.digests ?? []);
                        setModOnboardActionSuccess('Daily digest generated.');
                        showSuccessToast('Daily digest generated.');
                      } catch (error) {
                        const message = error instanceof Error ? error.message : 'Failed to generate daily digest.';
                        setModOnboardActionError(message);
                        showErrorToast(message);
                      } finally {
                        setDigestGenerating(false);
                      }
                    }}
                  >
                    {digestGenerating ? 'Generating...' : 'Generate daily digest'}
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  Automatic daily digest runs at 00:00 UTC. Use this button to retry or generate manually.
                </p>
                {monitoringDigests.length === 0 ? (
                  <p className="text-sm text-slate-600">No daily digests generated yet.</p>
                ) : (
                  <div className="space-y-2">
                    {monitoringDigests.slice(0, 20).map((digest) => (
                      <div key={digest.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <p className="font-medium">Moderator: {normalizeUserDisplay(digest.actorUsername)}</p>
                        <p className="text-slate-600">Date: {digest.digestDate} UTC · Total actions: {digest.totalActions}</p>
                        <p className="text-slate-600">Delivery: {digest.deliveryStatus === 'sent' ? 'Sent' : digest.deliveryStatus === 'failed' ? 'Delivery failed' : 'Pending digest'}</p>
                        {digest.deliveredAt && <p className="text-slate-600">Delivered: {formatDate(digest.deliveredAt)}</p>}
                        <p className="text-slate-600">{digest.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {modOnboardSection === 'moderators' && modOnboardAccess?.canManageModOnboard && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Moderators in review</h3>
              <p className="text-xs text-slate-600">Track moderators currently going through ModAnchor Review Mode.</p>
              {reviewAssignments.length === 0 && (
                <div className="space-y-1">
                  <p className="text-sm text-slate-600">No moderators are currently in Review Mode.</p>
                  <p className="text-xs text-slate-500">Start a review from the Start Review tab to onboard a new moderator.</p>
                </div>
              )}
              {activeReviewAssignments.map((assignment) => {
                const reportForUser = reviewReportsByUsername[assignment.username.toLowerCase()];
                return (
                <div key={`${assignment.username}-${assignment.assignedAt}`} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-medium">{normalizeUserDisplay(assignment.username)}</p>
                  <p className="text-slate-600">Current phase: {formatReviewPhase(assignment.phase)} · Status: {assignment.status}</p>
                  <p className="text-slate-600">Phase end date: {formatDate(assignment.expectedPhaseEndAt)}</p>
                  <p className="text-slate-600">Policy: Approval: {formatDurationMinutes(typeof assignment.phase1DurationMinutes === 'number' ? assignment.phase1DurationMinutes : assignment.phase1Days * 24 * 60)} · Monitoring: {formatDurationMinutes(typeof assignment.phase2DurationMinutes === 'number' ? assignment.phase2DurationMinutes : assignment.phase2Days * 24 * 60)} · {assignment.reportMode === 'per_action' ? 'Per action' : 'Daily digest'}</p>
                  <div className="mt-2 flex gap-2">
                    <button disabled={!modOnboardAccess?.canManageModOnboard || phaseMutationPending?.username === assignment.username} onClick={() => void mutateReviewPhase(assignment.username, 'advance')} className="rounded border border-slate-300 px-3 py-1 text-xs disabled:opacity-60">{phaseMutationPending?.username === assignment.username && phaseMutationPending.action === 'advance' ? 'Moving...' : 'Move to next phase'}</button>
                    <button disabled={!modOnboardAccess?.canManageModOnboard || phaseMutationPending?.username === assignment.username} onClick={() => void mutateReviewPhase(assignment.username, 'complete')} className="rounded border border-slate-300 px-3 py-1 text-xs disabled:opacity-60">{phaseMutationPending?.username === assignment.username && phaseMutationPending.action === 'complete' ? 'Completing...' : 'Complete review'}</button>
                    {assignment.status === 'active' && (
                      <button
                        disabled={!modOnboardAccess?.canManageModOnboard || !!editReviewSavingFor}
                        onClick={() => startEditReviewSetup(assignment)}
                        className="rounded border border-slate-300 px-3 py-1 text-xs disabled:opacity-60"
                      >
                        Edit setup
                      </button>
                    )}
                    <button disabled={!modOnboardAccess?.canManageModOnboard || reportGeneratingFor === assignment.username} onClick={() => void generateModReport(assignment.username, Math.max(1, Math.ceil(((typeof assignment.phase1DurationMinutes === 'number' ? assignment.phase1DurationMinutes : assignment.phase1Days * 24 * 60) + (typeof assignment.phase2DurationMinutes === 'number' ? assignment.phase2DurationMinutes : assignment.phase2Days * 24 * 60)) / (24 * 60))), `${assignment.username}-${assignment.assignedAt}`)} className="rounded bg-blue-700 px-3 py-1 text-xs text-white disabled:opacity-60">{reportGeneratingFor === assignment.username ? 'Generating...' : 'Generate report'}</button>
                  </div>
                  {editingReviewUsername === assignment.username && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Edit review setup</p>
                      {assignment.phase === 'approval_required' && (
                        <p className="text-xs text-slate-600">Updating approval duration will recalculate the current approval phase end time.</p>
                      )}
                      {assignment.phase === 'monitored_actions' && (
                        <p className="text-xs text-slate-600">Updating monitoring duration will recalculate the current monitoring phase end time. Report style changes apply to future monitored actions.</p>
                      )}
                      {assignment.phase === 'ready_for_graduation' && (
                        <p className="text-xs text-slate-600">This moderator is ready for graduation. Duration changes will not affect the current phase.</p>
                      )}
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="text-xs text-slate-600">Approval days<input type="number" min={0} value={editReviewPhase1Days} onChange={(e) => setEditReviewPhase1Days(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                        <label className="text-xs text-slate-600">Approval hours<input type="number" min={0} max={23} value={editReviewPhase1Hours} onChange={(e) => setEditReviewPhase1Hours(Math.min(23, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                        <label className="text-xs text-slate-600">Approval minutes<input type="number" min={0} max={59} value={editReviewPhase1Minutes} onChange={(e) => setEditReviewPhase1Minutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="text-xs text-slate-600">Monitoring days<input type="number" min={0} value={editReviewPhase2Days} onChange={(e) => setEditReviewPhase2Days(Math.max(0, Number(e.target.value) || 0))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                        <label className="text-xs text-slate-600">Monitoring hours<input type="number" min={0} max={23} value={editReviewPhase2Hours} onChange={(e) => setEditReviewPhase2Hours(Math.min(23, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                        <label className="text-xs text-slate-600">Monitoring minutes<input type="number" min={0} max={59} value={editReviewPhase2Minutes} onChange={(e) => setEditReviewPhase2Minutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" /></label>
                      </div>
                      <label className="block text-xs text-slate-600">Monitoring report style
                        <select value={editReviewReportMode} onChange={(e) => setEditReviewReportMode(e.target.value as 'per_action' | 'daily_digest')} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm">
                          <option value="per_action">Per action</option>
                          <option value="daily_digest">Daily digest</option>
                        </select>
                      </label>
                      <p className="text-xs text-slate-500">Report style changes apply to future monitored actions only.</p>
                      {editReviewReportMode === 'per_action' && (
                        <p className="text-xs text-amber-700">Per-action modmail can be noisy in busy communities. Daily digest is recommended for high-volume subreddits.</p>
                      )}
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editReviewAutoGraduate} onChange={(e) => setEditReviewAutoGraduate(e.target.checked)} />
                        Auto-graduate after review period
                      </label>
                      {editReviewError && <p className="text-xs text-red-600">{editReviewError}</p>}
                      <div className="flex gap-2">
                        <button
                          disabled={editReviewSavingFor === assignment.username}
                          onClick={() => void saveEditReviewSetup(assignment)}
                          className="rounded bg-blue-700 px-3 py-1 text-xs text-white disabled:opacity-60"
                        >
                          {editReviewSavingFor === assignment.username ? 'Saving...' : 'Save changes'}
                        </button>
                        <button
                          disabled={editReviewSavingFor === assignment.username}
                          onClick={cancelEditReviewSetup}
                          className="rounded border border-slate-300 px-3 py-1 text-xs disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {reportForUser && (
                    <article className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {(() => {
                        const modReport = reportForUser;
                        return (
                          <>
                            <div>
                              <h4 className="text-sm font-semibold">Review report for {normalizeUserDisplay(modReport.username)}</h4>
                              {modReport.assessment && (
                                <span className="mt-1 inline-flex rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                  {modReport.assessment.label}
                                </span>
                              )}
                              <p className="text-xs text-slate-600">Period: {modReport.periodStart ? formatDate(modReport.periodStart) : `Last ${modReport.periodDays} days`} → {modReport.periodEnd ? formatDate(modReport.periodEnd) : formatDate(modReport.generatedAt)}</p>
                              <p className="text-xs text-slate-600">Generated: {formatDate(modReport.generatedAt)}</p>
                            </div>
                            {modReport.assessment?.recommendedNextStep && (
                              <div className="rounded border border-slate-200 bg-white p-2">
                                <p className="text-[11px] font-medium text-slate-600">Recommended next step</p>
                                <p className="text-xs text-slate-800">{modReport.assessment.recommendedNextStep}</p>
                              </div>
                            )}
                            <p className="text-xs text-slate-700">{modReport.summary}</p>
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                              <div className="rounded border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Total</p><p className="font-semibold">{modReport.metrics?.totalActions ?? 0}</p></div>
                              <div className="rounded border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Approved</p><p className="font-semibold">{modReport.metrics?.approvedExecuted ?? 0}</p></div>
                              <div className="rounded border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Rejected</p><p className="font-semibold">{modReport.metrics?.rejected ?? 0}</p></div>
                              <div className="rounded border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Monitored</p><p className="font-semibold">{modReport.metrics?.executedMonitored ?? 0}</p></div>
                              <div className="rounded border border-slate-200 bg-white p-2"><p className="text-[11px] text-slate-500">Failed</p><p className="font-semibold">{modReport.metrics?.failed ?? 0}</p></div>
                            </div>
                            <div>
                              <p className="text-xs font-medium">Decision quality</p>
                              <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 md:grid-cols-4">
                                <p>Approval rate: {formatPercent(modReport.decisionMetrics?.approvalRate)}</p>
                                <p>Rejection rate: {formatPercent(modReport.decisionMetrics?.rejectionRate)}</p>
                                <p>Pending actions: {modReport.decisionMetrics?.pendingCount ?? 0}</p>
                                <p>Failed actions: {modReport.decisionMetrics?.failedCount ?? 0}</p>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-medium">Action breakdown</p>
                              <ul className="list-disc pl-5 text-xs text-slate-700">
                                {summarizeActionBreakdown(modReport.actionCounts).map((row) => (
                                  <li key={`${modReport.id}-${row.label}`}>{row.label}: {row.count}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-medium">Native Reddit action usage</p>
                              <p className="text-xs text-slate-700">Detected actions: {modReport.nativeActionSummary?.totalCount ?? 0}</p>
                              {Boolean(Object.keys(modReport.nativeActionSummary?.breakdown ?? {}).length) && (
                                <ul className="list-disc pl-5 text-xs text-slate-700">
                                  {Object.entries(modReport.nativeActionSummary?.breakdown ?? {}).map(([action, count]) => (
                                    <li key={`${modReport.id}-native-${action}`}>{action}: {count}</li>
                                  ))}
                                </ul>
                              )}
                              <p className="text-[11px] text-slate-500">{modReport.nativeActionSummary?.note ?? 'ModAnchor cannot block native Reddit actions. This section uses moderation-log activity where available.'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium">What needs attention</p>
                              <ul className="list-disc pl-5 text-xs text-slate-700">{modReport.focusAreas.map((area, i) => <li key={i}>{area}</li>)}</ul>
                            </div>
                            <div>
                              <p className="text-xs font-medium">Coaching suggestions</p>
                              <ul className="list-disc pl-5 text-xs text-slate-700">
                                {(modReport.coachingSuggestions?.length ? modReport.coachingSuggestions : modReport.recommendations.map((r) => r.suggestedAction)).map((item, i) => <li key={`${modReport.id}-coach-${i}`}>{item}</li>)}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-medium">Recent actions</p>
                              {modReport.recentActions?.length ? (
                                <div className="space-y-2">
                                  {modReport.recentActions.slice(0, 10).map((a) => (
                                    (() => {
                                      const target = getTargetContext(
                                        a.targetType,
                                        a.targetId,
                                        makeTargetMetadata({
                                          title: a.targetTitle,
                                          bodySnippet: a.targetSnippet,
                                          authorName: a.targetAuthor,
                                          permalink: a.targetPermalink,
                                          parentPostTitle: a.parentPostTitle,
                                        })
                                      );
                                      return (
                                    <div key={a.id} className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                      <p><span className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-medium">{a.friendlyStatus}</span> <span className="font-medium text-slate-900">{a.friendlyAction}</span></p>
                                      <p>{target.primaryLabel}</p>
                                      <p>{target.author ? normalizeUserDisplay(target.author) : 'Author unavailable'}{target.parentPostTitle ? ` · Parent post: ${target.parentPostTitle}` : ''}</p>
                                      {toAbsoluteRedditUrl(target.permalink) && (
                                        <a
                                          className="text-blue-700"
                                          href={toAbsoluteRedditUrl(target.permalink)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(event) => openLinkInNewTabOnNormalClick(event, toAbsoluteRedditUrl(target.permalink))}
                                          onMouseDown={(event) => event.stopPropagation()}
                                        >
                                          Open {a.targetType}
                                        </a>
                                      )}
                                      <p>When: {formatDate(a.createdAt)}</p>
                                      <p>Reason: {a.reason?.trim() ? a.reason : 'No reason provided'}</p>
                                      {a.removalNote && <p>Removal note: {a.removalNote}</p>}
                                      {formatRemovalNoteStatus(a.removalNoteStatus) && <p>Removal note status: {formatRemovalNoteStatus(a.removalNoteStatus)}</p>}
                                      <p>Decision: {a.friendlyStatus}</p>
                                    </div>
                                  )})()
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-600">No ModAnchor actions were recorded for this moderator during the review period.</p>
                              )}
                            </div>
                            <button onClick={() => void copyModOnboardReport(modReport)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">Copy report</button>
                          </>
                        );
                      })()}
                    </article>
                  )}
                </div>
              )})}
              {reviewAssignments.filter((assignment) => assignment.status === 'completed').length > 0 && (
                <div className="mt-3 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed reviews</h4>
                  {reviewAssignments
                    .filter((assignment) => assignment.status === 'completed')
                    .map((assignment) => (
                      <div
                        key={`completed-${assignment.username}-${assignment.assignedAt}`}
                        className="flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <p className="text-slate-700">
                          {normalizeUserDisplay(assignment.username)} · {formatReviewPhase(assignment.phase)} · Completed {formatDate(assignment.expectedPhaseEndAt)}
                        </p>
                        <button
                          disabled={!modOnboardAccess?.canManageModOnboard || reportGeneratingFor === assignment.username}
                          onClick={() =>
                            void generateModReport(
                              assignment.username,
                              Math.max(
                                1,
                                Math.ceil(
                                  ((typeof assignment.phase1DurationMinutes === 'number'
                                    ? assignment.phase1DurationMinutes
                                    : assignment.phase1Days * 24 * 60) +
                                    (typeof assignment.phase2DurationMinutes === 'number'
                                      ? assignment.phase2DurationMinutes
                                      : assignment.phase2Days * 24 * 60)) /
                                    (24 * 60)
                                )
                              ),
                              `${assignment.username}-${assignment.assignedAt}`
                            )
                          }
                          className="rounded bg-blue-700 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                        >
                          {reportGeneratingFor === assignment.username ? 'Generating...' : 'Generate report'}
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
            )}

            {modOnboardSection === 'settings' && modOnboardAccess?.canManageModOnboard && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">Senior access</p>
                <button onClick={() => setShowSeniorAccessPolicy((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                  {showSeniorAccessPolicy ? 'Hide senior access' : 'Edit senior access'}
                </button>
              </div>
              <p className="text-xs text-slate-700">Senior access is based on strong Reddit moderator permissions or manual senior assignment.</p>
              {showSeniorAccessPolicy && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seniorAccessPolicy.autoSeniorByRedditPermissions} onChange={(e) => setSeniorAccessPolicy((s) => ({ ...s, autoSeniorByRedditPermissions: e.target.checked }))} /> Automatically treat mods with Everything permission as senior</label>
                  <label className="text-xs text-slate-600">Strong permissions<input value={seniorAccessPolicy.strongRedditPermissions.join(', ')} onChange={(e) => setSeniorAccessPolicy((s) => ({ ...s, strongRedditPermissions: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seniorAccessPolicy.allowManualSeniorOverride} onChange={(e) => setSeniorAccessPolicy((s) => ({ ...s, allowManualSeniorOverride: e.target.checked }))} /> Allow manual senior assignment</label>
                  {modOnboardAccess?.reason?.includes('Initial setup mode') && <p className="text-xs text-slate-500">Initial setup mode is active. Mark at least one senior moderator to lock down ModOnboard.</p>}
                  {seniorOverrides.length > 0 && <p className="text-xs text-slate-600">Manual senior mods: {seniorOverrides.map((u) => normalizeUserDisplay(u)).join(', ')}</p>}
                  <div className="flex items-center gap-2">
                    <button disabled={!modOnboardAccess?.canManageModOnboard || seniorPolicySaving} onClick={() => void saveSeniorAccessPolicyConfig()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{seniorPolicySaving ? 'Saving...' : 'Save Senior Access Policy'}</button>
                    <button
                      type="button"
                      disabled={seniorPolicySaving}
                      onClick={() => {
                        setSeniorAccessPolicy(defaultSeniorAccessPolicy);
                        setShowSeniorAccessPolicy(false);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}

            {modOnboardSection === 'settings' && modOnboardAccess?.canManageModOnboard && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <p className="font-semibold text-slate-800">How Review Mode works</p>
              <p>Approval phase: actions through ModAnchor are queued for senior approval before they run.</p>
              <p>Monitoring phase: actions through ModAnchor run immediately and are recorded for review.</p>
              <p>Outside ModAnchor: Reddit actions cannot be blocked here. They can only be analyzed later from mod logs where available.</p>
              <p>Posts & Comments permission is optional. It is recommended when you want junior mods to use ModAnchor post/comment menu actions directly.</p>
            </div>
            )}
              </>
            )}

            {modCopyStatus && <p className="text-xs text-slate-600">{modCopyStatus}</p>}
          </section>
        )}

        {tab === 'guide' && modOnboardAccess?.canViewModOnboard && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
              <h3 className="text-base font-semibold text-slate-900">ModAnchor Guide</h3>
              <p className="text-sm text-slate-700">
                {modOnboardAccess?.canManageModOnboard
                  ? 'ModAnchor helps senior moderators onboard new moderators safely through Review Mode, action approvals, monitored actions, and review reports.'
                  : 'ModAnchor helps you learn subreddit moderation with senior moderator review.'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-sm font-semibold text-slate-900">What is ModAnchor?</p>
              <p className="text-xs text-slate-700">ModAnchor is a moderation onboarding workspace designed for senior moderators training junior moderators through reviewed workflows.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-sm font-semibold text-slate-900">Review Mode phases</p>
              <p className="text-xs text-slate-700"><span className="font-medium">Strict / Approval:</span> actions are queued and require senior approval.</p>
              <p className="text-xs text-slate-700"><span className="font-medium">Monitored / Lenient:</span> actions can run immediately through ModAnchor and are reviewed after execution.</p>
              <p className="text-xs text-slate-700"><span className="font-medium">Graduation:</span> senior moderators review reports and complete onboarding when ready.</p>
            </div>

            {modOnboardAccess?.canManageModOnboard ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-900">Senior moderator workflow</p>
                <ol className="list-decimal pl-5 text-xs text-slate-700 space-y-1">
                  <li>Grant permissions needed for the current onboarding phase.</li>
                  <li>In private subreddits, ensure the junior moderator is an approved user so they can open ModAnchor.</li>
                  <li>For minimal-permission onboarding, use Action Console.</li>
                  <li>For menu-action onboarding, enable Posts & Comments permission.</li>
                  <li>Start Review Mode from ModOnboard.</li>
                  <li>Use Approval phase for close review, then Monitoring when ready.</li>
                  <li>Review queued actions in Approvals and monitored actions in Monitoring.</li>
                  <li>Generate reports and coach based on rejections/failures/native usage.</li>
                </ol>
                <p className="text-xs text-slate-600">In private subreddits, ModAnchor attempts to add reviewed moderators as approved users during onboarding when API permissions allow it. Posts & Comments permission improves ModAnchor menu access but also exposes native Reddit controls. Native Reddit actions cannot be blocked; review report tracking for bypass signals.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-900">Junior moderator workflow</p>
                <ol className="list-decimal pl-5 text-xs text-slate-700 space-y-1">
                  <li>Open ModAnchor from subreddit workspace/menu.</li>
                  <li>Use Action Console for supported actions.</li>
                  <li>If you do not see ModAnchor post/comment menu actions, use Action Console.</li>
                  <li>If menu actions are visible, prefer ModAnchor actions over native Reddit controls.</li>
                  <li>Always include clear internal reasons.</li>
                  <li>In Approval phase, actions wait for senior approval.</li>
                  <li>In Monitoring phase, actions may run immediately but are still reviewed.</li>
                  <li>Check My submitted actions for status updates.</li>
                </ol>
                <p className="text-xs text-slate-600">Native Reddit actions taken outside ModAnchor may appear in your review report as outside-ModAnchor activity.</p>
              </div>
            )}
          </section>
        )}

        {tab === 'history' && modOnboardAccess?.canViewReports && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">Report History</h3>
                <p className="text-sm text-slate-600">Review previously generated ModAnchor reports.</p>
              </div>
              <button
                onClick={() => void fetchHistory()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                {historyLoading ? 'Refreshing...' : 'Refresh History'}
              </button>
              {!deleteAllReportsConfirmOpen ? (
                <button
                  onClick={() => setDeleteAllReportsConfirmOpen(true)}
                  disabled={reportsDeletingAll}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 disabled:opacity-60"
                >
                  Delete all reports
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2">
                  <span className="text-xs text-amber-800">Delete all report history?</span>
                  <button
                    onClick={() => void deleteAllHistoryReports()}
                    disabled={reportsDeletingAll}
                    className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-800 disabled:opacity-60"
                  >
                    {reportsDeletingAll ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setDeleteAllReportsConfirmOpen(false)}
                    disabled={reportsDeletingAll}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {!historyResetConfirmOpen ? (
                <button
                  onClick={() => setHistoryResetConfirmOpen(true)}
                  disabled={historyResetting}
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 disabled:opacity-60"
                >
                  Clear All ModAnchor Data
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-2">
                  <span className="text-xs text-red-700">Clear all workspace data?</span>
                  <button
                    onClick={() => void resetModAnchorData()}
                    disabled={historyResetting}
                    className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 disabled:opacity-60"
                  >
                    {historyResetting ? 'Clearing...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setHistoryResetConfirmOpen(false)}
                    disabled={historyResetting}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {history.slice(0, historyVisibleCount).map((report) => (
              <article key={report.id} className={`rounded-xl border p-3 text-sm ${recentlyGeneratedReportId === report.id ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {report.type === 'rulegap' ? 'RuleGap' : 'ModOnboard'}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700">
                    {report.periodDays} days
                  </span>
                  <span className="text-xs text-slate-500">{toUtcDateKey(report.generatedAt)} UTC</span>
                </div>
                <p className="mt-2 text-slate-700">{report.summary}</p>
                {report.type === 'rulegap' && (
                  <p className="mt-1 text-slate-600">
                    Source: {report.source === 'real_activity' ? 'Loaded activity' : 'Legacy demo report'}
                  </p>
                )}
                <div className="mt-2">
                  {confirmDeleteReportId !== report.id ? (
                    <button
                      onClick={() => setConfirmDeleteReportId(report.id)}
                      disabled={reportDeletingId === report.id}
                      className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 disabled:opacity-60"
                    >
                      {reportDeletingId === report.id ? 'Deleting...' : 'Delete'}
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1">
                      <span className="text-[11px] text-red-700">Delete this report?</span>
                      <button
                        onClick={() => void deleteHistoryReport(report.id)}
                        disabled={reportDeletingId === report.id}
                        className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] text-red-700 disabled:opacity-60"
                      >
                        {reportDeletingId === report.id ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteReportId(null)}
                        disabled={reportDeletingId === report.id}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {report.type === 'rulegap' ? (
                  <p className="mt-1 text-slate-600">Issue count: {report.issues.length}</p>
                ) : (
                  <div className="mt-1 text-slate-600">
                    {(() => {
                      const headerReport = historyDetailById[report.id] ?? report;
                      const metrics = headerReport.type === 'modonboard' ? headerReport.metrics : undefined;
                      const focusCount =
                        headerReport.type === 'modonboard'
                          ? Array.isArray(headerReport.focusAreas)
                            ? headerReport.focusAreas.length
                            : undefined
                          : undefined;
                      return (
                        <>
                    <p>Moderator: {normalizeUserDisplay(report.username)}</p>
                    <p>Focus areas: {toCountText(focusCount)}</p>
                    <p>Total actions: {toCountText(metrics?.totalActions)}</p>
                    <p>Status: Approved {toCountText(metrics?.approvedExecuted)} · Monitored {toCountText(metrics?.executedMonitored)} · Rejected {toCountText(metrics?.rejected)} · Failed {toCountText(metrics?.failed)}</p>
                        </>
                      );
                    })()}
                  </div>
                )}

                <button
                  onClick={() =>
                    void (async () => {
                      const nextExpanded = !expandedHistory[report.id];
                      if (nextExpanded && historyListMode && !historyDetailById[report.id]) {
                        await ensureHistoryReportDetail(report.id);
                      }
                      setExpandedHistory((prev) => ({
                        ...prev,
                        [report.id]: nextExpanded,
                      }));
                    })()
                  }
                  className="mt-2 text-xs font-medium text-blue-700"
                >
                  {expandedHistory[report.id] ? 'Hide Details' : 'View Details'}
                </button>

                {expandedHistory[report.id] && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    {historyListMode && report.type === 'modonboard' && !historyDetailById[report.id] && historyDetailLoadingById[report.id] ? (
                      <p className="text-xs text-slate-600">Loading report details…</p>
                    ) : historyListMode && report.type === 'modonboard' && !historyDetailById[report.id] ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-600">
                          {historyDetailErrorById[report.id] ?? 'Could not load full report details yet.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => void ensureHistoryReportDetail(report.id)}
                          className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                        >
                          Retry loading details
                        </button>
                      </div>
                    ) : (
                    (() => {
                      const fullReport = historyDetailById[report.id] ?? report;
                      return (
                        <>
                    {fullReport.type === 'rulegap' && fullReport.sourceSummary && (
                      <p className="mb-2 text-xs text-slate-600">
                        Visible actions: {fullReport.sourceSummary.totalActions ?? 0} · Action types: {fullReport.sourceSummary.actionTypes ?? 0} · Hidden platform actions: {fullReport.sourceSummary.hiddenPlatformActions ?? 0} · Recent samples: {fullReport.sourceSummary.recentSamples ?? 0}
                      </p>
                    )}
                    {fullReport.type === 'rulegap' ? (
                      <ul className="space-y-2">
                        {fullReport.issues.map((issue) => (
                          <li key={issue.id}>
                            <p className="font-medium text-slate-900">{issue.title}</p>
                            <p className="text-slate-600">Suggested wiki update: {issue.suggestedWikiUpdate}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="space-y-2">
                        <div>
                          <p className="font-medium text-slate-900">Metrics</p>
                          <p className="text-slate-700 text-xs">
                            Total: {fullReport.metrics?.totalActions ?? 0} · Pending: {fullReport.metrics?.pendingApproval ?? 0} · Approved: {fullReport.metrics?.approvedExecuted ?? 0} · Monitored: {fullReport.metrics?.executedMonitored ?? 0} · Rejected: {fullReport.metrics?.rejected ?? 0} · Failed: {fullReport.metrics?.failed ?? 0}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">Action breakdown</p>
                          <ul className="list-disc pl-5 text-slate-700">
                            {summarizeActionBreakdown(fullReport.actionCounts).map((row) => (
                              <li key={`${fullReport.id}-h-${row.label}`}>{row.label}: {row.count}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">Focus areas</p>
                          <ul className="list-disc pl-5 text-slate-700">
                            {fullReport.focusAreas.map((area, idx) => (
                              <li key={idx}>{area}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">Recommendation titles</p>
                          <ul className="list-disc pl-5 text-slate-700">
                            {fullReport.recommendations.map((rec) => (
                              <li key={rec.id}>{rec.title}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">Recent actions</p>
                          {fullReport.recentActions?.length ? (
                            <ul className="list-disc pl-5 text-slate-700">
                              {fullReport.recentActions.slice(0, 10).map((a) => (
                                <li key={`${fullReport.id}-ra-${a.id}`}>
                                  {toUtcDateKey(a.createdAt)} UTC · {a.friendlyAction} · {a.friendlyStatus} · {a.targetType}
                                  {a.reason ? ` · Reason: ${a.reason}` : ''}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-600">No recent actions available.</p>
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() =>
                        void (report.type === 'rulegap'
                          ? copyText(buildRuleGapReportText(fullReport as Extract<StoredReport, { type: 'rulegap' }>))
                          : copyText(buildModOnboardReportText(fullReport as Extract<StoredReport, { type: 'modonboard' }>)))
                          .then(() => setHistoryCopyStatus('Report copied.'))
                          .catch(() => setHistoryCopyStatus('Could not copy automatically. Please copy the report text manually.'))
                      }
                      className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700"
                    >
                      Copy Report
                    </button>
                        </>
                      );
                    })()
                    )}
                  </div>
                )}
              </article>
            ))}
            {history.length > historyVisibleCount && (
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700"
                onClick={() => setHistoryVisibleCount((count) => count + 20)}
              >
                Load more reports
              </button>
            )}
            {historyCopyStatus && <p className="text-xs text-slate-600">{historyCopyStatus}</p>}

            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-slate-500">
                No reports yet. Generate a ModOnboard report to start building history.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
