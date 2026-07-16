"""parse_filename name extraction: trailing -N suffix stripping.

A name part may contain a hyphen (e.g. "Anna-Lena") but never a trailing `-`
followed by digits only. Lightroom can stack duplicate suffixes on exported
copies (e.g. "Valter-2-2"), so ALL trailing `-N` groups must be stripped, not
just the last one. The leading timestamp burst marker (`-N` right after the
`HHMMSS` prefix) is separate and must not affect the parsed names.
"""

import pytest

from core.playerstats import parse_filename


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        # Single trailing -N suffix.
        ("260715_123704_Valter-2.jpg", ["Valter"]),
        # Stacked Lightroom duplicate suffixes.
        ("260715_123556-1_Valter-2-2.jpg", ["Valter"]),
        ("260715_123556-1_Valter-2-3.jpg", ["Valter"]),
        # Timestamp burst marker alone must not touch the name.
        ("260715_123704-2_Valter.jpg", ["Valter"]),
        # Hyphenated name without a trailing number is preserved.
        ("260715_123704_Anna-Lena.jpg", ["Anna-Lena"]),
        # Multiple names, one hyphenated, one with stacked suffixes.
        ("260715_123704_Anna-Lena,_Bert-2-2.jpg", ["Anna-Lena", "Bert"]),
    ],
)
def test_parse_filename_strips_stacked_suffixes(filename, expected):
    _dt, names = parse_filename(filename)
    assert names == expected
