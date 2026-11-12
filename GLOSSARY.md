# ce-workflow

## Language

**Design session**:
a hub Pi session bound to one design handle (`design-N`) whose agent builds that one design.
_Avoid_: OD session, design run

**Design folder**:
`.pi/designs/<handle>/`, the working files of one design and the only place its session writes.
_Avoid_: mirror (v2 term, gone with OD)

**Bridge**:
the script the hub injects into a design page it serves. It handles comment picking, pins, live CSS edits, Tweaks and slide navigation over `postMessage`.
_Avoid_: overlay

**Comment line**:
one line in the chat box made by a click in Comment mode, naming the screen, the element and the note.

**Device preset**:
a named preview size (Phone small, Phone, Phone large, Foldable, Tablet, Laptop, Desktop, Slide), rotatable. Used by both the preview and `design look`.

**Version**:
a snapshot of the design folder after an agent turn that changed it, numbered from 1 per design.

**Reference**:
a captured site in `.pi/designs/references/<site>/` (screenshots plus `STYLE.md` of measured tokens).

**Cold-cache compaction**:
ce-workflow compacting a large session because its prompt cache has expired, so the next request would re-bill the whole prompt anyway.
_Avoid_: early compaction

**Idle cache warming**:
Pi re-sending the last prompt between runs, with a one-token output cap, to keep its cache alive.
_Avoid_: keep-alive
