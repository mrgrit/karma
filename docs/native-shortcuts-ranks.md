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

The original strings at `5389ac` through `53896c` and HUD rank arguments were
inspected. The native probe verified all five local HUD and scoreboard values;
the unit fixture verifies distinct remote roster ranks. Server lobby tests
verify that a client-supplied higher rank is discarded and the account rank is
sent in local and peer configuration. Remote ranks are the match-start snapshot;
the local rank also updates from server profile messages during the match.
