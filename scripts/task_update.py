import argparse
import json
import sys
from pathlib import Path

import monday_sync


def load_tasks(path):
    if not path.exists():
        return {"tasks": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tasks(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def find_task(tasks, task_id=None, title=None):
    if task_id:
        for t in tasks:
            if t.get("task_id") == task_id:
                return t
    if title:
        for t in tasks:
            if t.get("title") == title:
                return t
    return None


def update_task(args):
    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    task = find_task(tasks, task_id=args.task_id, title=args.title)
    if not task:
        raise SystemExit("Task not found. Provide --task-id or exact --title.")

    if args.status is not None:
        current = task.get("status") or "Task Created"
        allowed = monday_sync.STATUS_TRANSITIONS.get(current, {current})
        if args.status not in allowed and args.status != current:
            raise SystemExit(
                f"Invalid status transition: {current} -> {args.status}. "
                f"Allowed: {', '.join(sorted(allowed))}"
            )

    if args.description is not None:
        task["description"] = args.description
    if args.improvements is not None:
        task["improvements"] = args.improvements
    if args.comments is not None:
        task["comments"] = args.comments
    if args.status is not None:
        task["status"] = args.status
    if args.group is not None:
        task["group"] = args.group

    save_tasks(tasks_path, data)
    monday_sync.sync_tasks()


def main():
    parser = argparse.ArgumentParser(description="Update a monday task from Codex.")
    parser.add_argument("--task-id")
    parser.add_argument("--title")
    parser.add_argument("--description")
    parser.add_argument("--improvements")
    parser.add_argument("--comments")
    parser.add_argument("--status", choices=monday_sync.STATUS_LABELS)
    parser.add_argument("--group", choices=monday_sync.DEFAULT_GROUPS)
    args = parser.parse_args()

    update_task(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
