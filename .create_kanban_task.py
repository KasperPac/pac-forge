#!/usr/bin/env python3
"""Create Monday.com task for removing kanban from dev script"""
import json
import os
from pathlib import Path
from urllib import request, error

MONDAY_API_URL = "https://api.monday.com/v2"
API_VERSION = "2025-10"

# Load config and get token from environment
def load_env_file(path=".env"):
    p = Path(path)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

load_env_file()
token = os.getenv("MONDAY_API_TOKEN")
if not token:
    raise SystemExit("Missing MONDAY_API_TOKEN in environment.")

# GraphQL mutation to create item
query = """
mutation ($board_id: ID!, $item_name: String!, $column_values: JSON!, $group_id: String) {
  create_item(board_id: $board_id, item_name: $item_name, column_values: $column_values, group_id: $group_id) {
    id
    name
  }
}
"""

# Column IDs from monday.config.json
status_col = "status_d6ba8adb"
desc_col = "text_mm0zxr0q"
comments_col = "text_mm0zyn0w"

# Column values for the new task
column_values = {
    status_col: {"label": "Working on it"},
    desc_col: "Remove kanban block from scripts/dev.mjs since the kanban board is no longer needed. Hardcoded path to old PC's user directory (C:\\Users\\kaspe\\...) and pnpm dependency are being dropped.",
    comments_col: ""
}

variables = {
    "board_id": "5092432355",
    "item_name": "Remove kanban from dev script",
    "column_values": column_values,
    "group_id": "group_mm0ztp9x"  # Improvements group
}

payload = {"query": query, "variables": variables}
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
    data = json.loads(raw)

    if "errors" in data:
        raise SystemExit(f"monday API error: {data['errors']}")

    item_id = data["data"]["create_item"]["id"]
    print(item_id)

except Exception as e:
    raise SystemExit(f"monday API request failed: {e}")
