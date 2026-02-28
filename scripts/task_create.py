import argparse
import json
import sys
import uuid
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


def create_task(args):
    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    task_id = args.task_id or str(uuid.uuid4())
    title = args.title.strip()
    if not title:
        raise SystemExit("title is required")

    task = {
        "task_id": task_id,
        "title": title,
        "description": args.description or "",
        "improvements": args.improvements or "",
        "comments": args.comments or "",
        "status": args.status or "Task Created",
        "group": args.group or monday_sync.DEFAULT_GROUP,
    }

    tasks.append(task)
    data["tasks"] = tasks
    save_tasks(tasks_path, data)

    monday_sync.sync_tasks()

    print(task_id)


def main():
    parser = argparse.ArgumentParser(description="Create a monday task from Codex.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--description")
    parser.add_argument("--improvements")
    parser.add_argument("--comments")
    parser.add_argument("--status", choices=monday_sync.STATUS_LABELS)
    parser.add_argument("--group", choices=monday_sync.DEFAULT_GROUPS)
    parser.add_argument("--task-id")
    args = parser.parse_args()

    create_task(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
