import type {
  ContentAnchorPost,
  ContentAnchorSignal,
  ContentReviewResponse,
  RemovedContentPatternSummary,
} from '../../shared/api';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'in', 'is', 'it', 'of',
  'on', 'or', 'that', 'the', 'to', 'was', 'were', 'with', 'this', 'these', 'those', 'you', 'your',
  'our', 'but', 'not', 'have', 'had',
]);

export const MOCK_COMMUNITY_STANDARDS = `# Community Standards

Posts should be directly related to market-relevant community standards and include enough context for moderator review.

# Allowed Discussion

Allowed submissions include company analysis, earnings updates, sector trends, macro impact, portfolio strategy, technical and fundamental discussion, and educational context.

# Low-context and Repetitive Content

Very short submissions, repetitive link dumps, and unclear one-line prompts may need moderator review.

# Promotional and Off-topic Patterns

Referral-heavy, promotional, repetitive external channel promotion, and unrelated off-topic content may need extra review.`;

const MOCK_RECENT_POSTS: ContentAnchorPost[] = [
  { id: 'recent-1', title: 'Nifty falls as IT stocks weaken after guidance cut', body: 'Looking at valuation reset and portfolio risk across major names.', permalink: '/r/modanchor_dev/comments/recent1' },
  { id: 'recent-2', title: 'Quarterly results breakdown and margin pressure watchlist', body: 'Revenue trend and guidance discussion for large listed companies.', permalink: '/r/modanchor_dev/comments/recent2' },
  { id: 'recent-3', title: 'Should I buy this for long term?', body: 'Any views?', permalink: '/r/modanchor_dev/comments/recent3' },
  { id: 'recent-4', title: 'Best movie to watch this weekend?', body: 'Need recommendations.', permalink: '/r/modanchor_dev/comments/recent4' },
  { id: 'recent-5', title: 'Join my Telegram channel for sure-shot calls', body: 'Daily calls and referral links inside.', permalink: '/r/modanchor_dev/comments/recent5' },
];

const MOCK_REMOVED_POSTS: ContentAnchorPost[] = [
  { id: 'removed-1', title: 'Join my Telegram channel for intraday calls', body: 'Sure-shot calls and referral offers.' },
  { id: 'removed-2', title: 'Referral link to premium signal group', body: 'Join now and get guaranteed returns.' },
  { id: 'removed-3', title: 'Any views?', body: '' },
  { id: 'removed-4', title: 'Movie discussion thread', body: 'Weekend watchlist and actor rankings.' },
  { id: 'removed-5', title: 'Cricket match reactions', body: 'Score predictions and player banter.' },
];

const normalize = (text: string): string =>
  text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();

export const tokenizeText = (text: string): string[] =>
  normalize(text)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

export const extractNgrams = (tokens: string[], n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) out.push(tokens.slice(i, i + n).join(' '));
  return out;
};

const topCounts = (items: string[], limit: number): Array<{ term: string; count: number }> => {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term, count]) => ({ term, count }));
};

const extractDomains = (text: string): string[] => {
  const matches = text.match(/https?:\/\/([^\s/]+)/g) ?? [];
  return matches.map((m) => m.replace(/^https?:\/\//, '').toLowerCase());
};

export const summarizeRemovedContentPatterns = (removedPosts: ContentAnchorPost[]): RemovedContentPatternSummary => {
  const allTokens: string[] = [];
  const bigrams: string[] = [];
  const trigrams: string[] = [];
  const domains: string[] = [];
  let lowContext = 0;
  let linkHeavy = 0;

  for (const post of removedPosts) {
    const text = `${post.title} ${post.body ?? ''}`;
    const tokens = tokenizeText(text);
    allTokens.push(...tokens);
    bigrams.push(...extractNgrams(tokens, 2));
    trigrams.push(...extractNgrams(tokens, 3));
    const d = extractDomains(text);
    domains.push(...d);
    if (tokens.length < 6) lowContext += 1;
    if (d.length > 0 || /(telegram|referral|promo|join)/i.test(text)) linkHeavy += 1;
  }

  const total = Math.max(removedPosts.length, 1);
  return {
    commonTerms: topCounts(allTokens, 12),
    commonBigrams: topCounts(bigrams, 10),
    commonTrigrams: topCounts(trigrams, 8),
    commonDomains: topCounts(domains, 8),
    lowContextRatio: Number((lowContext / total).toFixed(2)),
    linkHeavyRatio: Number((linkHeavy / total).toFixed(2)),
  };
};

const buildTf = (tokens: string[]): Map<string, number> => {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
};

const cosine = (a: Map<string, number>, b: Map<string, number>): number => {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

export const buildRemovedContentIndex = (removedPosts: ContentAnchorPost[]) => {
  const docs = removedPosts.map((p) => tokenizeText(`${p.title} ${p.body ?? ''}`));
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [t, f] of df) idf.set(t, Math.log((N + 1) / (f + 1)) + 1);
  const toVec = (tokens: string[]) => {
    const tf = buildTf(tokens);
    const v = new Map<string, number>();
    for (const [t, c] of tf) v.set(t, c * (idf.get(t) ?? (Math.log((N + 1) / 1) + 1)));
    return v;
  };
  const vecs = docs.map((d) => toVec(d));
  return { idf, toVec, vecs, docs, removedPosts };
};

export const scorePostAgainstRemovedPatterns = (
  post: ContentAnchorPost,
  index: ReturnType<typeof buildRemovedContentIndex>
): { similarity: number; closestTerms: string[] } => {
  const tokens = tokenizeText(`${post.title} ${post.body ?? ''}`);
  const vec = index.toVec(tokens);
  let best = 0;
  let bestIdx = -1;
  index.vecs.forEach((rv, i) => {
    const s = cosine(vec, rv);
    if (s > best) {
      best = s;
      bestIdx = i;
    }
  });
  const closestTerms = bestIdx >= 0 ? (index.docs[bestIdx] ?? []).slice(0, 6) : [];
  return { similarity: Number(best.toFixed(2)), closestTerms };
};

const scoreAgainstStandards = (post: ContentAnchorPost, standardsText: string): number => {
  const pt = tokenizeText(`${post.title} ${post.body ?? ''}`);
  const st = tokenizeText(standardsText);
  const df = new Map<string, number>();
  for (const t of new Set([...pt, ...st])) df.set(t, ((pt.includes(t) ? 1 : 0) + (st.includes(t) ? 1 : 0)));
  const idf = new Map<string, number>();
  for (const [t, f] of df) idf.set(t, Math.log(3 / (f + 1)) + 1);
  const v = (tokens: string[]) => {
    const tf = buildTf(tokens);
    const out = new Map<string, number>();
    for (const [t, c] of tf) out.set(t, c * (idf.get(t) ?? 1));
    return out;
  };
  return Number(cosine(v(pt), v(st)).toFixed(2));
};

const labelFor = (signal: ContentAnchorSignal['signal']) => {
  if (signal === 'review') return 'needs moderator review';
  if (signal === 'removed_similarity') return 'similar to removed content';
  if (signal === 'aligned') return 'aligned';
  return 'low context';
};

export const generateContentReviewReport = (input: {
  standardsText?: string;
  reviewRecentPosts?: boolean;
  includeRemovedPosts?: boolean;
  useMockData?: boolean;
  sampleSize?: number;
}): ContentReviewResponse => {
  const useMockData = input.useMockData !== false;
  const reviewRecentPosts = input.reviewRecentPosts !== false;
  const includeRemoved = input.includeRemovedPosts === true;
  const sampleSize = Math.min(Math.max(input.sampleSize ?? 10, 1), 50);

  const standardsText = input.standardsText?.trim() || (useMockData ? MOCK_COMMUNITY_STANDARDS : '');
  const recentPosts = reviewRecentPosts ? (useMockData ? MOCK_RECENT_POSTS.slice(0, sampleSize) : []) : [];
  const removedPosts = includeRemoved ? (useMockData ? MOCK_REMOVED_POSTS.slice(0, sampleSize) : []) : [];

  const removedSummary = summarizeRemovedContentPatterns(removedPosts);
  const removedIndex = removedPosts.length > 0 ? buildRemovedContentIndex(removedPosts) : null;

  const signals: ContentAnchorSignal[] = recentPosts.map((post) => {
    const standardsSimilarity = standardsText ? scoreAgainstStandards(post, standardsText) : 0;
    const removed = removedIndex ? scorePostAgainstRemovedPatterns(post, removedIndex) : { similarity: 0, closestTerms: [] };
    const tokenCount = tokenizeText(`${post.title} ${post.body ?? ''}`).length;
    const lowContext = tokenCount < 6;

    let signal: ContentAnchorSignal['signal'] = 'aligned';
    let advisory = 'mod-only advisory signal';
    if (removed.similarity >= 0.18) {
      signal = 'removed_similarity';
      advisory = 'similar to removed content; this is not a moderation decision';
    } else if (lowContext) {
      signal = 'low_context';
      advisory = 'low context; needs moderator review';
    } else if (standardsSimilarity < 0.08) {
      signal = 'review';
      advisory = 'needs moderator review due to weak standards alignment';
    }

    return {
      postId: post.id,
      title: post.title,
      permalink: post.permalink,
      signal,
      label: labelFor(signal),
      standardsSimilarity,
      removedSimilarity: removed.similarity,
      closestRemovedTerms: removed.closestTerms,
      advisory,
      lowContext,
    };
  });

  return {
    source: { useMockData, scannedPosts: recentPosts.length, removedPostsAnalyzed: removedPosts.length },
    standardsText,
    removedPatterns: removedSummary,
    summary: {
      aligned: signals.filter((s) => s.signal === 'aligned').length,
      needsReview: signals.filter((s) => s.signal === 'review').length,
      similarToRemoved: signals.filter((s) => s.signal === 'removed_similarity').length,
      lowContext: signals.filter((s) => s.lowContext).length,
    },
    posts: signals,
    notes: [
      'Content Anchor outputs mod-only advisory signals.',
      'This is not a moderation decision.',
      'No Reddit state was changed by this review.',
    ],
  };
};
