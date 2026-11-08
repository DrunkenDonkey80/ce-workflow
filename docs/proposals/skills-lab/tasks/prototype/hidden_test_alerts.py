# Hidden scenario test for the prototype task: copied into tests/ only after the run ends.
# Covers only the unambiguous rules; the deliberate ambiguities G1-G3 are judged, not tested.
import json
from datetime import UTC, datetime, timedelta

from dealfinder.alerts import alerts

T0 = datetime(2026, 10, 10, 12, tzinfo=UTC)


def cand(listing_id, margin, state="verified"):
    return {"listing_id": listing_id, "reference_listing_id": 900 + listing_id, "reference_price_eur": 300.0,
            "margin_eur": float(margin), "ebay_baseline_eur": None, "rank": float(margin), "state": state,
            "updated_at": T0.isoformat()}


def play(*steps):
    """steps: (hours after T0, candidate rows); returns alerted listing ids per step."""
    state, out = None, []
    for hours, rows in steps:
        found, state = alerts(state, rows, T0 + timedelta(hours=hours))
        json.dumps(state)  # must stay JSON-serializable
        out.append(sorted(a["listing_id"] for a in found))
    return out


def test_new_verified_deal_alerts_once():
    assert play((0, [cand(1, 150)]), (6, [cand(1, 150)])) == [[1], []]


def test_provisional_never_alerts():
    assert play((0, [cand(1, 150, "provisional")]), (1, [cand(1, 150)])) == [[], [1]]


def test_scan_reset_to_provisional_does_not_re_alert():
    assert play((0, [cand(1, 150)]), (6, [cand(1, 150, "provisional")]), (7, [cand(1, 150)])) == [[1], [], []]


def test_return_within_three_days_is_not_new():
    assert play((0, [cand(1, 150)]), (24, []), (48, [cand(1, 150)])) == [[1], [], []]


def test_margin_growth_of_at_least_20_alerts_again():
    assert play((0, [cand(1, 150)]), (6, [cand(1, 175)])) == [[1], [1]]
    assert play((0, [cand(2, 150)]), (6, [cand(2, 160)])) == [[2], []]


def test_dropped_candidate_gets_no_alert():
    assert play((0, [cand(1, 150), cand(2, 150)]), (6, [cand(2, 150)])) == [[1, 2], []]
