# Native deathmatch late-join evidence

Target: original `Karma.exe`, SHA-256 `aa824dda4d48c0304de3e9ab1c6012c542dc280eca93a6d507da9a21c4bbedab`. Runtime evidence is isolated `KarmaAIProbe.exe` using `tests/ai_unattended_shim.js`; no desktop input was sent and every spawned process reported input isolation. Native provider was previously unavailable (Ghidra absent); this pass reused saved REA findings and existing Capstone/PEfile/Frida tooling without installing providers.

## Observed native boundaries

- `0x44f8bf..0x44f8d1` allocates eight native actors through `0x44a3b0`, independently of the active roster. No actor allocation or pointer moves are needed when a player joins.
- `0x44fb30` configures an existing actor: manager, slot, team, model filename, actor type, display name, seven equipment bytes, loadout mode. Remote type is 6.
- `0x44f960` loads a missing character into an eight-entry model cache at manager `+0x48`. It chooses the first unused entry, then the supplied fallback index when full.
- `0x459ee0` populates model metadata at registry `+0x10+4*i` and matrix `+0x30+64*i`; per-slot texture/surface records are `+0x230+4*i` and `+0x258+4*i`. Reusing cached metadata avoids allocating another metadata object for each reconnect.
- Native slots for active players remain fixed. Departures clear roster presence and actor rendering/spawn/activity flags. A new participant reuses the first vacant remote slot. The engine count tracks the highest active slot; self remains native slot 0.

## Runtime results

Source fixture: `tests/native_dm_join_test.mjs`. Full machine-readable evidence: `tests/native-dm-join.jsonl`.

```json
[
  {
    "time": "2026-10-21T05:46:26.253Z",
    "event": "third-player-midmatch",
    "passed": true
  },
  {
    "time": "2026-10-21T05:46:35.047Z",
    "event": "native-slot-replacement",
    "passed": true
  },
  {
    "time": "2026-10-21T05:46:43.939Z",
    "event": "replacement-native-damage",
    "passed": true
  },
  {
    "time": "2026-10-21T05:46:51.809Z",
    "event": "reconnect-life-score-continuity",
    "passed": true,
    "initialLife": 2
  },
  {
    "time": "2026-10-21T05:46:52.240Z",
    "event": "last-player-remains-active",
    "passed": true
  },
  {
    "time": "2026-10-21T05:47:08.920Z",
    "event": "bounded-native-model-cache",
    "passed": true,
    "characters": 20,
    "rebindings": 40
  },
  {
    "time": "2026-10-21T05:47:10.869Z",
    "event": "full-native-model-cache-replacement",
    "passed": true
  },
  {
    "time": "2026-10-21T05:47:11.085Z",
    "event": "test-pass",
    "passed": true
  }
]
```

The fixture starts two original clients and scores a real native bullet kill. A third client joins the running server match with a distinct sniper model, selected rifle and lieutenant rank; all clients retain prior kills/deaths. Departure hides its actor; a heavy character takes that same native slot without moving the existing peer. The replacement can be killed by the original native hit/damage path. Reconnecting the dead account uses the server's new life number and preserves all scores. After other clients leave, one player continues the match.

The late entrant's initial snapshot establishes a shot sequence floor. Retained historical shots in later movement states do not replay; the runtime assertion observes zero remote shots until new firing. A unit regression separately proves the next shot replays exactly once.

The cache stress uses the actual original engine to configure all 20 shipped past-era character models twice (40 join/leave cycles). Every model name matches the configured actor, every revisited model reuses its exact native asset pointer, the retained model count stays at 20 or less, each departed actor stays inactive, and the process exits cleanly. A final check fills all eight native actor/model slots with distinct characters, removes a middle participant and loads another model. The other six remote slot/model/resource mappings and the local resource pointer remain unchanged. These simulated roster messages stress the native cache directly; the preceding three-client scenario exercises the real central server/transport contract.

## Scope and limits

This proves the native join/model/weapon/rank/damage/score path on the measured default battlefield. Factory/Rescue retain their existing native support; this pass did not repeat map-specific combat probes. The cache keeps at most the 20 supported character assets and corresponding metadata alive until the game process exits, so references in inactive actor instances remain valid. It does not claim zero memory overhead compared with a fixed two-player match. No native provider pseudocode was available, and the cache layout conclusions are based on exact original assembly plus the runtime stress above.

Regression commands passed: `node tests/lan_game_test.mjs`, `node tests/rank_display_test.mjs`, `node tests/central_transport_test.mjs`, `node tests/central_lobby_test.mjs`, and pickup agent's `node tests/manual_pickup_test.mjs`. Generated `lan-game.js` was rebuilt after the final pickup changes and syntax-checked.
