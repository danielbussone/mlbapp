import os
from pathlib import Path

import pytest

from mlbapp_etl.runtime import load_repo_dotenv


def test_load_repo_dotenv_sets_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("DATABASE_URL=postgresql://from/file\n", encoding="utf-8")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    load_repo_dotenv(tmp_path)
    assert os.environ["DATABASE_URL"] == "postgresql://from/file"


def test_load_repo_dotenv_no_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("DATABASE_URL=postgresql://from/file\n", encoding="utf-8")
    monkeypatch.setenv("DATABASE_URL", "postgresql://already")
    load_repo_dotenv(tmp_path)
    assert os.environ["DATABASE_URL"] == "postgresql://already"


def test_load_repo_dotenv_export_prefix(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("export DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    load_repo_dotenv(tmp_path)
    assert os.environ["DATABASE_URL"] == "postgresql://x"


def test_load_repo_dotenv_missing_file(tmp_path: Path) -> None:
    load_repo_dotenv(tmp_path)  # no .env file — no error


def test_load_repo_dotenv_overlay_overrides_base(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text(
        "DATABASE_URL=postgresql://local/mlbapp\nMLBAPP_DOTENV=.env.remote\n",
        encoding="utf-8",
    )
    (tmp_path / ".env.remote").write_text("DATABASE_URL=postgresql://remote/postgres\n", encoding="utf-8")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MLBAPP_DOTENV", raising=False)
    load_repo_dotenv(tmp_path)
    assert os.environ["DATABASE_URL"] == "postgresql://remote/postgres"


def test_load_repo_dotenv_overlay_from_env_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env.remote").write_text("DATABASE_URL=postgresql://remote/postgres\n", encoding="utf-8")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("MLBAPP_DOTENV", ".env.remote")
    load_repo_dotenv(tmp_path)
    assert os.environ["DATABASE_URL"] == "postgresql://remote/postgres"
