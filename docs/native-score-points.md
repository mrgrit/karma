# Shift scoreboard Point bridge

## Observed original layout

The investigated original executable is `Karma.exe`, SHA-256
`aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab`.

The original free-for-all scoreboard at `0x4227d0` passes the following
zero-based arguments to its row renderer, `0x42f7d0`:

| Argument | Value |
| --- | --- |
| 0 | rank from `GM + 0xfc4 + 0x98 * slot` |
| 1 | actor name |
| 2 | kills from `GM + 0x1458 + 0x10 * slot` |
| 3 | deaths from `GM + 0x1460 + 0x10 * slot` (16 bits) |
| 4 | ping from `GM + 0x1464 + 0x10 * slot` |
| 5 | Point from `GM + 0xfc8 + 0x98 * slot`, minus 12345 |
| 6 | native player slot |

The Point load/subtraction is at `0x422836` / `0x422845`; the row call is at
`0x422879`. The Point number renderer call at `0x42f8f0` passes argument 5 to
`0x430260`. The team scoreboard at `0x422930` uses the same encoded Point
field for `0x42fa90` (`0x422aa5`, `0x422ab2`, `0x422ad4`). The word at
`GM + 0x145c` is **not** the Point field consumed by these renderers.

The existing adapter updated K/D alone. Its peer initialization also cleared
the profile record, leaving the encoded Point as zero instead of 12345.
Neither action updates a correct Point total. The original XP helper
`0x425be0` uses this profile field and ultimately dereferences the original
online-client global at `0x561850`; it must not be called by the LAN adapter.

REA reported no configured Ghidra, Hopper, IDA, or Kuna provider on this
Windows host. These addresses were independently checked with Capstone
5.0.9 against the hash above, using PE section-to-file mappings. This is
static disassembly evidence, not recovered original source or a claim that
the complete official XP formula has been reconstructed.

## Current department server policy

Point now displays **server-confirmed XP earned in this match**. The current
department rules award 25 XP for a verified kill and 5 XP for a death; they
are the existing department-server rules, not a recovered official Karma
formula. Account lifetime XP/rank and KARMA wallet coins are separate.
There is currently no separate match-completion XP bonus.

The server sends `match-snapshot.players[].points` after confirming scoring.
The native adapter writes that absolute total, plus 12345, to the display
field. It does not add points on raw peer death messages or duplicate
receipts. Initial and reused peer slots start at encoded zero. Snapshot
Point values must be integers between 0 and 1,000,000,000; an older snapshot
without the field preserves the last known total. Slot mapping uses player
IDs because the local player is native slot 0 on every machine.

## Verification

`node tests/lan_game_test.mjs` checks initialization, both local/peer field
locations, absolute/idempotent updates, invalid Point bounds, preservation
of rank and the unrelated `0x145c` word, and legacy snapshot compatibility.

With `KARMA_GAME_ROOT` set to an extracted game containing the Frida runtime,
`node tests/native_points_test.mjs` runs the original Factory engine with
the existing hidden-window/no-input unattended shim. It feeds confirmed
snapshots, then observes the original row renderer and numeric renderer
receiving 25/5 followed by 55/35 for the two players.

Because the test deliberately has no foreground input device, it selects
the original overlay's score-view argument in the probe. The row data and
number rendering paths remain native. This proves the actual Point
renderer receives fresh totals; it is not a screen-pixel assertion or a
claim that a user's physical Shift input was tested. The probe process is
terminated after the bounded test and its executable is restored.
