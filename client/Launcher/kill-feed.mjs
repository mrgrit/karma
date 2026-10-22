// Only server-confirmed deaths enter the passive HUD. Time is local arrival
// time so an out-of-sync server clock cannot leave notifications stuck on screen.
export function addKillFeed(events,feed,now=Date.now()){
  if(!feed||typeof feed.id!=='string'||!feed.id||!['kill','self','death'].includes(feed.kind)||
     typeof feed.victimId!=='string'||typeof feed.victimName!=='string'||
     events.some(item=>item.id===feed.id))return false;
  const clean=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,80);
  events.push({id:feed.id,kind:feed.kind,killerId:clean(feed.killerId),victimId:feed.victimId,
    killerName:clean(feed.killerName),victimName:clean(feed.victimName),weaponName:clean(feed.weaponName),
    headshot:feed.kind==='kill'&&feed.headshot===true,receivedAt:now});
  if(events.length>80)events.splice(0,events.length-80);
  return true;
}
