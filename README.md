# ModAnchor

ModAnchor is a private Reddit moderation workspace for safely onboarding new moderators.

It helps senior moderators place junior moderators into **Review Mode**, where supported moderation actions are either queued for approval or monitored after execution. The goal is simple: let new moderators learn through real workflows without giving them full trust on day one.

---

## What it does

ModAnchor gives moderation teams a structured onboarding flow:

- Start a review for a new moderator
- Route actions through approval or monitoring
- Let senior mods approve, reject, or review actions
- Track user, post, and comment moderation actions
- Send per-action updates or daily digest summaries
- Generate review reports
- Keep onboarding activity private from the public subreddit feed

ModAnchor does not replace Reddit’s native moderation tools. It adds a review and coaching layer on top.

---

## How to access ModAnchor

After installing the app:

1. Open your subreddit.
2. Open the subreddit menu or Mod Tools area.
3. Select **Open ModAnchor Workspace**.
4. Use the private ModAnchor workspace.

ModAnchor uses a Devvit custom post as its workspace. The workspace post is automatically locked and removed from the public feed, so regular community members should not see it in the subreddit feed.

---

## Main menu options

### ModOnboard

The main senior moderator dashboard.

Use it to:

- Start Review Mode
- View onboarding status
- Move moderators between review phases
- Complete reviews
- Generate reports
- Track approval and monitoring activity

### Start Review

Start Review Mode for a moderator.

You can configure:

- Approval phase duration
- Monitoring phase duration
- Monitoring report style
- Auto-graduation after review period

Monitoring report styles:

- **Daily digest**: groups monitored actions into one daily summary
- **Per action**: sends a modmail update for each monitored action

Daily digest is the recommended default for busy communities.

### Approvals

Shows actions submitted by moderators during the approval phase.

Senior moderators can:

- Review the action
- Check the target and reason
- Approve and run the action
- Reject the action

### Monitoring

Shows actions that were executed through ModAnchor during the monitoring phase.

This helps senior moderators review decisions after they happen.

### Action Console

The main workspace for submitting moderation actions through ModAnchor.

Supported areas:

**User actions**

- Ban user
- Unban user
- Add mod note
- Mute / unmute user, if supported by the current build

**Post actions**

- Approve post
- Remove post
- Remove as spam
- Lock / unlock post

**Comment actions**

- Approve comment
- Remove comment
- Remove as spam
- Lock / unlock comment

Moderators can select recent posts/comments or paste a Reddit ID/URL manually.

### Moderators

Shows moderators currently in review and their progress.

Senior moderators can:

- Move a review to the next phase
- Complete a review
- Edit review setup
- Generate a report

### Report History

Stores generated ModAnchor reports.

Reports can be:

- Viewed
- Expanded
- Copied
- Deleted individually
- Deleted all at once

Reports summarize review activity, action counts, recent decisions, and coaching notes.

### Guide

A short in-app guide for senior and junior moderators.

---

## Review Mode

Review Mode has two phases.

### 1. Approval phase

Junior moderator actions do not run immediately.

They are queued for senior review. A senior moderator can approve and execute the action, or reject it.

### 2. Monitoring phase

Junior moderator actions run through ModAnchor immediately, but they are still recorded for review.

Senior moderators can review activity through the Monitoring tab, per-action notifications, daily digests, and reports.

---

## Senior and junior access

Senior moderators can access the full ModAnchor workspace.

Junior moderators in active review get a restricted view focused on:

- Action Console
- Guide

Once a review is completed, access follows the configured graduation/review logic.

Non-moderators should not be able to use the workspace.

---

## Permissions

ModAnchor works with Reddit’s existing moderator permissions.

A junior moderator does not need full native moderation access to use Action Console. This makes ModAnchor useful for safer onboarding.

There are two common setups:

### Minimal-permission onboarding

Best for cautious onboarding.

- Junior moderators use Action Console
- Senior moderators approve or monitor actions
- Native post/comment menus may not be available to the junior moderator

### Menu-action onboarding

Best for a more contextual workflow.

- Junior moderator has Posts & Comments permission
- ModAnchor actions can appear closer to Reddit post/comment workflows
- Native Reddit actions may still be available

---

## Important limitations

ModAnchor does not block native Reddit moderation actions.

If a moderator has native Reddit permissions, they may still act directly through Reddit. ModAnchor can track and report native activity where available, but it cannot fully prevent native actions.

ModAnchor also does not:

- Replace the mod queue
- Replace senior moderator judgment
- Automatically decide if someone is ready
- Publicly expose onboarding data
- Use LLMs in the current MVP

---

## High-volume support

ModAnchor includes safeguards for busier communities:

- Bounded review queues
- Indexed action-review storage
- Paginated action review APIs
- Daily digest mode
- Digest size limits
- Duplicate-safe digest generation
- Report history loading designed to avoid unnecessary heavy detail loading

Daily digest is recommended for high-volume subreddits.

---

## Local checks

Before release, run:

```bash
npm run type-check
npm run lint
npm run build
````

For playtesting:

```bash
npx devvit playtest <subreddit_name>
```

---

## Summary

ModAnchor helps moderation teams onboard new moderators with more structure, visibility, and safety.

It gives junior moderators real workflows, while senior moderators keep control through approvals, monitoring, daily digests, and review reports.
