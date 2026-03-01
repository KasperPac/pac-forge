"""Create or update subtasks under a parent Monday task.

Usage:
  # Create a subtask
  python scripts/task_subtask.py create --parent-id <task_id> --title "Phase 1: Migration" --status "Planned"

  # Update a subtask status
  python scripts/task_subtask.py update --parent-id <task_id> --index 0 --status "Done"

  # Update by title match
  python scripts/task_subtask.py update --parent-id <task_id> --title "Phase 1" --status "Working on it"

  # List subtasks
  python scripts/task_subtask.py list --parent-id <task_id>
"""

import argparse
import json
import sys
from pathlib import Path

import monday_sync

SUBTASK_STATUSES = ["Planned", "Starting", "Working on it", "Done"]

SUBTASK_STATUS_TRANSITIONS = {
    "Planned": {"Starting", "Working on it"},
    "Starting": {"Working on it"},
    "Working on it": {"Done"},
    "Done": {"Done"},
}

# Monday subitems use a default status column with limited labels.
# Map our statuses to what Monday supports on subitems.
MONDAY_SUBITEM_STATUS_MAP = {
    "Planned": None,            # no status = not started (shows as blank)
    "Starting": "Working on it",
    "Working on it": "Working on it",
    "Done": "Done",
}


def load_tasks(path):
    if not path.exists():
        return {"tasks": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tasks(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def find_task(tasks, task_id):
    for t in tasks:
        if t.get("task_id") == task_id:
            return t
    return None


def create_subitem(token, parent_item_id, name, status_label=None):
    """Create a Monday subitem under a parent item."""
    column_values = {}
    monday_status = MONDAY_SUBITEM_STATUS_MAP.get(status_label) if status_label else None
    if monday_status:
        column_values["status"] = {"label": monday_status}

    query = """
    mutation ($parent_id: ID!, $name: String!, $column_values: JSON!) {
      create_subitem(parent_item_id: $parent_id, item_name: $name, column_values: $column_values) {
        id
      }
    }
    """
    res = monday_sync.gql(token, query, {
        "parent_id": str(parent_item_id),
        "name": name,
        "column_values": json.dumps(column_values),
    })
    return int(res["data"]["create_subitem"]["id"])


def update_subitem(token, board_id, subitem_id, status_label):
    """Update a Monday subitem's status."""
    # Get the subitem's board (subitems live on a separate board)
    query = """
    query ($item_id: [ID!]) {
      items(ids: $item_id) {
        board {
          id
        }
        column_values {
          id
          type
        }
      }
    }
    """
    res = monday_sync.gql(token, query, {"item_id": [str(subitem_id)]})
    items = res.get("data", {}).get("items", [])
    if not items:
        raise SystemExit(f"Subitem {subitem_id} not found")

    sub_board_id = items[0]["board"]["id"]

    # Find status column on the subitem board
    status_col = None
    for cv in items[0].get("column_values", []):
        if cv.get("type") == "status":
            status_col = cv["id"]
            break

    if not status_col:
        # Fallback: try common default
        status_col = "status"

    column_values = {status_col: {"label": status_label}}
    monday_sync.update_item(token, int(sub_board_id), subitem_id, column_values)


def cmd_create(args):
    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    task = find_task(tasks, args.parent_id)
    if not task:
        raise SystemExit(f"Parent task {args.parent_id} not found")

    parent_item_id = task.get("monday_item_id")
    if not parent_item_id:
        raise SystemExit("Parent task has no monday_item_id — sync it first")

    subtasks = task.get("subtasks", [])

    status = args.status or "Planned"
    if status not in SUBTASK_STATUSES:
        raise SystemExit(f"Invalid status: {status}. Allowed: {', '.join(SUBTASK_STATUSES)}")

    # Create on Monday
    token = monday_sync.require_token()
    subitem_id = create_subitem(token, parent_item_id, args.title, status)

    subtask = {
        "title": args.title,
        "status": status,
        "monday_subitem_id": subitem_id,
    }
    subtasks.append(subtask)
    task["subtasks"] = subtasks

    save_tasks(tasks_path, data)
    print(f"Created subtask: {args.title} (subitem_id={subitem_id})")


def cmd_update(args):
    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    task = find_task(tasks, args.parent_id)
    if not task:
        raise SystemExit(f"Parent task {args.parent_id} not found")

    subtasks = task.get("subtasks", [])
    if not subtasks:
        raise SystemExit("No subtasks found under this task")

    # Find subtask by index or title
    subtask = None
    if args.index is not None:
        if args.index < 0 or args.index >= len(subtasks):
            raise SystemExit(f"Index {args.index} out of range (0-{len(subtasks)-1})")
        subtask = subtasks[args.index]
    elif args.title:
        for st in subtasks:
            if args.title.lower() in st.get("title", "").lower():
                subtask = st
                break
        if not subtask:
            raise SystemExit(f"No subtask matching '{args.title}'")
    else:
        raise SystemExit("Provide --index or --title to identify the subtask")

    if args.status:
        if args.status not in SUBTASK_STATUSES:
            raise SystemExit(f"Invalid status: {args.status}. Allowed: {', '.join(SUBTASK_STATUSES)}")

        current = subtask.get("status", "Planned")
        allowed = SUBTASK_STATUS_TRANSITIONS.get(current, {current})
        if args.status not in allowed and args.status != current:
            raise SystemExit(
                f"Invalid transition: {current} -> {args.status}. "
                f"Allowed: {', '.join(sorted(allowed))}"
            )

        subtask["status"] = args.status

        # Update on Monday
        subitem_id = subtask.get("monday_subitem_id")
        if subitem_id:
            monday_status = MONDAY_SUBITEM_STATUS_MAP.get(args.status)
            if monday_status:
                token = monday_sync.require_token()
                board_id = task.get("monday_item_id", 0)
                try:
                    update_subitem(token, board_id, subitem_id, monday_status)
                except Exception as e:
                    print(f"Warning: Monday update failed: {e}", file=sys.stderr)

    save_tasks(tasks_path, data)
    print(f"Updated subtask: {subtask['title']} -> {subtask.get('status')}")


def cmd_list(args):
    tasks_path = Path("tasks/tasks.json")
    data = load_tasks(tasks_path)
    tasks = data.get("tasks", [])

    task = find_task(tasks, args.parent_id)
    if not task:
        raise SystemExit(f"Parent task {args.parent_id} not found")

    subtasks = task.get("subtasks", [])
    if not subtasks:
        print("No subtasks.")
        return

    for i, st in enumerate(subtasks):
        status = st.get("status", "Planned")
        marker = {"Planned": " ", "Starting": ">", "Working on it": "*", "Done": "x"}.get(status, " ")
        print(f"  [{marker}] {i}: {st['title']} ({status})")


def main():
    parser = argparse.ArgumentParser(description="Manage Monday subtasks")
    sub = parser.add_subparsers(dest="command", required=True)

    create_p = sub.add_parser("create")
    create_p.add_argument("--parent-id", required=True)
    create_p.add_argument("--title", required=True)
    create_p.add_argument("--status", choices=SUBTASK_STATUSES)

    update_p = sub.add_parser("update")
    update_p.add_argument("--parent-id", required=True)
    update_p.add_argument("--index", type=int)
    update_p.add_argument("--title")
    update_p.add_argument("--status", choices=SUBTASK_STATUSES)

    list_p = sub.add_parser("list")
    list_p.add_argument("--parent-id", required=True)

    args = parser.parse_args()
    if args.command == "create":
        cmd_create(args)
    elif args.command == "update":
        cmd_update(args)
    elif args.command == "list":
        cmd_list(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
