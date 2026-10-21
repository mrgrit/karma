# Native account names and font size

Artifact: Karma290, SHA-256 `aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab`.
REA identified the artifact; native providers were unavailable. Existing local
PE/Capstone inspection and an isolated original-engine test supplied the details.

`420586` loads literal `KampGrupe` from `5399c0`. Self Mode copies it into
`GM+166`, the first of eight 256-byte roster name records. `44fb30` copies the
selected name into `actor+160`, a separate 256-byte field. `44fc70/44fc90` return
actor names. HUD initialization calls `42b980` with this name. Updating only the
remote roster leaves the local HUD/scoreboard showing the practice name.

`player-names.js` updates both records after `420560`, before HUD creation, using
the server-authoritative character name (or account profile in practice).
`WideCharToMultiByte(949)` preserves Korean names in the original ANSI renderer.
Late entrants use the same writer before native actor configuration.

Font constructors turn point sizes into pixels with `MulDiv(points,DPI,72)`.
The seven exact `GetDeviceCaps(LOGPIXELSY)` return addresses listed in
`native-font.js` are normalized to 96. All other device caps, callers, DPI APIs
and process awareness stay unchanged. Native failures are preserved.

`tests/native_names_font_test.mjs` creates an invisible `KarmaAIProbe.exe` with
no desktop input devices. At 192 DPI it verified Korean local/peer roster and
actor names, the HUD name cache, actual Shift/F1 query paths, and font heights
13/16 instead of 27/32. No production accounts or coins are used. Set
`KARMA_GAME_ROOT` to a complete extracted game to run this test; an optional
`KARMA_TEST_OUTPUT` selects its JSONL evidence path.
