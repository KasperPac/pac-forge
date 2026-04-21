#!/usr/bin/env python3
import json
import uuid
from pathlib import Path

# Generate a new task
task_id = str(uuid.uuid4())
new_task = {
    "task_id": task_id,
    "title": "Remove kanban from dev script",
    "description": "Remove kanban block from scripts/dev.mjs since the kanban board is no longer needed. Hardcoded path to old PC's user directory (C:\\Users\\kaspe\\...) and pnpm dependency are being dropped.",
    "improvements": "",
    "comments": "",
    "status": "Working on it",
    "group": "Improvements",
    "_dirty": True
}

# Load existing tasks
tasks_path = Path("tasks/tasks.json")
with open(tasks_path, "r", encoding="utf-8") as f:
    data = json.load(f)

# Add the new task
data["tasks"].append(new_task)

# Write back
with open(tasks_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print(task_id)
