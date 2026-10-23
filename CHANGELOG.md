# Changelog

What changed in ce-workflow and its hub (pi-control-hub), newest first. One version covers both.

## Unreleased

### Fixed
- Desktop app 0.1.4: the big extra dot that covered the hub icons on the taskbar button now shows only when the app is pinned, where the icon itself can't change. There it carries the number of things waiting for you (questions and finished sessions you haven't opened).
- Desktop app 0.1.4: with two hubs, the status dots sit above and below the hub icons instead of on them (waiting and working below, finished above); with one hub the dots are a little bigger; with three or four hubs they are a little smaller.
- Each folder in the sidebar shows its uncommitted files under its name: added +n (green), not in git yet +n (light green), modified ~n and deleted ×n (red). The open session's folder also has Pull, Commit and Commit and push as icon buttons on the right of that line.
![Folder box with file counts](docs/changelog/0.1.71-git-files.png)
- A Pull latest button appears when origin has commits you don't have yet; the hub fetches in the background every 5 minutes. Pull latest, Commit and Commit and push each get a small icon (↓, ●, ↑).
![Pull latest, Commit and Commit and push with their icons](docs/changelog/0.1.71-git-pull.png)

## 0.1.70 — 2026-10-23

### Added
- Hub: the Claude 7d bar shows the next refills within 48 h as dotted lines at the level they bring. The usage window labels each line in grey with when it comes and the %, instead of the separate text lines and the → account line.
- Timers: a script timer can now check every 10 seconds, for example to wait for a program. Message timers still run at most once a minute.

### Changed
- Hub: in ⚙, Check now sits on the "Pi and extensions" heading, so the update list gets the full width.
![Check now on the heading](docs/changelog/0.1.70-check-now.png)
- Hub: ⚙ → Desktop app → Update works like the tray's Restart to update. It downloads the new build if needed and restarts a running app into it. The button no longer greys out once the build is downloaded.

### Fixed
- Desktop app 0.1.3: the taskbar button now shows your hubs' icons with their dots and follows icon changes. Since install added a Start Menu shortcut, Windows had drawn that shortcut's fixed PC icon instead.
- Desktop app 0.1.3: the window remembers whether it was maximized and opens that way next time.
- Hub (phone): a long plan name now ends in … and the step count (11/23) stays visible on the right.
![Plan line with step count](docs/changelog/0.1.70-mobile-plan-line.png)
- Hub: a long ask_user option wraps next to its checkbox instead of dropping below it and leaving the box alone on a line.
![Wrapped options](docs/changelog/0.1.70-wrapped-options.png)
- Hub: a message you already sent no longer comes back in the box after the app or the browser closes abruptly.

## 0.1.69 — 2026-10-23

### Fixed
- Hub: Update no longer opens a pile of npm windows. It runs hidden, and if it fails, the hub opens its log so you see why.
- Desktop app: the pinned release is now 0.1.2, so ⚙ → Update brings the live taskbar icon.

## 0.1.68 — 2026-10-23

### Fixed
- Desktop app 0.1.2: an unpinned taskbar button now shows the live icon, your hubs' icons with their dots. Before, it showed the app's fixed PC icon. A pinned button still shows the fixed icon plus one live dot, because Windows doesn't let a pinned button change.

## 0.1.67 — 2026-10-23

### Added
- Hub: ⚙ → Desktop app (Pi Hub) has a Start button, which reads Stop while the app runs. Start at login now shares a row with Uninstall.
![Desktop app row with Start/Stop](docs/changelog/0.1.67-desktop-app-start.png)

### Fixed
- Desktop app 0.1.1: adding, renaming and removing a tab now asks inside the tab strip. The old pop-up was cut off behind the hub page.

## 0.1.66 — 2026-10-23

### Fixed
- Hub: Install in ⚙ → Desktop app really works now; 0.1.65 shipped without the release pin.

## 0.1.65 — 2026-10-23

### Fixed
- Hub: Install in ⚙ → Desktop app works now; the first app release (0.1.0) is pinned.

## 0.1.64 — 2026-10-23

### Added
- Hub: a desktop app, Pi Hub, for Windows and Linux. Install it from ⚙ → Desktop app on this PC's hub page. It has one tab per hub (this PC, other PCs by their link). Its taskbar icon shows up to 4 hubs with their dots, and the tray shows the same dots even while the window is hidden. Updates arrive with ce-workflow updates; the tray offers Restart to update.
![Desktop app row in the hub settings](docs/changelog/0.1.64-desktop-app-row.png)
![The app's tab strip with two hubs](docs/changelog/0.1.64-desktop-app-tabs.png)
- Hub: Alt+= and Alt+- step the Think/Work bias, like in the terminal.
- Hub: the top bar shows a provider's 5h window next to its 7d one. Right-click a bar to hide it, or use the Top bar boxes in the provider's window. Hiding all of a provider's bars turns that provider off in the gear menu.
- Hub: in the Claude account window, Force use / Stop force marks one or more accounts to serve first (green in the terminal). Forced accounts get a green name and tint, and "Use" is now "Switch to".

### Changed
- Hub: a click outside the usage, devices, command and changelog windows closes them. Questions and approvals still stay open.
- Hub: in the Claude account window, each account's notes sit on its name line, so every row takes one line less.

### Fixed
- Hub: usage bars now show when Pi is installed with npm instead of Pi's own installer. GLM/Z.ai, Kimi and Copilot usage shows too (#5).
- Hub: a parked session keeps showing Research on when it was on.
- Hub: a session that finishes stays blue until you look at it, even when a page has it open in a background tab, a minimized app or on another device.

## 0.1.63 — 2026-10-22

### Changed
- Hub: an image path in a chat message shows its picture right under that line, not all together at the end of the message.
- Hub: the installed app's badge is now a number: how many sessions ask something or have finished work you haven't opened.

### Fixed
- Hub on Windows: the hourly update check no longer flashes console windows.
- Hub: tab and app icons are transparent again, with light ink on a dark tab bar (the iPhone home-screen icon keeps its white square).
- Hub on Linux/WSL: when the hub runs as a systemd service, Restart and Update from the gear (and pi-hub restart) work instead of killing themselves with the hub.

## 0.1.62 — 2026-10-22

### Added
- Hub: a run button's script can ask you things with no model turn. `pi-hub ask "Deploy where?" --option staging --option prod` shows the usual question form on the page (parked sessions too), waits for your answer and prints it; `pi-hub notice "Done"` shows a line on the page. Ask the agent to make such a button and it writes the script.
- Hub: a red ✕ on your last message removes it, and everything the agent did after it, from the context (a running agent stops first). Useful for a prompt sent by mistake.

![The ✕ on the last message](docs/changelog/0.1.62-remove-last-message.png)
- Hub: an installed hub app (taskbar, dock, home screen) shows a badge while a session asks something or has finished work you haven't opened.

### Fixed
- Hub on Windows: run buttons' commands lost their output, even `> file` redirects.

## 0.1.61 — 2026-10-22

### Added
- `/wo env` and the hub's **Env var** button: store a secret as an environment variable, for this session only or permanently (Windows and Linux). The value never reaches the model; the agent only learns the variable's name. The name is suggested from the agent's last message.

![The Env var button in the chat header](docs/changelog/0.1.61-env-var-button.png)
![The dialog it opens](docs/changelog/0.1.61-env-var-dialog.png)

- Hub: file paths in the chat (any file the agent names, like `docs/plans/x.md`) are bold green links once the hub finds the file. On this PC a click opens it with its app, Shift+click copies the full path, Ctrl+click opens its folder, and right-click shows all three. From another device a click offers **Download**, **Open** (in a new tab) or **Copy path**, for images anywhere, and for other files in the session's project, or in temp and Downloads when changed in the last 5 days. Programs and scripts are only shown in their folder, never started.

![Right-clicking a file link](docs/changelog/0.1.61-file-links.png)

- Hub: **Commit and push** asks for scoped tests, the full suite or no tests.
- Hub: **Install** it as an app (Chrome, Edge, Brave, Android: the install icon in the address bar). It opens in its own window, named after this PC, with the tab icon you picked. On iPhone, use Share → **Add to Home Screen**; it gets the same icon.
- This changelog: the version at the top of the hub settings opens it, and after an update **What's new** opens once with only the newer versions.

![The changelog window](docs/changelog/0.1.61-changelog-window.png)

### Changed
- Hub settings gear: a red dot (no number) now means only that ce-workflow itself has an update. Pi and other extension updates show as a fainter yellow count in the lower-left corner.

![Red dot for ce-workflow, yellow count for the rest](docs/changelog/0.1.61-update-badges.png)

- Hub: in research mode the Context bar fills up to the model's real context window, since research doesn't compact at 200k.
- Hub tab icon shows one dot per kind of activity across sessions instead of only the most urgent one: red asks a question, orange working, blue finished and not yet looked at. Dots are smaller and fill the lower-right, lower-left, then upper-right corner.

![Tab icon with one, two and three dots](docs/changelog/0.1.61-tab-icon-dots.png)

- Hub Thinking view keeps edit and write blocks visible, collapsed, so you can see what changed.

### Fixed
- Hub: the update count on the gear sits fully inside the button instead of being cut off.

![The update count on the gear](docs/changelog/0.1.61-update-badge.png)

## 0.1.60 — 2026-10-22

### Added
- Hub: **Commit** and **Commit and push** buttons in the chat header, shown only when git has something to commit.
- Hub: project commands, per-folder buttons that send a prompt or run a command line; agents add them with the `project_commands` tool.
- Hub: hourly Pi and extension update check, with a count on the gear and **Check now**.
- Hub: **Ctrl+F** chat search with highlighted hits, a count and first/previous/next/last; also in the phone drawer.
- `/wo review`: a reviewer from the other provider checks the changes since your last commit or review. Settings can review after a plan or before a commit.
- Hub: red **Delete session** in the session menu (the session file stays in Recents).
- Hub: usage can show % left or % used.
- Hub: on this PC, files copied in Explorer are linked instead of uploaded again.
- Hub: four more tab icons.

### Changed
- Hub settings are grouped (Sessions, Display, Usage bars, Tab icon, Pi and extensions) with aligned controls.
- Hub tab icon shows the session state as a corner dot.
- Hub chat links quoted paths with spaces and `file:///` image or Markdown links.
- Plan3 shape check flags open questions without Option lines.

### Fixed
- Hub context button shows Pi's estimate after compaction instead of `?`.
- Hub survives starting at login: it retries Tailscale serve until it is ready and runs Pi's launcher by full path.

## 0.1.59 — 2026-10-21

### Added
- Hub scheduler: one-off or repeating timers that send a message or run a script, which only wakes the agent when needed. Sessions show a countdown, and timers can be cancelled.
- Hub polls subscription usage itself, so usage shows with every session parked. The gear chooses the providers.
- Hub remembers each session's model and thinking level; you can change them while it is parked.
- Typing in a parked session resumes it.
- Hub desktop notifications for questions and finished sessions (on by default).
- Hub tab icons: people, balls and an eye.

### Changed
- The terminal subscription footer is gone; the hub shows usage.
- Hub tab icon fills its square, coloured by state, with no shovel default.
- Claude accounts show 5h and 7d on one line.
- Sending a message shows Working at once.
- Plan3 think/work bias is remembered per session.

### Fixed
- Hub page switches to New plan when the current plan finishes by itself.
- Hub messages compact a cold cache before sending.

## 0.1.58 — 2026-10-21

### Changed
- Intercom wakes parked sessions by folder and waits until they join.
- Compaction on a cold cache happens automatically, without asking.

## 0.1.57 — 2026-10-20

### Added
- Intercom reaches parked hub sessions.

### Changed
- herdr support removed.

## 0.1.56 — 2026-10-20

### Changed
- Plan3 resolve shows submitted answers as a readable question/answer list.
- Hub usage window closes with a top-right ×.
- Clicking a folder group opens its last visited (or working) session.

## 0.1.55 — 2026-10-20

### Added
- Hub themes (Pi, Nord, Solarized) with Auto/Light/Dark per device.
- Hub: drop or paste any file into the chat; it is uploaded and its path inserted.
- Hub: queued messages can be edited or cancelled before they reach the agent; Stop returns them.
- Hub: `/new` from the page.
- Hub: auto-park after 10 minutes by default, set in the gear menu; the sidebar shows when a session parks.
- Hub: per-PC tab icon (14 icons).
- Hub: right-click or long-press a session for its menu, with Copy folder path.
- Hub: New folder offers to create a missing folder.
- Hub: thinking level per session without a plan.

### Changed
- Hub context shows progress toward compaction; the plan bar fills its row.
- ask_user questions show as a question/answer exchange in every chat view; links in question titles are clickable.
- Hub Claude pool window uses bars.

## 0.1.54 — 2026-10-20

### Added
- Hub: one usage bar per provider with warnings, and a usage window with 5h/7d bars and the Claude account pool.
- Hub: running tools show an elapsed timer.
- Hub on WSL2 opens links in the Windows browser, prints signed links and can start at login through systemd.

### Changed
- Catch-up with Pi 1.3.0, pi-subagents 0.79.1, pi-intercom 0.17.1 and pi-lens 4.4.4.

### Fixed
- Hub plan bar names the plan picked in the menu instead of New plan.
- Hub sidebar: clicking the plan progress line selects its session.

## 0.1.53 — 2026-10-19

### Added
- Hub running tools show an elapsed counter.

### Fixed
- Hub survives a reboot, and pairing works from saved session links.

## 0.1.52 — 2026-10-19

### Changed
- Hub desktop: full-width top bar (plan on the left; model, context, usage, think and gear on the right), short 7d usage text, tinted folder boxes and a plan progress line in the sidebar.
- Hub phone: two-line drawer status, orange top bar while working, plan name under the session name.

### Fixed
- Hub retries saving on Windows when antivirus briefly holds the file.

## 0.1.51 — 2026-10-19

### Fixed
- `/wo herdr import` now matches sessions; `/wo hub` offers the import when herdr is installed.

## 0.1.50 — 2026-10-19

### Added
- Approve a waiting device from `/wo hub`.

### Fixed
- An empty hub starts a first session instead of showing a JSON error.

## 0.1.49 — 2026-10-19

### Added
- `/wo herdr import` brings herdr's Pi sessions into the hub, named after their tabs.
- Hub gear: Update Pi and extensions.
- Hub plan menu: Force finish.
- Hub: CPU and memory graphs beside the gear.
- Hub: unsent chat drafts survive session switches and reloads.

### Changed
- Hub chat starts expanded when a session has no diagrams; context shows tokens (120k/1m).
- Hub Thinking view joins thinking into one block; the live tool line names its target.

### Fixed
- Camera no longer errors when a session starts in the home folder.

## 0.1.48 — 2026-10-19

### Added
- The hub now lives in this repo; `/wo hub` installs, starts, opens and restarts it.
- Hub chat views: Full, Thinking and Compact.
- Vision model setting: None, Current model or a chosen model.

### Changed
- A message sent while the agent works steers it instead of queueing.

### Fixed
- Compact chat view no longer collapses to the last reply.

## 0.1.47 — 2026-10-18

### Added
- pi-control-hub: one web front door that starts, parks and resumes Pi sessions and serves them to your phone.
- Every prompt goes through ask_user, so the terminal, the web and the hub draw the same form; short Yes/No prompts are one line.

### Changed
- `/wo share` and the per-session web workspace are replaced by the hub.
- Hub chat: compact mode and a highlighted final reply.

## 0.1.46 — 2026-10-16

### Added
- Web chat renders Markdown: bold, italics, code, headings, tables and links.

## 0.1.45 — 2026-10-16

### Added
- Web tab icon shows working, asking or idle.
- Web chat links http(s) addresses.

### Fixed
- An agent can leave research mode that Plan3 turned on.

## 0.1.44 — 2026-10-15

### Added
- Delete plan for unfinished plans.

### Changed
- Diagram boxes stay where you drop them on the open canvas.
- Dragging a connection highlights its target.

### Fixed
- `/wo share` finds Tailscale when it is not on PATH.

## 0.1.43 — 2026-10-15

### Added
- Push to talk in the web chat (English and Bulgarian).
- Images in answers: paste or pick images in web prompts; Alt+V in terminal ask_user.
- Web images: any image on this PC opens in an in-page viewer, including paths in tool output.

### Fixed
- Phone keyboard no longer pushes the page off screen.

## 0.1.42 — 2026-10-15

### Added
- Architecture workspace: plan and product diagrams with an editing bar (boxes, groups, connections, colours), live chat and comments.
- `/wo share`: open a session from your phone over Tailscale, with device pairing.
- Web chat: Pi-style light/dark colours, edit diffs, image thumbnails, / command completion, research/night chips and running subagents.

## 0.1.41 — 2026-10-13

### Added
- Vision: per-model effort and an optional second vision model.

## 0.1.40 — 2026-10-13

### Added
- Plan3 think/work bias on Alt+= / Alt+-.

## 0.1.39 — 2026-10-12

### Added
- `process_image` takes up to 10 images per question and fits them to provider limits.
- Tool-result images become references instead of filling the context.

## 0.1.38 — 2026-10-12

### Changed
- The legacy workflow orchestration is removed; Plan3 and the utilities remain.

## 0.1.37 — 2026-10-12

### Changed
- Plan3 turns uncertain assumptions into open questions that `/plan3 resolve` picks up.

## 0.1.36 — 2026-10-12

### Changed
- Plan3 resolve offers the recommendation as an answer when a question has no options.

## 0.1.35 — 2026-10-12

### Changed
- `process_image` falls back to the current model when no vision model is set.

## 0.1.34 — 2026-10-12

### Changed
- Plan3 resolve offers prose option lists as choices.

## 0.1.33 — 2026-10-12

### Changed
- Compact before the next request when tool work outlived the prompt cache.

## 0.1.32 — 2026-10-11

### Changed
- Reading an image file goes to `process_image` when a vision model is set.

## 0.1.31 — 2026-10-11

### Changed
- Plan3 finish offers a review before compacting; every question has a comment row.

## 0.1.30 — 2026-10-11

### Changed
- Advisors run on a model from another family.

## 0.1.29 — 2026-10-11

### Added
- `generate_image` and `process_image` tools.

## 0.1.28 — 2026-10-11

### Fixed
- Camera image cleanup skips quietly when another session holds the storage.

## 0.1.27 — 2026-10-11

### Added
- `screen_read` browser and Android targets on Linux and macOS, with an adb fallback.

## 0.1.26 — 2026-10-11

### Added
- Camera tools: stills, crops, bursts and change/settled watches, with per-use consent and a red warning.

## 0.1.25 — 2026-10-10

### Changed
- Plan3 tags phases by judgment and records per-step replies, failures and models.

## 0.1.24 — 2026-10-10

### Added
- Plan3 requirements (Alt+A): steps wait while what they need is off.

## 0.1.23 — 2026-10-10

### Added
- Plan3 run statistics and [human] steps.

## 0.1.22 — 2026-10-10

### Fixed
- Plan3 execution starts cleanly after tagging.

## 0.1.21 — 2026-10-10

### Changed
- Plan3 tagging runs on its own; the footer shows the weekly reset time.

## 0.1.20 — 2026-10-10

### Added
- Plan3 [think]/[code] phase tags.

## 0.1.19 — 2026-10-10

### Fixed
- Plan3 detects any step heading as a phase.

## 0.1.18 — 2026-10-10

### Added
- `/wo settings` shows the ce-workflow version.

## 0.1.17 — 2026-10-10

### Added
- Plan3 per-plan model overrides and a review offer before work.

## 0.1.16 — 2026-10-10

### Changed
- Enter runs slash-command argument completions; Plan3 model rows use the scoped model picker.

## 0.1.15 — 2026-10-10

### Added
- Plan3 planning and coding models per phase.

## 0.1.14 — 2026-10-10

### Added
- Night mode (Alt+N, `/night`): work on a plan unattended.
- Research mode on Alt+R.

## 0.1.13 — 2026-10-09

### Added
- `screen_read` tool.

## 0.1.12 — 2026-10-09

### Changed
- Plan3 never stops execution for context size.

## 0.1.11 — 2026-10-09

### Changed
- Plan3 flags no-commit rules and runs the full suite at phase boundaries.

## 0.1.10 — 2026-10-09

### Added
- Plan3 execution defaults and local commits.

## 0.1.9 — 2026-10-09

### Changed
- Plan3 design hand-off size limit covered by tests.

## 0.1.8 — 2026-10-09

### Added
- Plan3 shape check with one repair turn.

## 0.1.7 — 2026-10-09

### Changed
- Plan3 optimize uses a model-independent check.

## 0.1.6 — 2026-10-09

### Changed
- Plan3 requires a one-line summary when a step is marked done.

## 0.1.5 — 2026-10-09

### Added
- Plan3 design workflows.

## 0.1.4 — 2026-10-08

### Added
- `/wo` subcommands for Plan3 and utilities.

## 0.1.3 — 2026-10-08

### Added
- Plan3 conversion and the frontend design skill.

## 0.1.2 — 2026-10-07

### Fixed
- Plan3 resolve opens its popup directly.

## 0.1.1 — 2026-10-07

### Added
- Plan3 file viewer and batched resolve answers.
