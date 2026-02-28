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
- Planned -> Task Created -> Working on it -> Done
- Planned can also move directly to Working on it
- Task Created can move back to Planned

Allowed groups:
- Improvements
- Bug Fixes
- New Features
- Complete
