import argparse
import json
import os
import sys
from pathlib import Path
import uuid
from urllib import request

MONDAY_API_URL = "https://api.monday.com/v2"
STATUS_LABELS = ["Done", "Working on it", "Task Created", "Planned"]
DEFAULT_GROUP = "Improvements"
DEFAULT_GROUPS = ["Improvements", "Bug Fixes", "New Features", "Complete"]
STATUS_TRANSITIONS = {
    "Planned": {"Task Created", "Working on it"},
    "Task Created": {"Working on it", "Planned"},
    "Working on it": {"Done"},
    "Done": {"Done"},
}
API_VERSION = "2025-10"


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def load_env_file(path=".env"):
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def gql(token, query, variables=None):
    payload = {"query": query}
    if variables is not None:
        payload["variables"] = variables
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        MONDAY_API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": token,
            "API-Version": API_VERSION,
        },
        method="POST",
    )
    try:
        with request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
    except Exception as e:
        raise SystemExit(f"monday API request failed: {e}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise SystemExit(f"monday API returned non-JSON response: {raw}")
    if "errors" in data:
        raise SystemExit(f"monday API error: {data['errors']}")
    return data


def require_token():
    load_env_file()
    token = os.getenv("MONDAY_API_TOKEN")
    if not token:
        raise SystemExit("Missing MONDAY_API_TOKEN in environment.")
    return token


def get_repo_name():
    return Path.cwd().name


def find_board_id(token, workspace_id, board_name):
    query = """
    query ($workspace_id: [ID]) {
      boards(workspace_ids: $workspace_id) {
        id
        name
      }
    }
    """
    res = gql(token, query, {"workspace_id": [str(workspace_id)]})
    boards = res.get("data", {}).get("boards", [])
    for b in boards:
        if b.get("name") == board_name:
            return int(b["id"])
    return None


def create_board(token, workspace_id, board_name):
    query = """
    mutation ($name: String!, $workspace_id: ID!) {
      create_board(board_name: $name, board_kind: public, workspace_id: $workspace_id) {
        id
      }
    }
    """
    res = gql(token, query, {"name": board_name, "workspace_id": str(workspace_id)})
    return int(res["data"]["create_board"]["id"])


def create_column(token, board_id, title, column_type):
    query = """
    mutation ($board_id: ID!, $title: String!, $column_type: ColumnType!) {
      create_column(board_id: $board_id, title: $title, column_type: $column_type) {
        id
      }
    }
    """
    res = gql(
        token,
        query,
        {"board_id": str(board_id), "title": title, "column_type": column_type},
    )
    return res["data"]["create_column"]["id"]


def create_status_column(token, board_id, title, labels):
    col_id = f"status_{uuid.uuid4().hex[:8]}"
    safe_title = title.replace('"', '\\"')
    query = f'''
    mutation {{
      create_status_column(
        board_id: {board_id},
        id: "{col_id}",
        title: "{safe_title}",
        defaults: {{
          labels: [
            {{ color: american_gray, label: "Planned", index: 0}},
            {{ color: bright_blue, label: "Task Created", index: 1}},
            {{ color: working_orange, label: "Working on it", index: 2}},
            {{ color: done_green, label: "Done", index: 3}}
          ]
        }}
      ) {{
        id
        title
      }}
    }}
    '''
    res = gql(token, query)
    return res["data"]["create_status_column"]["id"]


def get_column_settings(token, board_id, column_id):
    query = """
    query ($board_id: [ID!], $column_id: [String!]) {
      boards(ids: $board_id) {
        columns(ids: $column_id) {
          id
          title
          type
          settings
          settings_str
        }
      }
    }
    """
    res = gql(token, query, {"board_id": [str(board_id)], "column_id": [column_id]})
    boards = res.get("data", {}).get("boards", [])
    if not boards:
        return None
    cols = boards[0].get("columns", [])
    return cols[0] if cols else None


def status_labels_match(token, board_id, column_id, desired_labels):
    col = get_column_settings(token, board_id, column_id)
    if not col:
        return False
    settings = col.get("settings")
    if not settings and col.get("settings_str"):
        try:
            settings = json.loads(col["settings_str"])
        except json.JSONDecodeError:
            settings = None
    if not settings:
        return False
    labels = settings.get("labels")
    if isinstance(labels, list):
        existing = [l.get("label") for l in labels if l.get("label")]
    elif isinstance(labels, dict):
        existing = [v for _, v in sorted(labels.items()) if v]
    else:
        existing = []
    return sorted(existing) == sorted(desired_labels)


def list_columns(token, board_id):
    query = """
    query ($board_id: [ID!]) {
      boards(ids: $board_id) {
        columns {
          id
          title
          type
        }
      }
    }
    """
    res = gql(token, query, {"board_id": [str(board_id)]})
    boards = res.get("data", {}).get("boards", [])
    if not boards:
        return []
    return boards[0].get("columns", [])


def find_column_by_id(columns, column_id):
    for c in columns:
        if c.get("id") == column_id:
            return c
    return None


def find_column_by_title_type(columns, title, col_type):
    for c in columns:
        if c.get("title") == title and c.get("type") == col_type:
            return c
    return None


def find_status_column_with_labels(token, board_id, columns, desired_labels):
    for c in columns:
        if c.get("type") != "status":
            continue
        if status_labels_match(token, board_id, c.get("id"), desired_labels):
            return c
    return None


def create_dashboard(token, name, kind, board_ids, workspace_id):
    query = """
    mutation ($name: String!, $kind: DashboardKind!, $board_ids: [ID!]!, $workspace_id: ID!) {
      create_dashboard(name: $name, kind: $kind, board_ids: $board_ids, workspace_id: $workspace_id) {
        id
      }
    }
    """
    res = gql(
        token,
        query,
        {
            "name": name,
            "kind": kind,
            "board_ids": [str(b) for b in board_ids],
            "workspace_id": str(workspace_id),
        },
    )
    return int(res["data"]["create_dashboard"]["id"])


def ensure_board_and_columns(token, config, repo_name):
    workspace_id = int(config["workspace_id"])
    if workspace_id <= 0:
        raise SystemExit("monday.config.json workspace_id must be set.")

    board_name = f"{config.get('board_prefix', '')}{repo_name}".strip()
    if not board_name:
        raise SystemExit("Board name resolved to empty. Set board_prefix or rename repo.")

    board_id = config.get("board_id")
    if not board_id:
        board_id = find_board_id(token, workspace_id, board_name)
    if not board_id:
        board_id = create_board(token, workspace_id, board_name)

    columns = config.get("columns", {})
    existing_columns = list_columns(token, board_id)

    status_id = columns.get("status")
    if status_id and not find_column_by_id(existing_columns, status_id):
        status_id = None

    if status_id and status_labels_match(token, board_id, status_id, STATUS_LABELS):
        columns["status"] = status_id
        config["status_labels"] = STATUS_LABELS
    else:
        matched = find_status_column_with_labels(
            token, board_id, existing_columns, STATUS_LABELS
        )
        if matched:
            columns["status"] = matched["id"]
            config["status_labels"] = STATUS_LABELS
        else:
            columns["status"] = create_status_column(
                token, board_id, "Status", STATUS_LABELS
            )
            config["status_labels"] = STATUS_LABELS

    desc = columns.get("description")
    if not desc or not find_column_by_id(existing_columns, desc):
        found = find_column_by_title_type(existing_columns, "Description", "text")
        columns["description"] = found["id"] if found else create_column(
            token, board_id, "Description", "text"
        )

    improvements = columns.get("improvements")
    if not improvements or not find_column_by_id(existing_columns, improvements):
        found = find_column_by_title_type(existing_columns, "Improvements", "text")
        columns["improvements"] = found["id"] if found else create_column(
            token, board_id, "Improvements", "text"
        )

    comments = columns.get("comments")
    if not comments or not find_column_by_id(existing_columns, comments):
        found = find_column_by_title_type(existing_columns, "Comments", "text")
        columns["comments"] = found["id"] if found else create_column(
            token, board_id, "Comments", "text"
        )

    config["board_id"] = board_id
    config["columns"] = columns
    return config


def ensure_overview_board_and_columns(token, config, repo_name):
    overview = config.get("overview", {})
    name = overview.get("name", "All Repos Overview")
    board_id = overview.get("board_id")

    if not board_id:
        board_id = find_board_id(token, int(config["workspace_id"]), name)
    if not board_id:
        board_id = create_board(token, int(config["workspace_id"]), name)

    columns = overview.get("columns", {})
    existing_columns = list_columns(token, board_id)

    repo_col = columns.get("repo")
    if not repo_col or not find_column_by_id(existing_columns, repo_col):
        found = find_column_by_title_type(existing_columns, "Repo", "text")
        columns["repo"] = found["id"] if found else create_column(
            token, board_id, "Repo", "text"
        )

    status_id = columns.get("status")
    if status_id and not find_column_by_id(existing_columns, status_id):
        status_id = None

    if status_id and status_labels_match(token, board_id, status_id, STATUS_LABELS):
        columns["status"] = status_id
        overview["status_labels"] = STATUS_LABELS
    else:
        matched = find_status_column_with_labels(
            token, board_id, existing_columns, STATUS_LABELS
        )
        if matched:
            columns["status"] = matched["id"]
            overview["status_labels"] = STATUS_LABELS
        else:
            columns["status"] = create_status_column(
                token, board_id, "Status", STATUS_LABELS
            )
            overview["status_labels"] = STATUS_LABELS

    desc = columns.get("description")
    if not desc or not find_column_by_id(existing_columns, desc):
        found = find_column_by_title_type(existing_columns, "Description", "text")
        columns["description"] = found["id"] if found else create_column(
            token, board_id, "Description", "text"
        )

    improvements = columns.get("improvements")
    if not improvements or not find_column_by_id(existing_columns, improvements):
        found = find_column_by_title_type(existing_columns, "Improvements", "text")
        columns["improvements"] = found["id"] if found else create_column(
            token, board_id, "Improvements", "text"
        )

    comments = columns.get("comments")
    if not comments or not find_column_by_id(existing_columns, comments):
        found = find_column_by_title_type(existing_columns, "Comments", "text")
        columns["comments"] = found["id"] if found else create_column(
            token, board_id, "Comments", "text"
        )

    source_item_id = columns.get("source_item_id")
    if not source_item_id or not find_column_by_id(existing_columns, source_item_id):
        found = find_column_by_title_type(existing_columns, "Source Item ID", "text")
        columns["source_item_id"] = found["id"] if found else create_column(
            token, board_id, "Source Item ID", "text"
        )

    overview["name"] = name
    overview["board_id"] = board_id
    overview["columns"] = columns
    config["overview"] = overview
    return config


def ensure_dashboard(token, config, overview_board_id, overview_status_column_id):
    dashboard = config.get("dashboard", {})
    name = dashboard.get("name", "All Repos Dashboard")
    kind = dashboard.get("kind", "PRIVATE")
    dashboard_id = dashboard.get("id")
    widget_id = dashboard.get("widget_id")

    if not dashboard_id:
        dashboard_id = create_dashboard(
            token,
            name,
            kind,
            [overview_board_id],
            config["workspace_id"],
        )

    dashboard["name"] = name
    dashboard["kind"] = kind
    dashboard["id"] = dashboard_id
    dashboard["widget_id"] = widget_id
    config["dashboard"] = dashboard
    return config


def list_groups(token, board_id):
    query = """
    query ($board_id: [ID!]) {
      boards(ids: $board_id) {
        groups {
          id
          title
        }
      }
    }
    """
    res = gql(token, query, {"board_id": [str(board_id)]})
    boards = res.get("data", {}).get("boards", [])
    if not boards:
        return []
    return boards[0].get("groups", [])


def ensure_group(token, board_id, title):
    for g in list_groups(token, board_id):
        if g.get("title") == title:
            return g.get("id")
    query = """
    mutation ($board_id: ID!, $title: String!) {
      create_group(board_id: $board_id, group_name: $title) {
        id
      }
    }
    """
    res = gql(token, query, {"board_id": str(board_id), "title": title})
    return res["data"]["create_group"]["id"]


def create_item(token, board_id, name, column_values, group_id=None):
    query = """
    mutation ($board_id: ID!, $name: String!, $column_values: JSON!, $group_id: String) {
      create_item(board_id: $board_id, item_name: $name, column_values: $column_values, group_id: $group_id) {
        id
      }
    }
    """
    res = gql(
        token,
        query,
        {
            "board_id": str(board_id),
            "name": name,
            "column_values": json.dumps(column_values),
            "group_id": group_id,
        },
    )
    return int(res["data"]["create_item"]["id"])


def update_item(token, board_id, item_id, column_values):
    query = """
    mutation ($board_id: ID!, $item_id: ID!, $column_values: JSON!) {
      change_multiple_column_values(board_id: $board_id, item_id: $item_id, column_values: $column_values) {
        id
      }
    }
    """
    gql(
        token,
        query,
        {
            "board_id": str(board_id),
            "item_id": str(item_id),
            "column_values": json.dumps(column_values),
        },
    )


def delete_item(token, item_id):
    query = """
    mutation ($item_id: ID!) {
      delete_item(item_id: $item_id) {
        id
      }
    }
    """
    gql(token, query, {"item_id": str(item_id)})


def normalize_status(status):
    if status in STATUS_LABELS:
        return status
    return "Planned"


def list_items(token, board_id, limit=200):
    query = """
    query ($board_id: ID!, $limit: Int!, $cursor: String) {
      boards(ids: [$board_id]) {
        items_page(limit: $limit, cursor: $cursor) {
          cursor
          items {
            id
            name
            created_at
            group {
              id
              title
            }
          }
        }
      }
    }
    """
    items = []
    cursor = None
    while True:
        res = gql(
            token,
            query,
            {"board_id": str(board_id), "limit": limit, "cursor": cursor},
        )
        boards = res.get("data", {}).get("boards", [])
        if not boards:
            break
        page = boards[0].get("items_page")
        if not page:
            break
        items.extend(page.get("items", []))
        cursor = page.get("cursor")
        if not cursor:
            break
    return items


def find_existing_item_id(token, board_id, title, group_title):
    for item in list_items(token, board_id):
        if item.get("name") != title:
            continue
        group = item.get("group") or {}
        if group_title and group.get("title") != group_title:
            continue
        return int(item["id"])
    return None


def cleanup_duplicate_items(token, board_id):
    items = list_items(token, board_id)
    by_key = {}
    for item in items:
        key = (item.get("name"), (item.get("group") or {}).get("title"))
        if key not in by_key:
            by_key[key] = []
        by_key[key].append(item)

    deleted = 0
    for key, group_items in by_key.items():
        if len(group_items) <= 1:
            continue
        group_items.sort(key=lambda i: i.get("created_at") or "")
        for dup in group_items[:-1]:
            delete_item(token, dup["id"])
            deleted += 1
    return deleted


def sync_tasks():
    token = require_token()
    config_path = Path("monday.config.json")
    tasks_path = Path("tasks/tasks.json")

    if not config_path.exists():
        raise SystemExit("Missing monday.config.json.")
    if not tasks_path.exists():
        raise SystemExit("Missing tasks/tasks.json.")

    config = load_json(config_path)
    repo_name = get_repo_name()
    config = ensure_board_and_columns(token, config, repo_name)
    config = ensure_overview_board_and_columns(token, config, repo_name)

    tasks_data = load_json(tasks_path)
    tasks = tasks_data.get("tasks", [])

    board_id = config["board_id"]
    columns = config["columns"]
    overview = config["overview"]
    overview_board_id = overview["board_id"]
    overview_columns = overview["columns"]

    config = ensure_dashboard(
        token,
        config,
        overview_board_id,
        overview_columns["status"],
    )

    cleanup_duplicate_items(token, board_id)

    for group_title in DEFAULT_GROUPS:
        ensure_group(token, board_id, group_title)

    updated = False
    for t in tasks:
        title = t.get("title", "").strip()
        if not title:
            continue

        status = normalize_status(t.get("status"))
        column_values = {
            columns["status"]: {"label": status},
            columns["description"]: t.get("description", ""),
            columns["improvements"]: t.get("improvements", ""),
            columns["comments"]: t.get("comments", ""),
        }

        group_title = (t.get("group") or DEFAULT_GROUP).strip()
        group_id = ensure_group(token, board_id, group_title)

        item_id = t.get("monday_item_id")
        if not item_id:
            existing = find_existing_item_id(token, board_id, title, group_title)
            if existing:
                item_id = existing
                t["monday_item_id"] = item_id
                updated = True
        if not item_id:
            item_id = create_item(token, board_id, title, column_values, group_id)
            t["monday_item_id"] = item_id
            updated = True
        else:
            update_item(token, board_id, item_id, column_values)

        overview_name = f"{repo_name} - {title}"
        overview_values = {
            overview_columns["repo"]: repo_name,
            overview_columns["status"]: {"label": status},
            overview_columns["description"]: t.get("description", ""),
            overview_columns["improvements"]: t.get("improvements", ""),
            overview_columns["comments"]: t.get("comments", ""),
            overview_columns["source_item_id"]: str(item_id),
        }

        overview_item_id = t.get("overview_item_id")
        if not overview_item_id:
            overview_item_id = create_item(
                token,
                overview_board_id,
                overview_name,
                overview_values,
            )
            t["overview_item_id"] = overview_item_id
            updated = True
        else:
            update_item(token, overview_board_id, overview_item_id, overview_values)

    if updated:
        save_json(tasks_path, tasks_data)

    save_json(config_path, config)
    print(f"Synced {len(tasks)} task(s) to board {board_id}.")


def main():
    parser = argparse.ArgumentParser(description="Sync local tasks to monday.com.")
    parser.add_argument("command", nargs="?", default="sync", choices=["sync"])
    args = parser.parse_args()

    if args.command == "sync":
        sync_tasks()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
