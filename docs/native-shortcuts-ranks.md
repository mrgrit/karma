# T shortcut and account ranks — 0.4.1

The supplied Karma290 executable has SHA-256
`aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab`.
The findings below were obtained with local PE/Capstone inspection and bounded
Frida tests. REA identified the artifact; its native decompiler was unavailable.

## T-key exit

`4197ff` queries DirectInput scan `14`. A held T passes `419808` and reads
`*(561850)+113e` at `419810`. The original online backend is null in our
standalone/LAN route. A hidden input-isolated original executable reproduced an
access violation at `419810`, reading `113e`, followed by process termination.
`Script is destroyed` is a secondary transport RPC error after that termination.

`legacy-controls.js` checks the exact bytes `74 40` at `419808` and changes them
to `eb 40`. Both T states now use the original key-up cleanup at `41984a`.
The retired premium shortcut is inactive. Keyboard and mouse polling, menu
controls and weapon bindings are unchanged. Unknown bytes fail initialization.

The same native probe exercised 58 held-T queries with the patch, released T,
and continued executing without an exception. The probe hid its window and
created no keyboard/mouse devices; it did not synthesize desktop input.

## Rank display

Self Mode writes literal rank 4 at `420ed2` to `GM+18d8`. HUD draw calls at
`416b9d` and `416f6c` read that value. Native scoreboard records use
`GM+b04+98*slot` and `GM+fc4+98*slot`. `rank-display.js` writes only these display
fields after the roster is initialized, then applies server promotions on the
game thread. It does not change health, damage, equipment budgets or stored XP.

| Server rank | Native ordinal |
|---|---:|
| recruit / 훈련병 | 0 |
| private / 이병 | 1 |
| corporal / 상병 | 3 |
| sergeant / 병장 | 4 |
| lieutenant / 소위 | 8 |
| first_lieutenant / 중위 | 9 |
| captain / 대위 | 10 |
| major / 소령 | 11 |
| lieutenant_colonel / 중령 | 12 |
| colonel / 대령 | 13 |
| brigadier_general / 준장 | 14 |
| major_general / 소장 | 15 |
| lieutenant_general / 중장 | 16 |
| general / 대장 | 17 |

The original strings at `5389ac` through `53896c` and HUD rank arguments were
inspected. The native probe verified all five local HUD and scoreboard values;
the unit fixture verifies distinct remote roster ranks. Server lobby tests
verify that a client-supplied higher rank is discarded and the account rank is
sent in local and peer configuration. Remote ranks are the match-start snapshot;
the local rank also updates from server profile messages during the match.

### Officer display evidence (2026-10-27)

The original executable above was identified again by REA as x86 PE with the
same SHA-256. `inspect_native_instruction` returned `provider_unavailable`;
the additional evidence below is **read-only local PE/Capstone inspection**, not
REA decompiler output or a new live-game test. No target process was launched.

The native rank-to-name routine at `4c1660` reads its ordinal argument, compares
it with `12` hex (18 decimal), and uses jump table `4c190c`. Each officer case
passes a string ID to `4106e0`, whose switch table is at `410994`. These actual
case entries establish the mapping; sequential strings alone were not used to
infer ordinals.

| Ordinal | Rank case | String ID | String VA | Text |
|---:|---|---:|---|---|
| 8 | `4c176e` | 70 | `53896c` | 소위 |
| 9 | `4c17a5` | 71 | `538964` | 중위 |
| 10 | `4c17ac` | 72 | `53895c` | 대위 |
| 11 | `4c17e3` | 73 | `538954` | 소령 |
| 12 | `4c17ea` | 74 | `53894c` | 중령 |
| 13 | `4c1821` | 75 | `538944` | 대령 |
| 14 | `4c1828` | 76 | `53893c` | 준장 |
| 15 | `4c185f` | 77 | `538934` | 소장 |
| 16 | `4c1863` | 78 | `53892c` | 중장 |
| 17 | `4c189a` | 79 | `538924` | 대장 |

HUD and scoreboard icons share renderer `42f160`. At `42f16d` it rejects
negative ordinals; `42f173` compares against `13` hex (19 decimal), and `42f176`
rejects values greater than or equal to 19. Only then does `42f17c` index
`renderer+b20+4*ordinal`; `42f185` also skips a missing icon. The initialization
loop at `42b4f9` selects this table, `42b50e` sets a 19-entry count, and
`42b5b7`–`42b5d4` fills it from the original `etc\\class\\` resources.

The local HUD forwards the rank through `479080` → `432b90` (call `47929e`)
→ `42f160` (call `432c60`). Scoreboard path `42286d` reads the roster rank and
calls `42f7d0`, which forwards it to `42f160` at `42f838`; the smaller scoreboard
path also calls the same renderer at `42f9c9`. Thus every added ordinal 9–17 is
inside the original draw and resource-table bounds. Native ordinal 18 is 원수;
it is intentionally not a supported server rank.

`node tests/rank_display_test.mjs` verifies all 14 supported account ranks in
the local HUD and both roster fields, queued promotion application, the eighth
player slot, and distinct peers. Unknown IDs fall back to recruit in peer
display and are rejected for local promotion RPCs. The test also restricts
native writes to the 17 established display fields and verifies that changing
rank alone does not increase an equipment budget. Officer thresholds, equipment
budgets and combat attributes are not implemented by this display mapping.
The newly added officer icons have static native support and VM fixture
coverage; they have not been visually retested in a running game in this change.
