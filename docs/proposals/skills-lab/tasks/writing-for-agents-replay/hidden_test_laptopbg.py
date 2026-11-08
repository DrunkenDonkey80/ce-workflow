# Hidden acceptance test for the writing-for-agents replay (and P1 end to end): copied into tests/ after the run.
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from dealfinder import pricing, report
from dealfinder.db import open_db
from dealfinder.http import HostStopped
from dealfinder.sync import sync_bg

PAGE = (Path(__file__).parent / "fixtures" / "laptopbg_list.html").read_text(encoding="utf-8")
NOW = datetime(2026, 10, 10, tzinfo=UTC)


def request(method, url, **kwargs):
    if "laptop.bg" not in url:
        raise HostStopped("other host")
    return SimpleNamespace(text=PAGE, content=PAGE.encode("utf-8"), status_code=200)


def test_laptopbg_is_synced_as_a_trusted_shop(tmp_path):
    db = open_db(tmp_path / "t.db")
    counts, errors = sync_bg(db, SimpleNamespace(request=request), NOW)
    assert "laptopbg" not in errors and counts.get("laptopbg") == 2
    rows = {r["source_id"]: r for r in db.execute(
        "SELECT l.source_id, l.price_eur, l.url, s.fields FROM listings l JOIN specs s ON s.listing_id = l.id "
        "WHERE l.source = 'laptopbg'")}
    assert sorted(r["price_eur"] for r in rows.values()) == [489.0, 1049.0]
    t14 = next(json.loads(r["fields"]) for r in rows.values() if r["price_eur"] == 489.0)
    assert (t14["model"], t14["cpu"], t14["ram_gb"], t14["ssd_gb"], t14["screen_in"]) == ("t14 gen 2", "1135g7", 16, 512, 14)
    assert all(r["url"].startswith("https://laptop.bg/") for r in rows.values())
    db.close()


def test_laptopbg_counts_as_a_shop_everywhere():
    assert "laptopbg" in pricing.SHOPS
    assert "laptopbg" in report.SHOP_NAMES
