# Browser assets

- **Rough.js 4.6.6**, MIT (Preet Shihn): https://unpkg.com/roughjs@4.6.6/bundled/rough.esm.js. Vendored as `rough.ts` for the repository Extension File Rule, with only a leading `@ts-nocheck` comment; no runtime changes. Original SHA-256: `e921535f216ebc93d422489d614da955b5286812220b3149fc70978f4cb5bd45`. License: `rough-LICENSE.txt`.
- **Virgil**, unmodified font from https://github.com/excalidraw/virgil at commit `3d4c829dc85b455d4646631ac52bc1517df04217`. SIL Open Font License 1.1, Copyright Ellinor Rapp, reserved name Virgil. SHA-256: `9976295bfe709bdea64839a4d4e9a1d436dd6eb67538399a5a0e8b8fadbcf1cf`. License: `Virgil-LICENSE.md` (read and verified, not inferred from Excalifont).

Both assets are served locally behind the workspace token; there are no CDN requests from the browser. Update deliberately, retaining the licenses and checking the renderer under the strict CSP.
