import { reddit } from '@devvit/web/server';
import type {
  SeedScenario,
  SeedTestActivityResponse,
  SeededItem,
} from '../../shared/api';

type SeedOptions = {
  subreddit: string;
  scenario: SeedScenario;
  count: number;
};

type ScenarioTemplate = {
  title: string;
  body: string;
  action: 'remove' | 'approve' | 'none';
};

const scenarioTemplates: Record<SeedScenario, ScenarioTemplate[]> = {
  removal_messaging_gap: [
    {
      title: '[ModAnchor Seed] Low-context post for removal reason test',
      body: 'Seed content to test removal explanation patterns.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Rule boundary test without explanation',
      body: 'Seed content to test removal explanation patterns.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Repeated unclear submission',
      body: 'Seed content to test removal explanation patterns.',
      action: 'remove',
    },
  ],
  self_promotion_links: [
    {
      title: '[ModAnchor Seed] Referral link promotion test',
      body: 'Seed post mentioning referral, affiliate, promo, and link usage for RuleGap testing.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Affiliate guide with promo code',
      body: 'Seed post mentioning affiliate and promotion context for moderation testing.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Educational link with unclear context',
      body: 'Seed post with link context ambiguity for moderation decisions.',
      action: 'approve',
    },
  ],
  off_topic_scope: [
    {
      title: '[ModAnchor Seed] Borderline off-topic discussion',
      body: 'Seed post with off-topic and scope keywords for moderation preview testing.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] General topic outside subreddit scope',
      body: 'Seed post with unrelated general scope language.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Not relevant to this community',
      body: 'Seed post intentionally near scope boundaries.',
      action: 'approve',
    },
  ],
  approval_removal_mix: [
    {
      title: '[ModAnchor Seed] Queue review sample for approval',
      body: 'Seed content for approval/removal mix testing.',
      action: 'approve',
    },
    {
      title: '[ModAnchor Seed] Queue review sample for removal',
      body: 'Seed content for approval/removal mix testing.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Queue review sample for second approval',
      body: 'Seed content for approval/removal mix testing.',
      action: 'approve',
    },
  ],
  mixed_rulegap_demo: [
    {
      title: '[ModAnchor Seed] Link promo edge-case sample',
      body: 'Seed content mentioning affiliate link and promotion.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Off-topic scope boundary sample',
      body: 'Seed content mentioning unrelated general discussion and scope.',
      action: 'remove',
    },
    {
      title: '[ModAnchor Seed] Low-context moderation note sample',
      body: 'Seed content with minimal context for removal messaging patterns.',
      action: 'approve',
    },
  ],
};

const pickTemplate = (scenario: SeedScenario, index: number): ScenarioTemplate => {
  const list = scenarioTemplates[scenario];
  const template = list[index % list.length];
  return (
    template ?? {
      title: '[ModAnchor Seed] Fallback seed item',
      body: 'Seed content for RuleGap testing.',
      action: 'none',
    }
  );
};

const extractPostMeta = (created: unknown): { id?: string; permalink?: string } => {
  const rec = created as Record<string, unknown>;
  const rawName = rec.name;
  const rawId = rec.id;
  const name = typeof rawName === 'string' ? rawName : undefined;
  const id = typeof rawId === 'string' ? rawId : undefined;
  const preferredId = name?.startsWith('t3_') ? name : id;
  return {
    id: preferredId,
    permalink: (rec.permalink as string | undefined) ?? (rec.url as string | undefined),
  };
};

const createSeedPost = async (
  subreddit: string,
  title: string,
  body: string
): Promise<{ id?: string; permalink?: string }> => {
  const client = reddit as unknown as Record<string, unknown>;

  if (typeof client.submitPost === 'function') {
    const created = await (client.submitPost as (arg: Record<string, unknown>) => Promise<unknown>)({
      subredditName: subreddit,
      title,
      text: body,
      kind: 'self',
    });
    return extractPostMeta(created);
  }

  if (typeof client.submitSelfPost === 'function') {
    const created = await (client.submitSelfPost as (arg: Record<string, unknown>) => Promise<unknown>)({
      subredditName: subreddit,
      title,
      text: body,
    });
    return extractPostMeta(created);
  }

  throw new Error('Post creation method is not available from current Devvit API.');
};

const applyModerationAction = async (
  postId: string | undefined,
  action: ScenarioTemplate['action']
): Promise<{ status: SeededItem['status']; message?: string; action?: string }> => {
  if (action === 'none') {
    return { status: 'created' };
  }
  if (!postId || typeof postId !== 'string') {
    return {
      status: 'skipped',
      action,
      message: 'Moderation action skipped because the created post id was unavailable.',
    };
  }

  const client = reddit as unknown as Record<string, unknown>;
  if (action === 'remove') {
    if (typeof client.remove === 'function') {
      try {
        await (client.remove as (id: string, isSpam: boolean) => Promise<unknown>)(postId, false);
        return { status: 'moderated', action: 'remove' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown moderation error';
        console.warn('[modanchor] seed moderation failed', { action, postId, message });
        return { status: 'failed', action: 'remove', message: `Moderation action failed: ${message}` };
      }
    }
    return {
      status: 'skipped',
      action: 'remove',
      message:
        'Moderation action not available from current Devvit API; created seed content for manual action.',
    };
  }

  if (action === 'approve') {
    if (typeof client.approve === 'function') {
      try {
        await (client.approve as (id: string) => Promise<unknown>)(postId);
        return { status: 'moderated', action: 'approve' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown moderation error';
        console.warn('[modanchor] seed moderation failed', { action, postId, message });
        return { status: 'failed', action: 'approve', message: `Moderation action failed: ${message}` };
      }
    }
    return {
      status: 'skipped',
      action: 'approve',
      message:
        'Moderation action not available from current Devvit API; created seed content for manual action.',
    };
  }

  return { status: 'created' };
};

export const seedTestActivity = async (
  _context: unknown,
  options: SeedOptions
): Promise<SeedTestActivityResponse> => {
  const { subreddit, scenario, count } = options;
  const items: SeededItem[] = [];

  for (let idx = 0; idx < count; idx += 1) {
    const template = pickTemplate(scenario, idx);
    const title = `${template.title} #${idx + 1}`;

    try {
      const created = await createSeedPost(subreddit, title, template.body);
      const moderation = await applyModerationAction(created.id, template.action);
      items.push({
        title,
        permalink: created.permalink,
        action: moderation.action,
        status: moderation.status,
        message: moderation.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create seed item.';
      items.push({
        title,
        status: 'failed',
        message,
      });
    }
  }

  const created = items.filter((i) => i.status === 'created').length;
  const moderated = items.filter((i) => i.status === 'moderated').length;
  const skipped = items.filter((i) => i.status === 'skipped').length;
  const failed = items.filter((i) => i.status === 'failed').length;

  return {
    scenario,
    subreddit,
    created,
    moderated,
    skipped,
    failed,
    items,
    message:
      skipped > 0
        ? 'Seed activity created. Some moderation actions were skipped because the current Devvit API does not expose those methods here.'
        : 'Seed activity created successfully.',
  };
};
