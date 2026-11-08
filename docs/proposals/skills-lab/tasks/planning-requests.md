# Planning requests for SK-06 (baseline) and PC-09 (candidate)

DealFinder `27221be`, through `scripts/rework-lab.mjs <run> --source C:/SOFT/git/DealFinder --sha 27221be --request-file <file>` (`--plan-only` for the first-turn endpoint). SK-05 writes each block below to its own request file. Endpoints and rubric: `../design.md` "Planning requests".

The hack-versus-prefactor tension: the list of trusted shops is spelled out in 4 modules (`normalize.py` shop tuple, `pricing.py` `SHOPS`, `report.py` `SHOP_NAMES`, `sync.py` import, fetch list and known-details map); currencies sit in `sources/ebay.py` `CURRENCIES` plus the ECB rates in `fx.py`; the quick-sale cut `sale_price` is a fixed rule used by `sync.py`, `pricing.evaluate` and the report text.

## P1 new shop source (hack vs prefactor; plan-only and one end-to-end run)

> Add Laptop.bg (https://laptop.bg/used-laptops) as a new Bulgarian refurbisher source, trusted like Kvant, Ardes and Izot. A saved list page is at `tests/fixtures/laptopbg_list.html`.

(SK-05 adds the same synthetic fixture as the writing-for-agents replay.)

## P2 Polish market (hack vs prefactor; plan-only)

> Also search eBay Poland (EBAY_PL) and price its listings in PLN, converted to EUR like GBP today.

## P3 per-source quick-sale cut (hack vs prefactor; plan-only)

> The quick-sale price is always the lowest Bulgarian price minus 10% (€20-50). Make the cut configurable per source in config.toml: shops sell faster than OLX, so their cut should be smaller.

## T tiny (end to end)

> Change the CLI description from "Find used laptop deals" to "Find used business-laptop deals on eBay against Bulgarian prices".

## F foggy (plan-only)

> I want to hear about deals without opening the report: maybe Telegram alerts, maybe a small web dashboard I can open on my phone. Not sure what's best.
