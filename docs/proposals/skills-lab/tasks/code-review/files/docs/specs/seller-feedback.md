# Spec: skip low-feedback eBay sellers

- New config key `min_seller_feedback_pct` (default 98): `scan` skips eBay listings whose seller feedback percentage is below it.
- Listings with unknown seller feedback are kept.
- `scan` returns the number of skipped listings as `"skipped_sellers"` in its result dict.
- A test covers a skipped, a kept and an unknown-feedback listing.
