import json
import sys
from pathlib import Path

import monday_sync


def delete_column(token, board_id, column_id):
    query = """
    mutation ($board_id: ID!, $column_id: String!) {
      delete_column(board_id: $board_id, column_id: $column_id) {
        id
      }
    }
    """
    monday_sync.gql(
        token,
        query,
        {"board_id": str(board_id), "column_id": column_id},
    )


def cleanup():
    token = monday_sync.require_token()
    config = monday_sync.load_json(Path("monday.config.json"))

    board_id = config["board_id"]
    columns = monday_sync.list_columns(token, board_id)
    keep_ids = {
        "name",
        config["columns"]["status"],
        config["columns"]["description"],
        config["columns"]["improvements"],
        config["columns"]["comments"],
    }

    to_delete = []
    for c in columns:
        if c["id"] in keep_ids:
            continue
        if c["type"] in {"status", "text", "long_text"} and c["title"] in {
            "Status",
            "Description",
            "Improvements",
            "Comments",
        }:
            to_delete.append(c["id"])

    for col_id in to_delete:
        delete_column(token, board_id, col_id)

    print(f"Deleted {len(to_delete)} column(s).")


if __name__ == "__main__":
    try:
        cleanup()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
