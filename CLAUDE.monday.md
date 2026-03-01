# Monday Integration (monday.com Task Sync)

These rules apply after the Monday Integration scripts are installed into this repo.

Create a task:

```powershell
python scripts/task_create.py --title "..." --group "Improvements" --status "Task Created" --description "..." --comments "..."
```

Update a task:

```powershell
python scripts/task_update.py --task-id "<id>" --status "Working on it" --comments "..."
```

Status lifecycle (enforced):
- Planned -> Task Created -> Fixing -> Awaiting Testing -> Done
- Planned can also move directly to Working on it or Fixing
- Task Created can move back to Planned
- Fixing -> Awaiting Testing (code done, user needs to test)
- Awaiting Testing -> Done (user confirmed it works)
- Awaiting Testing -> Fixing (user says it doesn't work, back to fixing)
- Working on it -> Done or Awaiting Testing

Allowed groups:
- Improvements
- Bug Fixes
- New Features
- Complete

## Subtasks

For multi-phase tasks, create subtasks under a parent task. Each phase should be a subtask.

Create a subtask:

```powershell
python scripts/task_subtask.py create --parent-id "<task_id>" --title "Phase 1: ..." --status "Planned"
```

Update a subtask (by index or title match):

```powershell
python scripts/task_subtask.py update --parent-id "<task_id>" --index 0 --status "Done"
python scripts/task_subtask.py update --parent-id "<task_id>" --title "Phase 1" --status "Working on it"
```

List subtasks:

```powershell
python scripts/task_subtask.py list --parent-id "<task_id>"
```

Subtask status lifecycle:
- Planned -> Starting -> Working on it -> Done
- Planned can also move directly to Working on it

Note: Monday subitems have limited built-in statuses. "Planned" maps to blank, "Starting" maps to "Working on it" on Monday.
