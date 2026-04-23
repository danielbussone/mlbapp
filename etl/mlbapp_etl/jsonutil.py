"""JSON helpers for Postgres ``jsonb`` columns."""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    try:
        if value is pd.NA:
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (np.floating, np.integer)):
        v = value.item()
        return json_safe(v)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return [json_safe(x) for x in value]
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    return value


def row_to_stats_json(row: pd.Series) -> dict[str, Any]:
    d = row.to_dict()
    return {str(k): json_safe(v) for k, v in d.items()}
