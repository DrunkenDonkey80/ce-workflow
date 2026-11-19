# Keyless checks on our own files (plan 3f8f9ab7, C2/C3)

Run 2026-11-19 from the pinned clones in `C:\SOFT\git\repo-review`, on `C:\SOFT\git\ce-workflow\skills\{diagnosing-bugs,frontend-design,two-axis-review}`. No model keys were set in the environment, so nothing called a model. Reports went to `%TEMP%\rr03`, not the repo.

## SkillEvaluator `d8ddd4f7` (C2)

Command: `uvx --from C:/SOFT/git/repo-review/SkillEvaluator skillevaluator <check> <absolute skill path>`.

| Check | Result | Useful for us? |
| --- | --- | --- |
| `quality-check` (Tier 1 static) | All three: 88.5/100, grade B, required checks pass. Same 8 findings each: no examples; `metadata.author`/`metadata.tags` missing; description over 200 chars (301–403); no Purpose, Prerequisites, Limitations or Troubleshooting section. | No. The findings are a publication template. Our long descriptions are the trigger text Pi matches on, and the missing sections would add prompt bytes without a behavior. |
| `harness-check` | All three load in 6 of 6 profiles (claude-code, codex, copilot-cli, hermes, openclaw, opencode), 1–2 advisory notes each; catalog 1,106 description chars. | No. Pi is not one of the profiles; our loader evidence is `scripts/test-work-plan3.mjs:1464`. |
| `pii-scan` (whole `skills/`) | PASS, 4 checks. | Confirms nothing; no finding. |
| `security-scan` (whole `skills/`) | FAIL: 1 SECURITY-HIGH "Anti-Refusal: don't apologize" at `frontend-design/SKILL.md:75`. | False positive: the line tells UI error messages not to apologize; it is not about the agent's refusals. |

## Claude-BugHunter `0e70a021` (C3)

Command: `python scripts/lint_skills.py <absolute skill dirs>` (relative paths resolve inside the clone).

| Skill | Result |
| --- | --- |
| diagnosing-bugs, frontend-design, two-axis-review | Structure, size, control-character and secret checks pass. Each fails only "missing `sources:`" (BugHunter's own grounding-provenance field). Exit 1. |
| Ponytail (external, for comparison) | Same `sources:` error plus a wrong "description 1 char" warning: the linter does not read a YAML block-scalar description. |

The identifier denylist check is BugHunter-specific (hashes of their client names) and has nothing to match here.

## Conclusion

No real defect found in our skills. The only new signals are a security-scan false positive and two house conventions (`metadata`, `sources:`) that do not apply to Pi skills.
