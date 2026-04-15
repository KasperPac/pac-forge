#!/usr/bin/env python3
"""Sync FEAT-32 task to Monday.com"""

import sys
from pathlib import Path

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent / "scripts"))

from monday_sync import sync_tasks

if __name__ == "__main__":
    sync_tasks()
