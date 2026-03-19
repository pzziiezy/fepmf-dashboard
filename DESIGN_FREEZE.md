# Design Freeze Policy (Release Baseline)

Baseline release tag: `release-2026-03-19`

## Goal
Protect the approved UI/UX baseline and allow future feature development without visual regression.

## Rules
1. Do not change baseline visual styles unless explicitly approved by product owner.
2. For new features, prefer new scoped classes/components instead of editing shared base styles.
3. Keep existing layout structure and spacing of current pages (`Overview`, `Calendar Planner`, `Shift Planner`) unchanged.
4. Any required visual change must be proposed first with impact notes before implementation.
5. All new work must be developed on branch `develop-next` (not directly on baseline release branch/tag).

## Rollback
If issues happen, rollback target is tag: `release-2026-03-19`.
