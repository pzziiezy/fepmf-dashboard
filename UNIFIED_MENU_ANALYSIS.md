# Unified Planner Analysis (Preview Phase)

## 1) Problem Statement
- Current split menus (`Calendar Planner` and `To Do Checklist`) create context switching and inconsistent `Done` behavior for tasks that originate in checklist but render in calendar timeline.
- The immediate defect is identity resolution: calendar-side done action favored `sourceType=planner` tasks and could create a new planner task record instead of updating the original checklist task (`sourceType=todo`) linked by `plannerRefId`.

## 2) Current-State Model
- `api/planner` stores timeline entities (`manual`) and is the display source for calendar bars.
- `api/todo` stores checklist entities with audit/log/done state.
- A checklist task with timeline dates creates/updates a planner item and stores the link in `todo.plannerRefId`.
- Therefore, the `todo` task row is the authoritative done-state for checklist-origin work.

## 3) Target-State Design (Before Decommission)
- Build a new `Unified Planner` page while preserving old menus.
- New page combines:
  - Timeline view (calendar bars)
  - Checklist view
  - Shared inspector
  - Shared auth + done operation
- Done update strategy:
  1. If selected item has `taskId`, update that exact task.
  2. Else if selected item has `plannerRefId`, find linked task by `plannerRefId` (prefer `sourceType=todo` over `planner`).
  3. Only if no linked task exists and action is `Done`, create a planner-linked todo record.

## 4) Non-Goals in Preview Phase
- Do not remove existing pages (`calendar.html`, `todo.html`) yet.
- Do not migrate all advanced edit workflows into unified page in first preview.

## 5) Acceptance Criteria for Preview
- Selecting timeline items created from checklist and pressing Done updates the original checklist row.
- Inspector done metadata (`doneAt`, `doneByEmail`) reflects single-source task state.
- Old menus remain available unchanged for rollback comparison.

