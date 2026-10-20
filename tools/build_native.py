from pathlib import Path
root=Path(__file__).resolve().parent.parent
core=(root/'native/lan_game_core.js').read_text(encoding='utf-8')
for marker,name in [('/*__TEST_DISPATCH__*/','ai_test_native_dispatch.js'),('/*__LOADOUT__*/','lan_loadout_game.js')]:
    assert core.count(marker)==1
    core=core.replace(marker,(root/'native'/name).read_text(encoding='utf-8-sig'))
output=root/'client/Launcher/lan-game.js'
output.write_text(core,encoding='utf-8')
print('Built',output.name,len(core.encode('utf-8')),'bytes')
