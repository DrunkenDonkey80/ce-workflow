# pi-control-hub

One always-running hub for every Pi session on a PC. It starts each session itself as
`pi --mode rpc`, groups sessions by folder, parks and resumes them, and is the single
remote front door (one port, one `tailscale serve`, one device pairing).

Status: design. The plan is tracked in ce-workflow (the Plan3 tool only follows plans in the
folder its session runs in):
`C:\SOFT\git\ce-workflow\docs\plans\2026-10-18-pi-control-hub-rpc-session-host-with-one-web-front-door-0db155f7-plan3.md`

herdr is only used to open a session in a terminal on request.
