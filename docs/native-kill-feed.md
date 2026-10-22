# Confirmed kill notifications

The HUD consumes the `feed` attached to a server `death-confirmed` event,
deduplicated by the combat receipt ID. It never treats raw incoming hit/death
packets as a confirmed kill. Names come from authenticated server accounts and
weapon labels from the server catalog. Unknown/unverified causes show only the
victim's death; self-inflicted deaths have a separate label.

The server binds a victim's lethal HP proof to the existing attacker hit
evidence. `hitKind`/`hitRegion` come from that evidence, ignoring any client
headshot flag. Only a verified lethal bullet hit at native region 0 is marked
Headshot. Pellets and projectiles have no recoverable head region in the
current adapter, so they never get this label.

Original binary SHA-256:
`aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab`.
The region dispatch at `0x461d14` is
`00 01 02 03 03 03 03 03 03 03 03 03 03 03 03 00`.
Region 0 selects the 100-damage branch at `0x461b34`; the helmet handling at
`0x461ba6` checks actor `+0x1eec` for region 0 (or internal sentinel 15).
Original inventory configuration at `0x44ff63`/`0x44ff70` enables that field for
weapon 49, the catalog helmet. Region 1 instead uses body armor `+0x1ef4`.
The transmitted bullet range is 0–14; internal sentinel 15 cannot enter it.
The original localized HeadShot string also remains at `0x537cec`, message 3
of the dispatcher at `0x40fca0`. These are static Capstone observations using
PE address mapping; native REA providers were unavailable on this host.

The upper-right overlay shows the last five arrivals for seven seconds, using
the receiver's clock. It is DPI-aware, uses 12-pixel logical type, reserves
space for the headshot badge, and has WS_EX_NOACTIVATE / WS_EX_TRANSPARENT plus
HTTRANSPARENT / MA_NOACTIVATE responses. It never installs an input hook.
It follows the active game client rectangle and hides when the game loses
focus. Local kills are gold and local deaths red. State is bound to the game
PID and excluded from release packages by its `pause-` prefix.

Tests: real loopback server head/body/pellet/projectile deaths, spoofed flags,
authoritative names, duplicate and cross-room isolation; client bounded queue,
expiry/PID isolation, and passive WinForms styles. The original native hit
algorithm and damage implementation are unchanged.
