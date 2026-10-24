// Original rank ordinals: recruit=0, private=1, corporal=3,
// sergeant=4, second lieutenant=8. These are display records only.
(() => {
  const rankIds = Object.freeze({recruit:0,private:1,corporal:3,sergeant:4,lieutenant:8});
  const cfg = globalThis.KARMA_LAN_CONFIG;
  let localRank = cfg?.local?.rank || globalThis.KARMA_ACCOUNT_PROFILE?.rank;
  let gm = null, dirty = false;
  const peerRanks = new Map((cfg?.peers || [cfg?.remoteHello]).filter(Boolean).map((p,i)=>[i+1,p.config?.rank]));
  const ordinal = rank => Object.prototype.hasOwnProperty.call(rankIds, rank?.id) ? rankIds[rank.id] : 0;
  function apply() {
    if (!gm) return;
    const records = Array.from({length:8},(_,i)=>i===0?localRank:peerRanks.get(i));
    for (let i = 0; i < Math.min(8, records.length); i++) {
      const value = ordinal(records[i]);
      gm.add(0xb04 + i * 0x98).writeS32(value);
      gm.add(0xfc4 + i * 0x98).writeS32(value);
    }
    // Self Mode overwrites this with 4 at 0x420ed2. The HUD reads it
    // each frame at 0x416b9d/0x416f6c; the scoreboard reads the records above.
    gm.add(0x18d8).writeS32(ordinal(localRank));
    dirty = false;
    send({event:'account-rank-applied',rank:localRank?.id || 'recruit',nativeRank:ordinal(localRank),
      roster:records.map(ordinal)});
  }
  globalThis.KARMA_SET_PEER_RANK = (index,rank) => {
    if (!Number.isInteger(index)||index<1||index>7) throw Error('Invalid native rank slot');
    peerRanks.set(index,rank);dirty=true;
  };
  Interceptor.attach(ptr('0x420560'), {
    onEnter(){this.gm = this.context.ecx;},
    onLeave(result){if (result.toInt32() !== 0) {gm = this.gm; apply();}}
  });
  Interceptor.attach(ptr('0x451380'), {onEnter(){if (dirty) apply();}});
  rpc.exports = Object.assign(rpc.exports || {}, {
    accountrank(rank,inventoryCapacity) {
      if (!Object.prototype.hasOwnProperty.call(rankIds, rank?.id)) throw Error('Invalid account rank');
      localRank = {id:rank.id}; dirty = true;
      if(cfg?.equipmentCatalog&&Number.isSafeInteger(inventoryCapacity)&&inventoryCapacity>=0&&inventoryCapacity<=200000)cfg.equipmentCatalog.inventoryCapacity=inventoryCapacity;
      return {queued:true};
    }
  });
})();
