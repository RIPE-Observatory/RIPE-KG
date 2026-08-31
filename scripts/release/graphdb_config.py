"""Render a repository configuration without changing the checked-in template."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def render(repository: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", repository):
        raise ValueError("Invalid repository ID")
    template = (ROOT / "graphdb-config/repository-config.ttl").read_text()
    return template.replace(
        'rep:repositoryID "ripe"', f'rep:repositoryID "{repository}"'
    )


if __name__ == "__main__":
    print(render(sys.argv[1]))
