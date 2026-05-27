import { reddit } from '@devvit/web/server';

type WorkspacePostLike = {
  id?: string;
  remove: (isSpam?: boolean) => Promise<void>;
  lock: () => Promise<void>;
};

export const protectWorkspacePost = async (post: WorkspacePostLike): Promise<void> => {
  try {
    await post.remove(false);
  } catch (error) {
    console.warn('[modanchor] could not remove workspace post from feed', {
      postId: post.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    await post.lock();
  } catch (error) {
    console.warn('[modanchor] could not lock workspace post', {
      postId: post.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const createPost = async () => {
  const post = await reddit.submitCustomPost({
    title: 'ModAnchor',
  });
  await protectWorkspacePost(post);
  return post;
};
