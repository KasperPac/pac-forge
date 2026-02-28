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


def delete_task(args):
    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    target = None
    for t in tasks:
        if args.task_id and t.get("task_id") == args.task_id:
            target = t
            break
        if args.title and t.get("title") == args.title:
            target = t
            break

    if not target:
        raise SystemExit("Task not found. Provide --task-id or exact --title.")

    item_id = target.get("monday_item_id")
    overview_id = target.get("overview_item_id")

    token = monday_sync.require_token()
    if item_id:
        monday_sync.delete_item(token, item_id)
    if overview_id:
        monday_sync.delete_item(token, overview_id)

    tasks.remove(target)
    data["tasks"] = tasks
    save_tasks(tasks_path, data)


def main():
    parser = argparse.ArgumentParser(description="Delete a monday task.")
    parser.add_argument("--task-id")
    parser.add_argument("--title")
    args = parser.parse_args()

    delete_task(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
