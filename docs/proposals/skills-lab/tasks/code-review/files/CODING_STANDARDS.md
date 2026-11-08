# Coding standards

- Numbers read from listings (prices, percentages) are compared as `Decimal` through `pricing.money`, never as floats.
- Every config key is read with a default in code (`config.get(key, default)`) and documented with a comment in `config.toml`.
- Tests use fixtures and fake clients; no network.
