Now think this one through as this is gonna be the main orchestrator of the development based on ce and beads. Beads will be the one and only source of truth for work to be done and what is completed, the plans will go there, the tasks will go there, the status will be there, the relationship too. I want to use goal to automate going through bead epic master plan one slice at a time, brainstorm and plan when needed, ce-work, review and fix and commit, and do these with subagents. I want the stuff to be done with skills so I dont wnat to write lengthty posts, I want to be able to fully resume work from whenever it is interrupted, follow the plan and do not deviate, I want to be able to do manual changes that will not break it, I want to be able to easily pause stuff, add more work and implement it right away and continue. And have commands for all like

small task:
/work-small change that thing
it will do it right away and create direct bead with it and mark completed, just so we know, in session

/work-med lets see how this can be done, plan it
it will do a small in-session plan until asked for agents, then ce-work it and ce-commit + beads task to mark it

/work-big lets implement this thing
will create beads, run plan agent, then run work agent, then verify it, then commit

or something in the line
/work-auto see we can do this...
will try to auto classify the work and where/how to make it

probably we may want to create special agents md that follow the rules and idea.


I'm giving a sample goal prompt, but I really want that stored so I just do like /work-continue (optionional epic beads id, or "last", or empty for the last we worked on:


goal Execute the master Beads epic through staged subagents.

Source of truth:
- Beads is the only task state.
- Git is the only code state.
- Chat memory is not source of truth.

Master epic: <EPIC_ID>

Loop:

1. Run:
   bd ready --json

2. Pick exactly one ready Bead belonging to or blocking <EPIC_ID>.

3. Run:
   bd show <id> --json

4. If the ready Bead is a planning/slice bead:
   Spawn subagent `ce-planner`.

   The planner must:
   - read the Bead
   - read the master epic
   - create the next 1–3 executable Beads if needed
   - add real `blocks` dependencies only
   - create decision Beads for uncertainty
   - not edit source code
   - close/update the planning Bead when durable Beads exist

5. If the ready Bead is an implementation Bead:
   Spawn subagent `ce-worker`.

   The worker must:
   - claim the Bead
   - read only relevant context
   - implement exactly that Bead
   - run the Bead’s verification commands
   - update the Bead with files changed and verification result
   - not commit unless explicitly assigned commit role

6. After worker returns:
   Spawn subagent `ce-reviewer`.

   The reviewer must:
   - be read-only
   - inspect git diff
   - inspect Bead acceptance criteria
   - inspect tests/verification result
   - report PASS or FAIL
   - if FAIL, create/update a fix Bead or leave exact fix instructions

7. If review fails:
   Spawn subagent `ce-fixer`.

   The fixer must:
   - fix only reviewer-identified issues
   - run verification again
   - update Beads
   - not expand scope

8. After PASS:
   Either commit in parent or spawn `bead-committer`.

   Commit rule:
   - git status/diff inspected
   - tests passed
   - Bead updated
   - commit message: "<bead-id>: <summary>"
   - close Bead only after commit exists

9. If new work is discovered:
   Create new Bead with discovered-from:<current bead>.
   Add blocks dependency only if it truly blocks current/future work.

10. Repeat until:
   - no ready Beads remain
   - human product/architecture decision needed
   - verification failure invalidates the plan
   - subagent fails twice
   - context budget is high