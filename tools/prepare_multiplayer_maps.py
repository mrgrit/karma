"""Build a reproducible map manifest and extend the native DM map list.

Uses original FSD spawn declarations, never invented landing coordinates.
Existing measured fixtures are retained. New maps start closed to ordinary users.
"""
import argparse,json,re,struct
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--game-root',type=Path,required=True);args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
archive=(args.game_root/'App_Executables/Data/World/fsd.kst').read_bytes()
count=struct.unpack_from('<I',archive,8)[0];entries=[]
for i in range(count):
 at=12+264*i;name=archive[at:at+256].split(b'\0')[0].decode('ascii');offset,size=struct.unpack_from('<II',archive,at+256)
 assert offset+size<=len(archive);entries.append([name,archive[offset:offset+size]])
sources={name.lower():data.decode('cp949') for name,data in entries}
catalog=json.loads((root/'client/Launcher/catalog.json').read_text(encoding='utf-8'))
manifest=root/'client/Launcher/multiplayer-maps.json';old=json.loads(manifest.read_text(encoding='utf-8'))
existing={m['id'].lower():m for m in old['maps']}
order=['NMP_sektor312','NMP_Flowerbed','NMP_training','NMP_laboratory','NMP_park','NMP_Castle','NMP_armedtrain','NMP_partisan','NMP_mirrorsniper','NMP_Baggage','NMP_petersburg','NMP_poland']
spawn=re.compile(r'\*SPAWN_(\w+)\s*:\s*secname\s*"([^"]+)"\s*angle\s*"([^"]+)"\s*position\s*"([^"]+)"\s*"([^"]+)"\s*"([^"]+)"',re.I)
def unique(points):
 seen=set();out=[]
 for p in points:
  key=(p['sectorName'],tuple(p['position']))
  if key not in seen:seen.add(key);out.append(p)
 return out
maps=[]
for item in catalog['maps']:
 if item['age']!=0 or item['id']=='NMP_Riflematch':continue
 mapindex=item['launchIndices'].get('0:1')
 if mapindex is None:mapindex={'NMP_sektor312':18,'NMP_mirrorsniper':19}[item['id']]
 groups={}
 for kind,sector,yaw,x,y,z in spawn.findall(sources[item['world'].lower()]):
  groups.setdefault(kind.upper(),[]).append({'sectorName':sector,'position':[float(x),float(y),float(z)],'yawDegrees':float(yaw)%360})
 axis=unique(groups.get('AXIS',[]));allies=unique(groups.get('ALLIES',[]))
 if mapindex==18:
  # The native sniper layout has two Axis positions. Two declared PVP points
  # on the same side supply distinct third/fourth seats; no offsets are guessed.
  axis=unique(axis+[p for p in groups.get('PVP',[]) if p['position'][0]>0])
 capacity=4 if mapindex==19 else 8
 teamcount=capacity//2
 assert len(axis)>=teamcount and len(allies)>=teamcount,(item['name'],'insufficient team spawns')
 dm=unique(groups.get('PERSONAL',[])+groups.get('PVP',[])+axis+allies)
 assert len(dm)>=capacity,(item['name'],'insufficient unique DM spawns')
 team=axis[:teamcount]+axis[:4-teamcount]+allies[:teamcount]+allies[:4-teamcount]
 current=existing.get(item['id'].lower())
 if current is None:
  current={'id':item['id'],'name':item['name'],'mapIndex':mapindex,'age':0,'nativeMode':1,'publicReady':False,
           'dmSpawns':dm[:capacity],'teamSpawns':team,'maxPlayers':capacity,'minClientBuild':'karma290-central6',
           'spawnSource':'original-fsd','validation':'원본 스폰 구조 검사 · 실전 확인 필요'}
 current['releaseOrder']=order.index(item['id'])+1 if item['id'] in order else 0
 current['sniperMap']=mapindex in (18,19)
 if mapindex==12:
  # The original PERSONAL point (5915,-400,-4446) is rejected by the
  # multiplayer placement routine. Use a declared, distinct ALLIES point.
  current['dmSpawns'][4]=groups['ALLIES'][4]
 maps.append(current)
maps.sort(key=lambda m:m['mapIndex'])
assert len(maps)==20 and len({m['mapIndex'] for m in maps})==20
manifest.write_text(json.dumps({'schemaVersion':1,'maps':maps},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root.parent/'karma_server/multiplayer-maps.json').write_bytes(manifest.read_bytes())
# Add only two DM entries at the end of the PAST list, preserving indices 0–17.
addition='\r\n'.join(f'*MAP_PAST : {21+i} "{name}.fsd"\r\n "{name}.bmp"\r\n "{title}"\r\n 0\r\n "single_death"\r\n "team_death"\r\n' for i,name,title in [(0,'NMP_sektor312','Enemy at the gate'),(1,'NMP_mirrorsniper','Honor')])
text=sources['maplist.dat'];assert '*MAP_PAST : 21' not in text,'Use the original archive as input'
at=text.index('*MAP_FUTURE');text=text[:at]+addition+'\r\n'+text[at:]
for e in entries:
 if e[0].lower()=='maplist.dat':e[1]=text.encode('cp949')
header=bytearray(archive[:12+264*count+4]);position=len(header)
for i,(_,data) in enumerate(entries):struct.pack_into('<II',header,12+264*i+256,position,len(data));position+=len(data)
struct.pack_into('<I',header,len(header)-4,position-len(header))
result=bytes(header)+b''.join(data for _,data in entries)
out=root/'client/GameData/fsd.kst';out.parent.mkdir(exist_ok=True);out.write_bytes(result)
print('Prepared',len(maps),'maps. Enemy at the gate: 8 seats; Honor: 4 seats; all new maps closed.')
