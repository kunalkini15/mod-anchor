import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { getModAnchorActionReviews, getMonitoringDigests, saveMonitoringDigests } from '../core/reports';
import { generateMonitoringDigestsForDate, getPreviousUtcDateKey } from '../core/monitoringDigests';

export const scheduler = new Hono();

const getSubreddit = () => context.subredditName ?? 'modanchor_dev';

scheduler.post('/modanchor-daily-digest', async (c) => {
  const nowUtc = new Date();
  const digestDateUtc = getPreviousUtcDateKey(nowUtc);
  const subreddit = getSubreddit();
  try {
    const reviews = await getModAnchorActionReviews(redis, subreddit);
    const existing = await getMonitoringDigests(redis, subreddit);
    const result = await generateMonitoringDigestsForDate({
      subreddit,
      digestDateUtc,
      sendModmail: true,
      reviews,
      existingDigests: existing,
    });
    await saveMonitoringDigests(redis, subreddit, result.digests);
    console.log('[modanchor scheduler] daily digest run complete', {
      subreddit,
      nowUtc: nowUtc.toISOString(),
      digestDateUtc,
      generated: result.generated,
      sent: result.sent,
      failed: result.failed,
    });
    return c.json({ status: 'ok', digestDateUtc, generated: result.generated, sent: result.sent, failed: result.failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run scheduled daily digest';
    console.error('[modanchor scheduler] daily digest run failed', {
      subreddit,
      nowUtc: nowUtc.toISOString(),
      digestDateUtc,
      error: message,
    });
    return c.json({ status: 'error', error: message, digestDateUtc }, 500);
  }
});
