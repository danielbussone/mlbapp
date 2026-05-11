#!/usr/bin/env python3
"""
Run Flyway in Docker against DATABASE_URL (e.g. RDS).

Expects DATABASE_URL in the environment (caller loads .env + optional MLBAPP_DOTENV).
Uses the same SQL mount as docker-compose flyway.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path


def database_url_to_flyway(url: str) -> tuple[str, str, str]:
    """
    Parse libpq-style ``postgresql://`` URLs for Flyway.

    ``urllib.parse.urlparse`` mishandles passwords that contain ``:`` (it treats extra
    colons as part of host/port). We split userinfo at the **first** ``:`` (user vs
    password) and host at the **last** ``@`` (credentials vs netloc), per PostgreSQL
    URI rules (reserved characters in the password should still be percent-encoded).
    """
    raw = url.strip()
    m = re.match(r"^(postgres(?:ql)?)://(.*)$", raw, re.IGNORECASE | re.DOTALL)
    if not m:
        raise ValueError("DATABASE_URL must start with postgres:// or postgresql://")
    rest = m.group(2)
    query = ""
    if "?" in rest:
        rest, query = rest.split("?", 1)

    if "@" in rest:
        userinfo, _, host_and_path = rest.rpartition("@")
        if ":" in userinfo:
            user, password = userinfo.split(":", 1)
        else:
            user, password = userinfo, ""
        user = urllib.parse.unquote(user)
        password = urllib.parse.unquote(password)
    else:
        user, password = "", ""
        host_and_path = rest

    if "/" in host_and_path:
        hostport, _, db = host_and_path.partition("/")
        db = db.split("/")[0] or "postgres"
    else:
        hostport, db = host_and_path, "postgres"

    hostport = urllib.parse.unquote(hostport)
    db = urllib.parse.unquote(db.split("?")[0]) or "postgres"

    host, port = _split_host_port(hostport)
    jdbc = f"jdbc:postgresql://{host}:{port}/{db}"
    if query:
        jdbc = f"{jdbc}?{query}"
    return jdbc, user, password


def _split_host_port(hostport: str) -> tuple[str, int]:
    hostport = hostport.strip()
    if not hostport:
        raise ValueError("DATABASE_URL has no host")
    if hostport.startswith("["):
        m = re.match(r"^\[([^\]]+)\](?::(\d+))?$", hostport)
        if not m:
            raise ValueError(f"Unrecognized bracketed host in DATABASE_URL: {hostport!r}")
        return m.group(1), int(m.group(2) or 5432)
    if ":" in hostport:
        host, _, port_s = hostport.rpartition(":")
        if port_s.isdigit():
            return host, int(port_s)
    return hostport, 5432


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    sql_dir = repo_root / "db" / "sql"
    if not sql_dir.is_dir():
        print(f"Missing Flyway SQL dir: {sql_dir}", file=sys.stderr)
        sys.exit(1)

    flyway_cmd = sys.argv[1] if len(sys.argv) > 1 else "migrate"
    if flyway_cmd not in ("migrate", "repair", "info", "validate", "baseline"):
        print(f"Unknown flyway command: {flyway_cmd!r}", file=sys.stderr)
        sys.exit(2)

    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        print(
            "DATABASE_URL is not set. Example: MLBAPP_DOTENV=.env.remote pnpm db:migrate:remote",
            file=sys.stderr,
        )
        sys.exit(1)

    jdbc, user, password = database_url_to_flyway(url)

    cmd = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{sql_dir}:/flyway/sql:ro",
        "-e",
        f"FLYWAY_URL={jdbc}",
        "-e",
        f"FLYWAY_USER={user}",
        "-e",
        f"FLYWAY_PASSWORD={password}",
        "-e",
        "FLYWAY_LOCATIONS=filesystem:/flyway/sql",
        "flyway/flyway:10-alpine",
        flyway_cmd,
    ]
    raise SystemExit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
