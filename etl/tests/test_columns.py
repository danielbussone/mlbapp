import math

import pandas as pd

from mlbapp_etl.columns import as_fraction, as_int, as_numeric, pick


def test_pick_first_match():
    row = pd.Series({"a": 1, "b": 2})
    assert pick(row, "x", "a") == 1


def test_as_fraction_scale():
    assert as_fraction(0.105) == 0.105
    assert as_fraction(10.5) == 0.105


def test_as_int():
    assert as_int(3.7) == 4
    assert as_int(float("nan")) is None


def test_as_numeric_nan():
    assert as_numeric(float("nan")) is None


def test_math_nan():
    assert as_numeric(math.nan) is None
