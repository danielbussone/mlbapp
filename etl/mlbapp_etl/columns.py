"""FanGraphs / pybaseball column → Postgres typed field coercion."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


def _is_na(v: Any) -> bool:
    if v is None:
        return True
    try:
        if v is pd.NA:
            return True
    except (TypeError, ValueError):
        pass
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, (np.floating, np.integer)) and pd.isna(v):
        return True
    return False


def pick(row: pd.Series, *names: str) -> Any:
    for n in names:
        if n in row.index:
            v = row[n]
            if not _is_na(v):
                return v
    return None


def as_text(v: Any) -> str | None:
    if _is_na(v):
        return None
    return str(v).strip()


def as_int(v: Any) -> int | None:
    if _is_na(v):
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def as_smallint(v: Any) -> int | None:
    x = as_int(v)
    if x is None:
        return None
    if x < -32768 or x > 32767:
        return None
    return x


def as_numeric(v: Any, ndigits: int | None = None) -> float | None:
    if _is_na(v):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    if ndigits is not None:
        return round(f, ndigits)
    return f


def as_fraction(v: Any) -> float | None:
    """
    Rates stored as decimal fractions per SCHEMA_PROPOSAL (e.g. 0.105 = 10.5%).
    pybaseball already divides most ``%`` columns by 100; this normalizes
    occasional scale-0–100 floats from upstream.
    """
    x = as_numeric(v)
    if x is None:
        return None
    if x > 1.0 + 1e-9 and x <= 100.0:
        return x / 100.0
    return x
