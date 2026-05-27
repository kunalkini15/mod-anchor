# ModAnchor

**ModAnchor** is a private moderator onboarding workspace for Reddit communities.

It helps senior moderators train new moderators safely by routing supported moderation actions through **Review Mode**. Junior moderators can practice real moderation workflows, while senior moderators approve sensitive actions, monitor progress, and review coaching reports before granting broader trust.

ModAnchor is built for moderation teams that want a middle ground between giving a new moderator no real responsibility and giving them full native moderation access on day one.

---

## The problem

Moderator onboarding is often informal. A new moderator may be added with limited permissions, given a few notes about community standards, and then expected to learn from scattered modmail, mod log entries, and occasional senior feedback.

That creates risk for both the community and the mod team:

- New moderators need real practice, but senior moderators need oversight.
- Native Reddit actions can happen without context or coaching notes.
- Senior moderators may not know why a junior moderator made a decision.
- Community-specific standards are learned slowly and inconsistently.
- Review, feedback, and graduation decisions are rarely captured in one place.

ModAnchor turns onboarding into a structured workflow with approval, monitoring, and reporting built in.

---

## How ModAnchor works

A senior moderator places a junior moderator into **Review Mode**. From there, the junior moderator submits supported moderation actions through ModAnchor instead of acting directly through Reddit’s native controls.

Review Mode has two main phases:

### Approval phase

Actions are queued for senior review before they run.

Senior moderators can inspect the action, target, reason, and supporting details, then approve and run it or reject it. This phase is designed for new moderators who are still learning community standards.

### Monitoring phase

Actions can run immediately through ModAnchor, but they are still recorded and surfaced for senior review.

Senior moderators can receive monitoring updates per action or through a daily digest. This phase is designed for moderators who are ready for more autonomy but still need review and coaching.

### Completion

When the review is complete, ModAnchor automatically generates a final review report and saves it in Report History.

---

## Core capabilities

### ModOnboard

ModOnboard is the main onboarding console for senior moderators.

It allows senior moderators to:

- Start Review Mode for a moderator.
- Configure approval and monitoring durations in days, hours, and minutes.
- Choose between per-action monitoring and daily digest monitoring.
- Move a moderator from approval to monitoring.
- Edit an active review setup without restarting the review.
- Complete a review and automatically save a final report.
- Review pending approvals and monitored actions.
- View moderators currently in review.

Junior moderators see a restricted view focused on Action Console and the Guide.

### Action Console

Action Console gives junior moderators one place to submit supported moderation actions through ModAnchor.

Supported action areas include:

- User actions, such as banning, unbanning, and adding mod notes.
- Post actions, such as approving, removing, spam-removing, locking, and unlocking posts.
- Comment actions, such as approving, removing, spam-removing, locking, and unlocking comments.

For post and comment workflows, ModAnchor can load recent posts and comments so moderators can select targets instead of manually copying IDs. Manual ID or URL entry remains available as a fallback.

Action Console is especially useful for minimal-permission onboarding because a junior moderator can use ModAnchor even when Reddit’s native post or comment moderation menus are not available to them.

### Approval Queue

During the Approval phase, submitted actions wait for senior review.

Senior moderators can see:

- The moderator who submitted the action.
- The requested action.
- The target user, post, or comment.
- The internal reason.
- Removal notes or mod notes where applicable.
- Target metadata when available.

The senior moderator can then approve and run the action, or reject it.

### Monitoring

During the Monitoring phase, actions run through ModAnchor and are recorded for review.

ModAnchor tracks:

- Actor
- Action type
- Target type
- Target metadata
- Reason
- Execution status
- Monitoring notification status
- Modmail delivery status where applicable

Monitoring can be configured in two ways:

- **Per action**: a modmail notification can be sent for each monitored action.
- **Daily digest**: monitored actions are grouped into a daily modmail digest.

Daily digests are scheduled at **00:00 UTC** and process the previous UTC day. Manual digest generation is also available for retries or operational review.

### Report History

Report History stores ModAnchor review reports.

Reports can be generated manually or automatically when a review is completed. Reports include action summaries, review periods, status counts, target breakdowns, recent actions, reasons, monitoring delivery information, and coaching recommendations.

Senior moderators can view, copy, delete individual reports, or delete all report history. This is separate from clearing all ModAnchor data.

### Guide

The Guide explains how ModAnchor should be used by both senior and junior moderators.

Senior moderators get setup guidance for Review Mode, permissions, approval workflows, monitoring, and reports. Junior moderators get guidance on how to submit actions, write reasons, and understand what senior moderators will review.

---

## Permission model

ModAnchor works with Reddit’s existing moderator permission model.

A junior moderator does not need full native moderation access to participate in onboarding. With minimal permissions, they can still use Action Console and route actions through Review Mode.

There are two common onboarding styles:

### Minimal-permission onboarding

Use this when the team wants the safest onboarding path.

- Junior moderator has limited permissions.
- Junior moderator uses Action Console.
- Senior moderators approve or monitor actions through ModAnchor.
- Native post/comment menu actions may not be visible to the junior moderator.

### Menu-action onboarding

Use this when the team wants a more contextual workflow.

- Junior moderator has Posts & Comments permission.
- ModAnchor post/comment menu actions may appear directly on Reddit posts and comments.
- Junior moderators are encouraged to use ModAnchor actions instead of native Reddit actions during Review Mode.
- Native Reddit actions may still be available and are tracked separately where possible.

---

## Workspace privacy

ModAnchor runs through a Devvit custom-post workspace, but the workspace post is automatically **locked and removed from the public subreddit feed** after creation.

This keeps the workspace out of the normal community feed while still allowing moderators to access it through the moderator-only subreddit menu action. Backend access checks continue to protect ModAnchor data and actions, so regular community members cannot use the workspace even if they somehow reach the post URL.

The reliable access path is:

1. Open the subreddit.
2. Click the subreddit **three-dot menu** (`...`) near the community header or Mod Tools area.
3. Select **Open ModAnchor Workspace**.
4. Open the ModAnchor workspace.

---

## Native Reddit actions

ModAnchor does not block native Reddit moderation actions.

If a moderator has native Reddit permissions, they may still be able to approve, remove, lock, ban, or act outside ModAnchor. ModAnchor handles this transparently:

- Actions submitted through ModAnchor are routed through Review Mode.
- Native Reddit actions are not blocked.
- Native action usage can be surfaced from mod log data where available.
- Reports can use native action usage as a coaching signal.

This makes ModAnchor a review and onboarding layer, not a replacement for Reddit’s moderation system.

---

## Senior moderator experience

Senior moderators can:

- Open the private ModAnchor workspace.
- Start, edit, advance, and complete moderator reviews.
- Configure approval and monitoring phases.
- Approve or reject queued actions.
- Monitor executed actions.
- Receive per-action or daily digest updates.
- Generate and review reports.
- Manage report history.
- Use the Guide to onboard a moderation team consistently.

---

## Junior moderator experience

Junior moderators can:

- Use Action Console to submit moderation actions.
- Select users, posts, or comments as action targets.
- Provide internal reasons and removal notes where needed.
- Track submitted actions.
- Read the Guide to understand the review process.

Depending on the review phase, their actions are either queued for senior approval or executed and monitored through ModAnchor.

---

## What ModAnchor does not do

ModAnchor is intentionally designed as a human-review workflow, not an automated moderation replacement.

It does not:

- Replace Reddit’s mod queue.
- Replace senior moderator judgment.
- Block all native Reddit actions.
- Rank moderators.
- Publicly expose onboarding data.
- Automatically decide whether someone is ready to graduate.
- Automatically edit wiki pages or community rules.
- Use LLMs in the current MVP.

---

## Design principles

### Safety before speed

New moderators should be able to learn through real work without needing full trust on day one.

### Human review first

ModAnchor keeps senior moderators in control of sensitive decisions.

### Training through real workflows

Junior moderators learn by submitting real actions with guardrails and feedback.

### Clear audit trail

Actions should have reasons, statuses, timestamps, and review outcomes.

### Honest limits

Native Reddit actions cannot be fully blocked, so ModAnchor tracks and reports them where possible instead of pretending they do not exist.

---

## Product status

ModAnchor currently supports:

- Private moderator workspace
- Senior and junior access views
- Review Mode
- Approval phase
- Monitoring phase
- Action Console
- User, post, and comment actions
- Per-action monitoring notifications
- UTC daily digest scheduling
- Manual digest generation
- Automatic final reports
- Report History
- In-app Guide
- Workspace post locking and feed removal

Future improvements may include richer native action correlation, configurable digest schedules, exportable reports, team-level onboarding templates, and deeper community-specific policy checks.
