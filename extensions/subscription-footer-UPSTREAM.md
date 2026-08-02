# Subscription footer upstream provenance

`extensions/subscription-footer.js` copies and adapts provider quota parsing, public
Statuspage incident polling, compact quota-bar rendering, and polling/cache lifecycle
ideas from `pi-usage-bar` at pinned revision:

`f21cabaafabe6aef90be88b0de229ab736abb486`

## Intentional divergences

- **Pi-auth-only:** credentials resolve only through Pi's public model registry; no CLI,
  environment, OpenCode, or private auth-store fallback is used.
- **International Z.ai:** GLM uses the international `api.z.ai` endpoint and Pi's `zai`
  provider identity.
- **GLM monthly exclusion/resetless session handling:** monthly tool limits are omitted;
  a recognized five-hour token session may render without a reset countdown.
- **Footer composition:** ce-workflow owns a multi-row Pi custom footer with model,
  context pressure, quota, and diagnostics rather than the upstream bar composition.
- **Workflow separation:** ce-workflow goal progress remains in its existing widget;
  the subscription footer does not duplicate it.
- **Cache identity/path:** cache entries are keyed by a hashed Pi-auth identity and live
  under Pi's global agent directory.
- **Freshness:** complete snapshots update atomically and failures retain stale quota.
  Most quota becomes unavailable after ten minutes; Claude polls every thirty minutes
  and remains cached for an additional thirty minutes after one failed poll.
- **Incidents:** a separate default-off global toggle polls only the pinned Claude,
  Codex, and GitHub Copilot public Statuspage endpoints; failures retain last-known
  incident state and never alter quota freshness.
- **Typography:** provider labels, quota windows, reset countdowns, bars, delimiters,
  wrapping, and the 56-column diagnostic follow ce-workflow's terminal contract.

## Upstream MIT license

MIT License

Copyright (c) 2026 satas20

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
