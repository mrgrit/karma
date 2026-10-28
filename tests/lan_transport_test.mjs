// Real TCP loopback integration tests. No game/UI or firewall changes.
import net from 'node:net';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createLanPeer, validateLanMessage, LAN_MAX_LINE_BYTES} from '../client/Launcher/lan-transport.mjs';

const peers = [], rawSockets = [];
const hostConfig = {map: 0, age: 0, character: {index: 2, camp: 0, model: 'cpom_020.chr', name: '호스트'}, settings: {build: 'karma290-lan1', mode: 1, friendlyFire: false}};
const guestConfig = {map: 7, age: 1, character: {index: 5, camp: 1, model: 'cpom_050.chr', name: '게스트'}, settings: {build: 'karma290-lan1', mode: 5}};
const state = (seq, overrides = {}) => ({
  type: 'state', version: 1, life: 1, seq, pos: [-3846 + seq, 400, -7446], yaw: 1.57, pitch: 0,
  sector: 4, weapon: 9, hp: 100, stance: 0, body: 5, weaponAnim: 13, eyeHeight: 300,
  paused: false, shotSequence: 0, ...overrides,
});
const hit = (id, seq) => ({type: 'hit', version: 1, life: 1, seq, victimLife: 1, kind: 'bullet', id, weapon: 9, region: 1, direction: [1, 0, 0], armorPierce: 0});
const shot = id => ({id, life: 1, weapon: 9, origin: [0, 700, 0], direction: [1, 0, 0], sector: 4, renderSector: 4, yaw: 0, pitch: 0});
assert.equal(validateLanMessage(state(1,{viewFov:.4})).viewFov,.4,'Scoped view passes to spectators');
for(const viewFov of [-1,0,.01,3,NaN,Infinity])assert.throws(()=>validateLanMessage(state(1,{viewFov})),/viewFov|finite/i);
async function eventually(predicate, label, timeout = 2500) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(`Timed out: ${label}`);
    await delay(10);
  }
}
async function peer(options) {
  const result = await createLanPeer(options);
  peers.push(result);
  return result;
}
async function raw(port) {
  const socket = net.createConnection({host: '127.0.0.1', port});
  rawSockets.push(socket);
  socket.on('error', () => {});
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return socket;
}
function nextLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => { socket.off('data', data); reject(new Error('No TCP reply')); }, 2000);
    function data(chunk) {
      buffer += chunk.toString('utf8');
      if (buffer.includes('\n')) {
        clearTimeout(timeout);
        socket.off('data', data);
        resolve(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))));
      }
    }
    socket.on('data', data);
  });
}
async function expectRejectedRaw(port, payload, expectedCode) {
  const socket = await raw(port);
  const reply = nextLine(socket);
  socket.write(payload);
  assert.equal((await reply).code, expectedCode);
  await eventually(() => socket.destroyed, 'invalid connection closed');
}
try {
  await assert.rejects(createLanPeer({role: 'host', host: '127.0.0.1', port: 0, code: '123456',
    config: {...hostConfig, settings: Object.fromEntries(Array.from({length: 10}, (_, i) => [`large${i}`, 'x'.repeat(2048)]))}}), /16 KiB/);
  const hostEvents = [], guestEvents = [], hostStatuses = [], guestStatuses = [];
  const host = await peer({role: 'host', host: '127.0.0.1', port: 0, code: '123456', config: hostConfig,
    onMessage: message => hostEvents.push(message), onStatus: status => hostStatuses.push(status)});
  assert.ok(host.port > 0);
  assert.equal(hostStatuses[0].status, 'listening');
  assert.equal(host.send(state(1)), false, 'No gameplay before handshake');
  const wrong = await peer({role: 'join', host: '127.0.0.1', port: host.port, code: '654321', config: guestConfig});
  await assert.rejects(wrong.ready, error => error.code === 'AUTH_FAILED');
  assert.equal(host.connected, false);
  assert.ok(hostStatuses.some(s => s.code === 'AUTH_FAILED' && s.recoverable));

  await expectRejectedRaw(host.port, '{broken json}\n', 'BAD_JSON');
  await expectRejectedRaw(host.port, Buffer.alloc(LAN_MAX_LINE_BYTES + 1, 65), 'LINE_TOO_LONG');
  await expectRejectedRaw(host.port, JSON.stringify({type: 'hello', version: 2, protocol: 2, role: 'join', code: '123456', config: guestConfig}) + '\n', 'BAD_HELLO');
  await expectRejectedRaw(host.port, JSON.stringify({type: 'hello', version: 1, protocol: 1, role: 'join', code: '123456',
    config: {...guestConfig, character: {...guestConfig.character, model: '../Karma.exe'}}}) + '\n', 'BAD_CONFIG');
  await expectRejectedRaw(host.port, JSON.stringify({type: 'hello', version: 1, protocol: 1, role: 'join', code: '123456',
    config: {...guestConfig, settings: {...guestConfig.settings, build: 'older-build'}}}) + '\n', 'BUILD_MISMATCH');

  const guest = await peer({role: 'join', host: '127.0.0.1', port: host.port, code: '123456', config: guestConfig,
    onMessage: message => guestEvents.push(message), onStatus: status => guestStatuses.push(status)});
  const [remoteGuest, remoteHost] = await Promise.all([host.ready, guest.ready]);
  assert.equal(host.connected, true);
  assert.equal(guest.connected, true);
  assert.deepEqual(remoteGuest.config.character, guestConfig.character);
  assert.deepEqual(remoteHost.config.character, hostConfig.character);
  assert.equal(remoteGuest.config.map, 0, 'Host sees its authoritative map');
  assert.equal(guest.effectiveConfig.map, 0);
  assert.equal(guest.effectiveConfig.age, 0);
  assert.deepEqual(guest.effectiveConfig.settings, hostConfig.settings);
  assert.deepEqual(guest.effectiveConfig.character, guestConfig.character);
  assert.equal(remoteHost.code, undefined, 'Public hello must not expose the connection code');
  const third = await peer({role: 'join', host: '127.0.0.1', port: host.port, code: '123456', config: guestConfig});
  await assert.rejects(third.ready, error => error.code === 'ROOM_FULL');

  for (let i = 1; i <= 20; i++) guest.send(state(i));
  await eventually(() => hostEvents.some(m => m.type === 'state' && m.seq === 20), 'latest state received');
  assert.equal(hostEvents.filter(m => m.type === 'state').length, 1, 'Burst snapshots must coalesce');
  guest.send(state(21));
  guest.send(hit('shot-one', 22));
  guest.send({type: 'death', life: 1, seq: 23, killer: 'remote', weapon: 9});
  guest.send({...state(24, {life: 2}), type: 'respawn'});
  guest.send({type: 'pause', paused: true});
  await eventually(() => hostEvents.some(m => m.type === 'pause'), 'reliable ordered events');
  assert.deepEqual(hostEvents.slice(1).map(m => m.type), ['state', 'hit', 'death', 'respawn', 'pause']);
  assert.deepEqual(hostEvents.slice(1, 5).map(m => m.seq), [21, 22, 23, 24]);
  host.send(hit(33, 1));
  await eventually(() => guestEvents.some(m => m.id === 33), 'bidirectional hit');

  const beforeShots = hostEvents.length;
  guest.send(state(30, {shotSequence: 1, shot: shot(1)}));
  guest.send(state(31, {shotSequence: 2, shot: shot(2)}));
  guest.send(state(32, {shotSequence: 3, shot: shot(3)}));
  await eventually(() => hostEvents.length >= beforeShots + 3, 'every shot-bearing state delivered');
  assert.deepEqual(hostEvents.slice(beforeShots, beforeShots + 3).map(m => m.shot.id), [1, 2, 3]);
  for (let i = 33; i < 40; i++) guest.send(state(i, {shotSequence: 3, shot: shot(3)}));
  await eventually(() => hostEvents.some(m => m.seq === 39), 'repeated-shot snapshot coalesced');
  assert.equal(hostEvents.slice(beforeShots).filter(m => m.seq >= 33).length, 1);

  assert.throws(() => guest.send(state(40, {pos: [Infinity, 0, 0]})), /Non-finite/);
  assert.throws(() => guest.send(state(40, {pos: [1, 2]})), /Invalid pos/);
  assert.throws(() => guest.send(state(40, {life: 0})), /Invalid life/);
  assert.throws(() => guest.send({type: 'execute', command: 'anything'}), /Unsupported/);
  assert.throws(() => validateLanMessage({...hit(1, 1), victimLife: -1}), /Invalid victimLife/);
  assert.throws(() => validateLanMessage({...hit(1, 1), region: 15}), /Invalid region/);
  assert.throws(() => validateLanMessage({...hit(1, 1), kind: 'pellets', count: 11}), /Invalid count/);
  assert.equal(validateLanMessage({type: 'death', life: 1, seq: 40, killer: 'environment', weapon: -1}).weapon, -1);
  assert.throws(() => validateLanMessage(JSON.parse('{"type":"pause","paused":true,"__proto__":{"polluted":true}}')), /Invalid JSON key/);

  guest.close();
  await eventually(() => hostStatuses.some(s => s.status === 'disconnected'), 'host disconnect cleanup');
  await eventually(() => guestStatuses.filter(s => s.status === 'disconnected').length === 1, 'one guest disconnect notification');
  assert.equal(host.connected, false);
  assert.equal(host.send(state(99)), false);
  assert.ok(hostEvents.some(m => m.type === 'leave'), 'Orderly close must deliver leave');
  const refused = await peer({role: 'join', host: '127.0.0.1', port: host.port, code: '123456', config: guestConfig});
  await assert.rejects(refused.ready);

  // A malformed gameplay packet after authentication closes the entire room.
  const badStatuses = [];
  const badHost = await peer({role: 'host', host: '127.0.0.1', port: 0, code: '012345', config: hostConfig,
    onStatus: s => badStatuses.push(s)});
  const badSocket = await raw(badHost.port);
  const welcome = nextLine(badSocket);
  badSocket.write(JSON.stringify({type: 'hello', version: 1, protocol: 1, role: 'join', code: '012345', config: guestConfig}) + '\n');
  assert.equal((await welcome).role, 'host');
  badSocket.write('{"type":"ready","version":1,"protocol":1}\n');
  await badHost.ready;
  const badReply = nextLine(badSocket);
  badSocket.write(JSON.stringify(state(1, {pos: [0, 1]})) + '\n');
  assert.equal((await badReply).code, 'BAD_MESSAGE');
  await eventually(() => badStatuses.some(s => s.status === 'disconnected'), 'malformed peer cleanup');
  assert.equal(badHost.connected, false);

  console.log('PASS: real loopback code/version/config/asset validation, two-player limit, authoritative room config, 20Hz latest snapshots, reliable shots/events, bidirectional exchange, invalid-line rejection, orderly close and disconnect cleanup.');
} finally {
  peers.forEach(p => p.close());
  rawSockets.forEach(s => s.destroy());
}
