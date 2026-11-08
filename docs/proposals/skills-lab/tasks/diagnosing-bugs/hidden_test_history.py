# Hidden acceptance test for the diagnosing-bugs task: copied into tests/ only after the run ends.
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dealfinder.db import open_db
from dealfinder.sources import olx
from dealfinder.sync import load_references, store

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 10, 10, tzinfo=timezone.utc)


def records():
    page = json.loads((FIXTURES / "olx_offers.json").read_text(encoding="utf-8"))
    return [r for r in map(olx.parse_offer, page["data"]) if r and "thinkpad" in r["title"].lower()]


def test_sold_listing_stays_a_reference_inside_the_history_window(tmp_path):
    db = open_db(tmp_path / "test.db")
    first, *rest = records()
    store(db, [first, *rest], NOW - timedelta(days=10), complete=True)
    store(db, rest, NOW, complete=True)  # first is gone now
    refs = load_references(db, NOW, 90)
    assert any(r.get("historical") for r in refs if r["url"] == first["url"])
    assert not any(r["url"] == first["url"] for r in load_references(db, NOW + timedelta(days=81), 90))
    db.close()
