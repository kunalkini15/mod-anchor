# ModAnchor

Private wiki alignment and onboarding tools for subreddit mod teams.

## MVP modules

- Wiki Anchor
- ModOnboard
- Report History

## What ModAnchor does

- Loads recent moderation-log activity for Moderator Action Insights.
- Filters platform/app actions by default.
- Generates deterministic, human-reviewed wiki improvement reports.
- Runs Content Alignment Signals using lightweight local similarity against wiki/rules text.
- Loads subreddit moderators for onboarding support.
- Generates private ModOnboard coaching reports.
- Stores report history.

## What ModAnchor does not do

- Does not automatically remove, approve, ban, message users, or edit wiki pages.
- Does not rank moderators.
- Does not use LLMs in the MVP.

## Local development

```bash
npm install
npm run build
npm run type-check
npm run lint
npm run dev
```

## Demo flow

1. Open the ModAnchor post in the playtest subreddit.
2. Open the workspace.
3. Preview recent Wiki Anchor moderation activity.
4. Generate a Wiki Improvement Report from moderation activity.
5. Run Content Alignment Signals with mock wiki/posts.
6. Add a moderator in ModOnboard.
7. Generate ModOnboard report.
8. Review saved reports in History.

## Dashboard access note

ModAnchor dashboard access is provided through the installed app/custom post workspace and moderator menu actions. Reddit's native Mod Queue left sidebar does not expose custom Devvit app entries in this setup.
