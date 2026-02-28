import argparse
import json
import sys
from collections import defaultdict
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


def group_key(task):
    return (task.get("title"), task.get("group") or monday_sync.DEFAULT_GROUP)


def cleanup(args):
    token = monday_sync.require_token()
    config = monday_sync.load_json(Path("monday.config.json"))
    board_id = config["board_id"]

    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    by_key = defaultdict(list)
    for t in tasks:
        by_key[group_key(t)].append(t)

    for key, entries in by_key.items():
        if len(entries) <= 1:
            continue

        # Determine newest by created_at using monday item ids
        item_ids = [str(e.get("monday_item_id")) for e in entries if e.get("monday_item_id")]
        if not item_ids:
            continue

        items = monday_sync.list_items(token, board_id)
        items_by_id = {i["id"]: i for i in items}

        def created_at(e):
            item = items_by_id.get(str(e.get("monday_item_id")))
            return item.get("created_at") if item else ""

        entries.sort(key=created_at)
        to_keep = entries[-1]
        to_delete = [e for e in entries if e is not to_keep]

        for e in to_delete:
            item_id = e.get("monday_item_id")
            if item_id:
                monday_sync.delete_item(token, item_id)

        by_key[key] = [to_keep]

    new_tasks = []
    for entries in by_key.values():
        new_tasks.extend(entries)
    data["tasks"] = new_tasks
    save_tasks(tasks_path, data)

    monday_sync.sync_tasks()


def main():
    parser = argparse.ArgumentParser(description="Cleanup duplicate tasks.")
    parser.add_argument("--keep", choices=["newest"], default="newest")
    args = parser.parse_args()
    cleanup(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
