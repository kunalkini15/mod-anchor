import type {
  ContentAlignmentPreviewResponse,
  PostAlignmentResult,
  PostAlignmentSignal,
  WikiAnchorSection,
  WikiAnchorSource,
} from '../../shared/api';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'in', 'is', 'it', 'of',
  'on', 'or', 'that', 'the', 'to', 'was', 'were', 'with', 'this', 'these', 'those', 'you', 'your',
  'our', 'but', 'not', 'have', 'had',
]);

const ALLOWED_HEADING_TERMS = [
  'community scope', 'allowed', 'market discussion', 'company results', 'stock analysis',
  'trading', 'investing', 'questions', 'educational',
];

const RESTRICTED_HEADING_TERMS = [
  'off-topic', 'promotional', 'promotion', 'spam', 'low effort', 'referral', 'telegram',
  'disallowed', 'not allowed',
];

const ALLOWED_PHRASES = [
  'indian stock market', 'stock market', 'listed companies', 'quarterly results', 'q4 results',
  'technical analysis', 'fundamental analysis', 'long term investing', 'swing trading', 'nifty',
  'sensex', 'hdfc bank', 'infosys', 'tcs', 'reliance', 'sebi', 'rbi', 'ipo', 'psu banks',
  'banking stocks', 'it stocks',
];

const RESTRICTED_PHRASES = [
  'telegram channel', 'sure-shot calls', 'referral link', 'join my channel', 'movie', 'cricket',
  'ipl', 'gaming',
];

export const WIKI_ANCHOR_MOCK_WIKI_TEXT = `# ModAnchor Indian Markets Wiki

## Community Scope
This community is for Indian stock market discussion, including Nifty, Sensex, NSE, BSE, listed companies, market news, and policy updates from RBI and SEBI.

## Allowed Market Discussion
Allowed topics include trading and investing decisions, portfolio construction, market news, valuation frameworks, technical analysis, fundamental analysis, and sector trends in banking stocks and IT stocks.

## Company Results and Stock Analysis
Posts on quarterly results should include earnings context such as revenue, margins, guidance, valuation, and impact on companies like HDFC Bank, Infosys, TCS, and Reliance.

## Trading and Investing Questions
Questions about entries, exits, risk management, IPO analysis, sector allocation, and long-term investing are welcome when sufficient context is provided.

## Off-topic Content
Off-topic content such as sports, movies, and unrelated general chat is outside community scope even when market terms are briefly mentioned.

## Promotional Content
Promotional content, referral links, affiliate promotions, and external telegram channel ads are restricted and require moderator review.
`;

type MockPost = {
  postId: string;
  title: string;
  body: string;
  permalink?: string;
};

const MOCK_POSTS: MockPost[] = [
  { postId: 'mock-1', title: 'Nifty falls as IT stocks weaken after Infosys guidance cut', body: 'Market news discussion on NSE and BSE reaction, valuation reset, and portfolio risk management for trading and investing.', permalink: '/r/modanchor_dev/comments/mock1' },
  { postId: 'mock-2', title: 'HDFC Bank Q4 results: loan growth, NIM pressure and valuation', body: 'Quarterly results analysis with revenue trend, margins, guidance, and long-term investing view on banking stocks.', permalink: '/r/modanchor_dev/comments/mock2' },
  { postId: 'mock-3', title: 'SEBI update on SME IPO rules and impact on listed exchanges', body: 'Regulatory update covering SEBI policy changes, IPO process, and expected impact on Indian stock market sentiment.', permalink: '/r/modanchor_dev/comments/mock3' },
  { postId: 'mock-4', title: 'Should I buy this stock for long term?', body: 'Looking for guidance on investing horizon, valuation comfort, and portfolio allocation for a listed company.', permalink: '/r/modanchor_dev/comments/mock4' },
  { postId: 'mock-5', title: 'Budget expectations and impact on PSU banks', body: 'How fiscal policy and RBI stance could influence banking stocks, market volatility, and medium-term trading decisions.', permalink: '/r/modanchor_dev/comments/mock5' },
  { postId: 'mock-6', title: 'RCB finally won, what a match!', body: 'Post-match reactions and player performance thread.', permalink: '/r/modanchor_dev/comments/mock6' },
  { postId: 'mock-7', title: 'Best movie to watch this weekend?', body: 'Need a thriller recommendation list.', permalink: '/r/modanchor_dev/comments/mock7' },
  { postId: 'mock-8', title: 'Join my Telegram channel for sure-shot calls', body: 'Daily calls with guaranteed returns, click link to join now.', permalink: '/r/modanchor_dev/comments/mock8' },
];

const normalizeText = (text: string): string =>
  text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const tokenize = (text: string): string[] => {
  const words = normalizeText(text).split(' ').map((t) => t.trim()).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) bigrams.push(`${words[i]}_${words[i + 1]}`);
  return [...words, ...bigrams];
};

const headingCategory = (title: string): 'allowed' | 'restricted' | 'neutral' => {
  const t = title.toLowerCase();
  if (RESTRICTED_HEADING_TERMS.some((k) => t.includes(k))) return 'restricted';
  if (ALLOWED_HEADING_TERMS.some((k) => t.includes(k))) return 'allowed';
  return 'neutral';
};

const parseWikiSections = (wikiText: string): WikiAnchorSection[] => {
  const lines = wikiText.split(/\r?\n/);
  const sections: WikiAnchorSection[] = [];
  let currentTitle = '';
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join(' ').trim();
    if (text.length === 0 && currentTitle.length === 0) return;
    const title = currentTitle || 'Wiki / Rules';
    sections.push({ id: `section-${sections.length + 1}`, title, text, category: headingCategory(title) });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (currentTitle || currentLines.length > 0) flush();
      currentTitle = (heading[1] ?? '').trim();
    } else currentLines.push(line);
  }
  flush();
  if (sections.length === 0) return [{ id: 'section-1', title: 'Wiki / Rules', text: wikiText, category: 'neutral' }];
  return sections;
};

const buildTf = (tokens: string[]): Map<string, number> => {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
};

const cosineSimilarity = (a: Map<string, number>, b: Map<string, number>): number => {
  let dot = 0, normA = 0, normB = 0;
  for (const [, v] of a) normA += v * v;
  for (const [, v] of b) normB += v * v;
  for (const [k, va] of a) dot += va * (b.get(k) ?? 0);
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const phraseBoost = (haystack: string, phrases: string[], multiplier: number): number => {
  const hits = phrases.filter((p) => haystack.includes(p)).length;
  return hits * multiplier;
};

const isLowContext = (title: string, body: string, tokens: string[]): boolean => {
  const combined = normalizeText(`${title} ${body}`);
  const generic = ['should i buy', 'buy or sell', 'thoughts', 'any views', 'long term', 'target', 'help'];
  if (tokens.length < 6) return true;
  if (generic.some((g) => combined.includes(g)) && normalizeText(body).length < 20) return true;
  return false;
};

const round = (n: number): number => Math.round(n * 100) / 100;

const classify = (allowed: number, restricted: number, lowContext: boolean): { signal: PostAlignmentSignal; label: string; advisory: string } => {
  if (restricted >= 0.12 && restricted >= allowed) {
    return {
      signal: 'review',
      label: 'Review signal',
      advisory: 'This post has textual similarity to restricted/off-topic/promotional wiki sections. Review manually before taking action.',
    };
  }

  if (allowed >= 0.16) {
    if (lowContext) {
      return {
        signal: 'medium',
        label: 'Medium alignment',
        advisory: 'This post may need more context for reliable alignment scoring. This is not a moderation decision.',
      };
    }
    return {
      signal: 'high',
      label: 'High alignment',
      advisory: "This post has strong textual similarity to allowed community scope or wiki/rules sections. This is not a moderation decision.",
    };
  }

  if (allowed >= 0.07) {
    return {
      signal: 'medium',
      label: 'Medium alignment',
      advisory: 'This post has partial textual similarity to allowed wiki/rules sections. Review manually if context is unclear.',
    };
  }

  return {
    signal: 'low',
    label: 'Low similarity signal',
    advisory: 'This post has low textual similarity to the configured wiki/rules. Review manually before taking any action.',
  };
};

export function generateContentAlignmentPreview(input: { wikiText?: string; useMockWiki?: boolean; useMockPosts?: boolean; sampleSize?: number; }): ContentAlignmentPreviewResponse {
  const hasWikiText = typeof input.wikiText === 'string' && input.wikiText.trim().length > 0;
  const useMockWiki = input.useMockWiki === true;
  const useMockPosts = input.useMockPosts !== false;
  const sampleSize = Math.min(Math.max(input.sampleSize ?? 10, 1), 25);

  if (!hasWikiText && !useMockWiki) throw new Error('wikiText is required unless useMockWiki is true.');

  const wikiSource: WikiAnchorSource = hasWikiText ? 'manual' : 'mock';
  const wikiText = hasWikiText ? (input.wikiText as string) : WIKI_ANCHOR_MOCK_WIKI_TEXT;

  const sections = parseWikiSections(wikiText);
  const sectionTokens = sections.map((s) => tokenize(`${s.title} ${s.text}`));
  const df = new Map<string, number>();
  for (const doc of sectionTokens) {
    const uniq = new Set(doc);
    for (const term of uniq) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const docCount = sectionTokens.length;
  const idf = new Map<string, number>();
  for (const [term, freq] of df) idf.set(term, Math.log((docCount + 1) / (freq + 1)) + 1);

  const tfidf = (tokens: string[]): Map<string, number> => {
    const tf = buildTf(tokens);
    const vec = new Map<string, number>();
    for (const [term, count] of tf) vec.set(term, count * (idf.get(term) ?? (Math.log((docCount + 1) / 1) + 1)));
    return vec;
  };

  const sectionVecs = sectionTokens.map((tokens) => tfidf(tokens));

  const notes: string[] = [
    'Content Alignment Signals are advisory only and not moderation decisions.',
    'No Reddit moderation state was changed by this preview.',
  ];

  const posts = useMockPosts ? MOCK_POSTS.slice(0, sampleSize) : [];
  const postSource: 'mock' | 'recent_posts' = useMockPosts ? 'mock' : 'recent_posts';
  if (!useMockPosts) notes.push('Recent-post fetching is not enabled in this build. Enable "Use mock posts" to run the preview.');

  const results: PostAlignmentResult[] = posts.map((post) => {
    const titleTokens = tokenize(post.title);
    const bodyTokens = tokenize(post.body);
    const postTokens = [...titleTokens, ...titleTokens, ...bodyTokens];
    const postVec = tfidf(postTokens);
    const rawText = normalizeText(`${post.title} ${post.body}`);

    const matches = sections
      .map((section, idx) => {
        let score = cosineSimilarity(postVec, sectionVecs[idx] ?? new Map<string, number>());
        if (section.category === 'allowed') score += phraseBoost(rawText, ALLOWED_PHRASES, 0.012);
        if (section.category === 'restricted') score += phraseBoost(rawText, RESTRICTED_PHRASES, 0.02);
        return {
          sectionId: section.id,
          sectionTitle: section.title,
          category: section.category ?? 'neutral',
          score: round(score),
          raw: score,
        };
      })
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 3);

    const allowedSimilarity = Math.max(0, ...matches.filter((m) => m.category === 'allowed').map((m) => m.raw), ...sections.map((section, i) => {
      const c = section.category ?? 'neutral';
      if (c !== 'allowed') return 0;
      let s = cosineSimilarity(postVec, sectionVecs[i] ?? new Map<string, number>());
      s += phraseBoost(rawText, ALLOWED_PHRASES, 0.012);
      return s;
    }));
    const restrictedSimilarity = Math.max(0, ...sections.map((section, i) => {
      const c = section.category ?? 'neutral';
      if (c !== 'restricted') return 0;
      let s = cosineSimilarity(postVec, sectionVecs[i] ?? new Map<string, number>());
      s += phraseBoost(rawText, RESTRICTED_PHRASES, 0.02);
      return s;
    }));
    const neutralSimilarity = Math.max(0, ...sections.map((section, i) => ((section.category ?? 'neutral') === 'neutral' ? cosineSimilarity(postVec, sectionVecs[i] ?? new Map<string, number>()) : 0)));

    const lowContext = isLowContext(post.title, post.body, postTokens);
    const out = classify(allowedSimilarity, restrictedSimilarity, lowContext);

    return {
      postId: post.postId,
      title: post.title,
      bodyPreview: post.body.slice(0, 220),
      permalink: post.permalink,
      score: round(Math.max(allowedSimilarity, restrictedSimilarity, neutralSimilarity)),
      signal: out.signal,
      label: out.label,
      allowedSimilarity: round(allowedSimilarity),
      restrictedSimilarity: round(restrictedSimilarity),
      neutralSimilarity: round(neutralSimilarity),
      closestSections: matches.map((m) => ({ sectionId: m.sectionId, sectionTitle: m.sectionTitle, category: m.category, score: m.score })),
      lowContext,
      advisory: out.advisory,
    };
  });

  const high = results.filter((r) => r.signal === 'high').length;
  const medium = results.filter((r) => r.signal === 'medium').length;
  const low = results.filter((r) => r.signal === 'low').length;
  const review = results.filter((r) => r.signal === 'review').length;
  const avg = results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;

  return {
    source: { wikiSource, postSource, scannedPostCount: results.length },
    index: { source: wikiSource, indexedAt: new Date().toISOString(), sectionCount: sections.length, vocabularySize: df.size },
    summary: { high, medium, low, review, averageScore: round(avg) },
    sections: sections.map((s) => ({ id: s.id, title: s.title })),
    results,
    notes,
  };
}
