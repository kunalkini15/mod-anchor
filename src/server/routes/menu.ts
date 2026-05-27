import { Hono, type Context } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { createPost } from '../core/post';

export const menu = new Hono();
const workspacePostKey = (subreddit: string): string => `modanchor:workspacePostId:${subreddit.toLowerCase()}`;
const workspaceFallbackToast =
  'Could not find the ModAnchor workspace yet. Open the ModAnchor app once from Installed Apps, then try this shortcut again.';
const workspaceCreateFailedToast =
  'Could not create the ModAnchor workspace. Open ModAnchor from Installed Apps, then try again.';
const normalizeSubredditName = (value: string) => value.replace(/^r\//i, '').trim().toLowerCase();
const isWorkspacePostForSubreddit = (post: { subredditName?: string }, subreddit: string) => {
  if (!post.subredditName) return true;
  return normalizeSubredditName(post.subredditName) === normalizeSubredditName(subreddit);
};
const isCurrentUserModerator = async (): Promise<boolean> => {
  const subredditName = context.subredditName;
  const usernameRaw = await reddit.getCurrentUsername();
  if (!subredditName || !usernameRaw) return false;
  const username = usernameRaw.replace(/^\/?u\//i, '').trim();
  if (!username) return false;
  try {
    const user = await reddit.getUserByUsername(username);
    if (!user) return false;
    const permissions = await user.getModPermissionsForSubreddit(subredditName);
    return Array.isArray(permissions) && permissions.length > 0;
  } catch {
    return false;
  }
};
const postActionForm = (targetId?: string, includeRemovalReason = false) => ({
  title: 'ModAnchor Post Action',
  acceptLabel: 'Submit',
  cancelLabel: 'Cancel',
  fields: [
    {
      name: 'action',
      label: 'Action',
      type: 'select' as const,
      required: true,
      defaultValue: ['remove_post'],
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
    {
      name: 'reason',
      label: 'User note (optional, internal thought process)',
      type: 'paragraph' as const,
      required: false,
    },
    ...(includeRemovalReason
      ? [{
          name: 'removalNote',
          label: 'Moderator removal note (optional)',
          type: 'paragraph' as const,
          required: false,
        } as const]
      : []),
    {
      name: 'targetId',
      label: 'Target ID (auto-filled)',
      type: 'string' as const,
      required: false,
      defaultValue: targetId ?? '',
    },
  ],
});
const commentActionForm = (targetId?: string, includeRemovalReason = false) => ({
  title: 'ModAnchor Comment Action',
  acceptLabel: 'Submit',
  cancelLabel: 'Cancel',
  fields: [
    {
      name: 'action',
      label: 'Action',
      type: 'select' as const,
      required: true,
      defaultValue: ['remove_comment'],
      options: [
        { label: 'Approve comment', value: 'approve_comment' },
        { label: 'Remove comment', value: 'remove_comment' },
        { label: 'Remove comment as spam', value: 'remove_comment_spam' },
        { label: 'Lock comment', value: 'lock_comment' },
        { label: 'Unlock comment', value: 'unlock_comment' },
      ],
    },
    {
      name: 'reason',
      label: 'User note (optional, internal thought process)',
      type: 'paragraph' as const,
      required: false,
    },
    ...(includeRemovalReason
      ? [{
          name: 'removalNote',
          label: 'Moderator removal note (optional)',
          type: 'paragraph' as const,
          required: false,
        } as const]
      : []),
    {
      name: 'targetId',
      label: 'Target ID (auto-filled)',
      type: 'string' as const,
      required: false,
      defaultValue: targetId ?? '',
    },
  ],
});

const handleOpenWorkspace = async (c: Context) => {
  const subreddit = context.subredditName;
  if (!subreddit) {
    return c.json<UiResponse>(
      {
        showToast: workspaceFallbackToast,
      },
      200
    );
  }

  const key = workspacePostKey(subreddit);
  const getOrCreateWorkspacePost = async () => {
    const workspacePostId = await redis.get(key);
    if (typeof workspacePostId === 'string' && workspacePostId.trim()) {
      try {
        const workspacePost = await reddit.getPostById(workspacePostId as `t3_${string}`);
        if ((workspacePost?.url || workspacePost?.permalink) && isWorkspacePostForSubreddit(workspacePost, subreddit)) {
          return workspacePost;
        }
        await redis.del(key);
      } catch (error) {
        await redis.del(key);
        console.warn('[modanchor] failed to resolve workspace post for menu navigation', {
          subreddit,
          workspacePostId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const createdPost = await createPost();
      await redis.set(key, createdPost.id);
      return createdPost;
    } catch (error) {
      console.error('[modanchor] failed to create workspace post from menu action', {
        subreddit,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const workspacePost = await getOrCreateWorkspacePost();
  if (workspacePost?.url || workspacePost?.permalink) {
    return c.json<UiResponse>(
      {
        navigateTo: workspacePost,
      },
      200
    );
  }

  return c.json<UiResponse>(
    {
      showToast: workspaceCreateFailedToast,
    },
    200
  );
};

menu.post('/open-modanchor-workspace', handleOpenWorkspace);
// Backward-compatible route for existing installs still pointing at old endpoint.
menu.post('/open-modanchor', handleOpenWorkspace);

menu.post('/rulegap-report', async (c) => {
  return c.json<UiResponse>(
    {
      showToast: 'Open ModAnchor and use Wiki Anchor to generate a report.',
    },
    200
  );
});

menu.post('/modanchor-post-action', async (c) => {
  if (!(await isCurrentUserModerator())) {
    return c.json<UiResponse>(
      {
        showToast: 'ModAnchor actions are available to subreddit moderators only.',
      },
      403
    );
  }
  const req = await c.req.json<{ targetId?: string }>().catch(() => undefined);
  const targetId = req && typeof req.targetId === 'string' ? req.targetId : undefined;
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'modAnchorPostActionForm',
        form: postActionForm(targetId),
      },
    },
    200
  );
});

menu.post('/modanchor-comment-action', async (c) => {
  if (!(await isCurrentUserModerator())) {
    return c.json<UiResponse>(
      {
        showToast: 'ModAnchor actions are available to subreddit moderators only.',
      },
      403
    );
  }
  const req = await c.req.json<{ targetId?: string }>().catch(() => undefined);
  const targetId = req && typeof req.targetId === 'string' ? req.targetId : undefined;
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'modAnchorCommentActionForm',
        form: commentActionForm(targetId),
      },
    },
    200
  );
});
