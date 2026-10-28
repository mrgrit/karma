'use strict';
// LAN input menu, based on the verified single-player v8 helper.
// F10/T/Y release local input while native frames, combat and network continue.
// Escape opens an external exit confirmation. Menu commands and device changes run on the game thread.
const user32 = Process.getModuleByName('user32.dll');
const api = (name, ret, args) => new NativeFunction(user32.getExportByName(name), ret, args, 'stdcall');
// Must run while the game is suspended, before its first HWND is created.
// The 200% desktop scale previously fed exclusive DirectInput repeated
// screen-center offsets (+480,+270), forcing pitch to its lower view limit.
const dpiWindowApi = (() => {
  const optional = (name, ret, args) => {
    const address = user32.findExportByName(name);
    return address ? new NativeFunction(address, ret, args, 'stdcall') : null;
  };
  try {
    const getContext = optional('GetThreadDpiAwarenessContext', 'pointer', []);
    const getAwareness = optional('GetAwarenessFromDpiAwarenessContext', 'int', ['pointer']);
    const getSystemDpi = optional('GetDpiForSystem', 'uint', []);
    const getWindowDpi = optional('GetDpiForWindow', 'uint', ['pointer']);
    const getWindowContext = optional('GetWindowDpiAwarenessContext', 'pointer', ['pointer']);
    const metrics = optional('GetSystemMetrics', 'int', ['int']);
    const inspect = () => ({
      awareness: getContext && getAwareness ? getAwareness(getContext()) : null,
      systemDpi: getSystemDpi ? getSystemDpi() : null,
      screen: metrics ? [metrics(0), metrics(1)] : null
    });
    const before = inspect(), hwnd = ptr('0x548d50').readPointer(), attempts = [];
    if (hwnd.isNull()) {
      const modernAddress = user32.findExportByName('SetProcessDpiAwarenessContext');
      if (modernAddress) {
        // SystemFunction preserves the native GetLastError result alongside BOOL.
        const setModern = new SystemFunction(modernAddress, 'int', ['pointer'], 'stdcall');
        const result = setModern(ptr(-4)); // PER_MONITOR_AWARE_V2
        attempts.push({ api: 'SetProcessDpiAwarenessContext', context: -4,
          result: result.value, lastError: result.lastError });
      }
      // Legacy system awareness also removes virtualization on the main monitor.
      // Do not change a process mode that Windows reports as already aware.
      if (inspect().awareness === 0) {
        const legacyAddress = user32.findExportByName('SetProcessDPIAware');
        if (legacyAddress) {
          const result = new SystemFunction(legacyAddress, 'int', [], 'stdcall')();
          attempts.push({ api: 'SetProcessDPIAware', result: result.value,
            lastError: result.lastError });
        }
      }
    }
    send({ kind: 'dpi-process-setup', before, after: inspect(), attempts,
      beforeWindowDpi: hwnd.isNull() ? null : (getWindowDpi ? getWindowDpi(hwnd) : null),
      beforeWindowCreated: hwnd.isNull(), skipped: hwnd.isNull() ? null : 'window-already-created' });
    return { getWindowDpi, getWindowContext, getAwareness };
  } catch (error) {
    send({ kind: 'dpi-process-warning', message: String(error) });
    return null;
  }
})();
let dpiWindowReported = false;
function reportDpiWindow() {
  if (dpiWindowReported || !dpiWindowApi) return;
  const hwnd = ptr('0x548d50').readPointer();
  if (hwnd.isNull()) return;
  dpiWindowReported = true;
  try {
    const a = dpiWindowApi;
    send({ kind: 'dpi-window-ready', hwnd: hwnd.toString(),
      dpi: a.getWindowDpi ? a.getWindowDpi(hwnd) : null,
      awareness: a.getWindowContext && a.getAwareness ? a.getAwareness(a.getWindowContext(hwnd)) : null });
  } catch (error) { send({ kind: 'dpi-window-warning', message: String(error) }); }
}


const getKey = api('GetAsyncKeyState', 'int16', ['int']);
const foreground = api('GetForegroundWindow', 'pointer', []);
const activeWindow = api('GetActiveWindow', 'pointer', []);
const clip = api('ClipCursor', 'int', ['pointer']);
const showCursor = api('ShowCursor', 'int', ['int']);
const loadCursor = api('LoadCursorW', 'pointer', ['pointer', 'pointer']);
const setCursor = api('SetCursor', 'pointer', ['pointer']);
const arrowCursor = loadCursor(ptr(0), ptr(32512));
const quit = api('PostQuitMessage', 'void', ['int']);
const postMessage = api('PostMessageW', 'int', ['pointer', 'uint', 'pointer', 'pointer']);
const MENU_MESSAGE = 0x84a1;
let exitRequested = false, paused = false, resumePending = false, matchFinished = false;
let escapeDown = false, f10Down = false, chatAllDown = false, chatTeamDown = false;
// A high bit at startup/focus return is a held state, not a new key press.
// Each polling source must independently observe release before it can act.
const pollArmed = { 'async-key': [false, false, false, false], directinput: [false, false, false, false] };
const heldReported = new Set();
function resetHotkeyPolling() {
  for (const state of Object.values(pollArmed)) state.fill(false);
  heldReported.clear();
}
function polledPressAllowed(source, index, held) {
  const state = pollArmed[source];
  if (!state) return true; // A fresh targeted WM_KEYDOWN is an explicit edge.
  if (!held) { state[index] = true; return true; }
  if (state[index]) return true;
  const key = source + ':' + index;
  if (!heldReported.has(key)) {
    heldReported.add(key);
    send({ kind: 'hotkey-held-on-focus', source, key: ['Escape', 'F10', 'T', 'Y'][index] });
  }
  return false;
}
let lastForeground = false, cursorIncrements = 0, cursorReleased = false;
// Keep only shutdown-relevant window metadata, never the user's chat text.
// A peer's original client can quit outside our menu; retain its native caller
// so the next session log distinguishes that path from an explicit leave.
let lastLifecycleMessage = null;
const commands = [];
globalThis.KARMA_LOCAL_PAUSED = false;
globalThis.KARMA_LOCAL_INPUT_PAUSED = false;

// These pointers and callbacks must outlive every native call through them.
// The dispatcher gate is native code, so nested game Interceptors still run.
const retained = globalThis.KARMA_LOCAL_INPUT_NATIVE = {
  gatePage: Memory.alloc(Process.pageSize),
  flagPage: Memory.alloc(Process.pageSize),
  clockPage: Memory.alloc(Process.pageSize),
  clockState: Memory.alloc(16),
  listeners: [],
  callbacks: []
};
retained.flagPage.writeU8(0);
// LAN never pauses world simulation for a local menu or focus loss.
function updateGate() { retained.flagPage.writeU8(exitRequested || matchFinished ? 1 : 0); }
function guardBytes(address, expected, label) {
  const actual = new Uint8Array(address.readByteArray(expected.length));
  if (expected.some((value, i) => actual[i] !== value)) {
    throw new Error('Unsupported ' + label);
  }
}
const dispatcherCall = ptr('0x437f0c');
guardBytes(dispatcherCall, [0xe8, 0x4f, 0x27, 0xfe, 0xff], 'game dispatcher call');
const inactiveFocusAddress = ptr('0x436d01');
guardBytes(inactiveFocusAddress, [0x56, 0xff, 0x15, 0x78, 0xc2, 0x52, 0x00],
  'inactive-window focus handler');

function little32(value) {
  value >>>= 0;
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}
// Freeze only the game's imported timeGetTime clock. Windows and renderer
// DLLs keep their own clocks. Every timestamp operation executes as uint32
// native arithmetic: the game's x87 24-bit mode can round large JS numbers.
const gameClockSlot = ptr('0x52c36c');
retained.originalClock = gameClockSlot.readPointer();
retained.clockState.writeByteArray(Array(16).fill(0));
const clockState = retained.clockState.toUInt32();
const originalClock = retained.originalClock.toUInt32();
// clockState: byte paused at +0, uint32 pauseStarted at +4, totalPaused at +8.
// cmp [paused],0; jne frozen; call rawClock; sub eax,[totalPaused]; ret;
// frozen: mov eax,[pauseStarted]; sub eax,[totalPaused]; ret.
const clockCode = [0x80, 0x3d, ...little32(clockState), 0, 0x75, 0x0e,
  0xb8, ...little32(originalClock), 0xff, 0xd0,
  0x2b, 0x05, ...little32(clockState + 8), 0xc3,
  0xa1, ...little32(clockState + 4),
  0x2b, 0x05, ...little32(clockState + 8), 0xc3];
// Native pause: call rawClock; store pauseStarted; set paused; ret.
const pauseCode = [0xb8, ...little32(originalClock), 0xff, 0xd0,
  0xa3, ...little32(clockState + 4),
  0xc6, 0x05, ...little32(clockState), 1, 0xc3];
// Native resume: elapsed=rawClock-pauseStarted; totalPaused+=elapsed;
// clear paused; ret. Wraparound is intentionally modulo 2^32.
const resumeCode = [0xb8, ...little32(originalClock), 0xff, 0xd0,
  0x2b, 0x05, ...little32(clockState + 4),
  0x01, 0x05, ...little32(clockState + 8),
  0xc6, 0x05, ...little32(clockState), 0, 0xc3];
Memory.protect(retained.clockPage, Process.pageSize, 'rwx');
retained.clockPage.writeByteArray(clockCode);
retained.clockPage.add(64).writeByteArray(pauseCode);
retained.clockPage.add(96).writeByteArray(resumeCode);
Memory.protect(retained.clockPage, Process.pageSize, 'r-x');
retained.pauseClock = new NativeFunction(retained.clockPage.add(64), 'void', [], 'stdcall');
retained.resumeClock = new NativeFunction(retained.clockPage.add(96), 'void', [], 'stdcall');
const clockRange = Process.findRangeByAddress(gameClockSlot);
Memory.protect(gameClockSlot, Process.pointerSize, 'rw-');
gameClockSlot.writePointer(retained.clockPage);
if (clockRange) Memory.protect(gameClockSlot, Process.pointerSize, clockRange.protection);

function getInput() {
  const game = ptr('0x548d5c').readPointer();
  return game.isNull() ? ptr(0) : game.add(0x120).readPointer();
}
function devices(acquire) {
  if (acquire && (exitRequested || paused)) return;
  try {
    const input = getInput();
    if (input.isNull()) return;
    for (const offset of [4, 8]) {
      const device = input.add(offset).readPointer();
      if (device.isNull()) continue;
      const address = device.readPointer().add((acquire ? 7 : 8) * 4).readPointer();
      new NativeFunction(address, 'int', ['pointer'], 'stdcall')(device);
    }
  } catch (error) { send({ kind: 'input-release-warning', message: String(error) }); }
}
function showArrow() { if (!arrowCursor.isNull()) setCursor(arrowCursor); }
function releaseInput() {
  globalThis.KARMA_LOCAL_INPUT_PAUSED = true;
  if (!cursorReleased) {
    cursorReleased = true;
    devices(false);
    clip(ptr(0));
    cursorIncrements = 0;
    for (let i = 0; i < 32; i++) {
      const count = showCursor(1);
      cursorIncrements++;
      if (count >= 0) break;
    }
    send({ kind: 'input-released', cursorIncrements });
  }
  showArrow();
}
function restoreInput() {
  if (exitRequested || paused) return;
  while (cursorIncrements > 0) {
    showCursor(0);
    cursorIncrements--;
  }
  cursorReleased = false;
  devices(true);
  globalThis.KARMA_LOCAL_INPUT_PAUSED = false;
}
const zeroKeyboard = Array(256).fill(0);
const zeroMouse = Array(20).fill(0);
function clearInputBuffers(input) {
  if (input.isNull()) return;
  input.add(0x40).writeByteArray(zeroKeyboard);
  input.add(0x4e0).writeByteArray(zeroMouse);
}
function pauseChanged(value) {
  globalThis.KARMA_LOCAL_INPUT_PAUSED = value;
  globalThis.KARMA_LOCAL_PAUSED = false;
  // Do not notify AI/practice world-pause callbacks: the match keeps running.
}
function inputUnavailable() {
  if (exitRequested || paused || cursorReleased) return true;
  const hwnd = ptr('0x548d50').readPointer();
  return hwnd.isNull() || !foreground().equals(hwnd);
}
function requestPause(source, confirmExit = false, chatChannel = null) {
  if (exitRequested || matchFinished || paused) return false;
  // Keep the native game clock running during the LAN input menu.
  paused = true;
  resumePending = false;
  updateGate();
  pauseChanged(true);
  lastForeground = false;
  try { releaseInput(); }
  catch (error) { send({ kind: 'pause-release-warning', message: String(error) }); }
  try { clearInputBuffers(getInput()); }
  catch (error) { send({ kind: 'pause-clear-warning', message: String(error) }); }
  send({ kind: chatChannel ? 'chat-requested' : 'pause-requested', source,
    ...(chatChannel ? {channel: chatChannel} : {confirmExit}), inputOnly: true, worldContinues: true,
    hwnd: ptr('0x548d50').readPointer().toString(), pid: Process.id });
  return true;
}
function resumePause(source) {
  if (exitRequested || matchFinished || !paused) return false;
  const hwnd = ptr('0x548d50').readPointer();
  if (hwnd.isNull() || !foreground().equals(hwnd)) {
    if (!resumePending) send({ kind: 'pause-resume-pending', source, reason: 'game-not-foreground' });
    resumePending = true;
    return false;
  }
  resumePending = false;
  // No paused duration is subtracted from the LAN game clock.
  paused = false;
  updateGate();
  pauseChanged(false);
  // Do not interpret the key that closed the external menu as a new press.
  resetHotkeyPolling();
  escapeDown = escapeDown || (getKey(0x1b) & 0x8000) !== 0;
  f10Down = f10Down || (getKey(0x79) & 0x8000) !== 0;
  chatAllDown = chatAllDown || ((getKey(0x54) | getKey(0x0d)) & 0x8000) !== 0;
  chatTeamDown = chatTeamDown || (getKey(0x59) & 0x8000) !== 0;
  clearInputBuffers(getInput());
  restoreInput();
  lastForeground = true;
  send({ kind: 'pause-resumed', source, inputOnly: true, worldContinues: true });
  return true;
}
function showResults() {
  if (exitRequested || matchFinished) return false;
  matchFinished = true;
  paused = true;
  resumePending = false;
  updateGate();
  retained.pauseClock();
  globalThis.KARMA_LOCAL_PAUSED = true;
  releaseInput();
  clearInputBuffers(getInput());
  send({ kind: 'results-ready', hwnd: ptr('0x548d50').readPointer().toString(), pid: Process.id });
  return true;
}
function latchExit(source, nativeOrigin = null) {
  if (exitRequested) return false;
  const inputState = { paused, matchFinished, resumePending, cursorReleased,
    foreground: foreground().toString() };
  exitRequested = true;
  resumePending = false;
  escapeDown = true;
  f10Down = true;
  chatAllDown = true;
  chatTeamDown = true;
  lastForeground = false;
  updateGate();
  try { releaseInput(); }
  catch (error) { send({ kind: 'exit-release-warning', message: String(error) }); }
  try { clearInputBuffers(getInput()); }
  catch (error) { send({ kind: 'exit-clear-warning', message: String(error) }); }
  send({ kind: 'exit-requested', source, confirmation: source === 'external-menu',
    inputState, nativeOrigin });
  return true;
}
function requestExit(source) {
  if (!latchExit(source)) return false;
  quit(0);
  return true;
}
// Direct API is for game-thread hooks, such as practice completion.
globalThis.KARMA_LOCAL_REQUEST_EXIT = requestExit;
retained.listeners.push(Interceptor.attach(user32.getExportByName('PostQuitMessage'), {
  onEnter() {
    latchExit('native-quit', {
      caller: this.returnAddress ? this.returnAddress.toString() : null,
      windowMessage: lastLifecycleMessage
    });
  }
}));

// RPC runs on Frida's thread. Wake the game's message loop, then execute all
// cursor/device/quit operations in WndProc or the native dispatcher hook.
function menuCommand(command) {
  if (!['resume', 'quit', 'pause', 'results'].includes(command)) throw new Error('Unknown menu command');
  if (exitRequested) return { queued: false, exiting: true };
  commands.push(command);
  const hwnd = ptr('0x548d50').readPointer();
  if (!hwnd.isNull()) postMessage(hwnd, MENU_MESSAGE, ptr(0), ptr(0));
  return { queued: true, paused };
}
globalThis.KARMA_LOCAL_MENU_COMMAND = menuCommand;
rpc.exports = Object.assign(rpc.exports || {}, { menucommand: menuCommand });
function drainCommands() {
  while (commands.length && !exitRequested) {
    const command = commands.shift();
    if (command === 'quit') requestExit('external-menu');
    else if (command === 'results') showResults();
    else if (command === 'pause') requestPause('external-menu');
    else resumePause('external-menu');
  }
  if (resumePending && !exitRequested) resumePause('foreground-return');
}
function hotkeys(source, escape, f10, chatAll, chatTeam) {
  if (exitRequested || matchFinished) return;
  const allowEscape = escape === undefined ? false : polledPressAllowed(source, 0, escape);
  const allowF10 = f10 === undefined ? false : polledPressAllowed(source, 1, f10);
  const allowChatAll = chatAll === undefined ? false : polledPressAllowed(source, 2, chatAll);
  const allowChatTeam = chatTeam === undefined ? false : polledPressAllowed(source, 3, chatTeam);
  const newEscape = escape && !escapeDown && allowEscape;
  const newF10 = f10 && !f10Down && allowF10;
  const newChatAll = chatAll && !chatAllDown && allowChatAll;
  const newChatTeam = chatTeam && !chatTeamDown && allowChatTeam;
  if (escape !== undefined) escapeDown = escape;
  if (f10 !== undefined) f10Down = f10;
  if (chatAll !== undefined) chatAllDown = chatAll;
  if (chatTeam !== undefined) chatTeamDown = chatTeam;
  if (newEscape && !paused) requestPause(source, true);
  // The external menu owns resume. A delayed WM_KEYDOWN can follow an
  // async press and release (notably over RDP); it must not reopen input
  // while the menu is still visible.
  else if (newF10 && !paused) requestPause(source);
  else if (newChatAll && !paused) requestPause(source, false, 'all');
  else if (newChatTeam && !paused && globalThis.KARMA_LAN_CONFIG?.match?.mode === 'tdm') requestPause(source, false, 'team');
}
function serviceFrame() {
  reportDpiWindow();
  drainCommands();
  if (exitRequested) return;
  const hwnd = ptr('0x548d50').readPointer(), fg = foreground();
  const active = !hwnd.isNull() && fg.equals(hwnd);
  if (!active) {
    if (!cursorReleased) releaseInput();
    lastForeground = false;
    resetHotkeyPolling();
    if (!paused) { escapeDown = false; f10Down = false; chatAllDown = false; chatTeamDown = false; }
    return;
  }
  hotkeys('async-key', (getKey(0x1b) & 0x8000) !== 0, (getKey(0x79) & 0x8000) !== 0,
    ((getKey(0x54) | getKey(0x0d)) & 0x8000) !== 0, (getKey(0x59) & 0x8000) !== 0);
  if (exitRequested || paused) return;
  if (!lastForeground) {
    if (cursorReleased) restoreInput();
    else { devices(false); devices(true); }
    send({ kind: 'input-reacquired', reason: 'foreground-enter' });
  }
  lastForeground = true;
}

// Remove only the old inactive handler's SetFocus(game) push/call pair.
Memory.patchCode(inactiveFocusAddress, 7,
  code => code.writeByteArray([0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90]));
retained.listeners.push(Interceptor.attach(ptr('0x436c50'), {
  onEnter(args) {
    this.message = args[1].toInt32();
    const param = args[2].toInt32();
    const hwnd = ptr('0x548d50').readPointer();
    if (!hwnd.isNull() && args[0].equals(hwnd) &&
        ([0x02, 0x10, 0x82].includes(this.message) ||
          this.message === 0x112 && (param & 0xfff0) === 0xf060 ||
          this.message >= 0x400 && this.message < 0x500)) {
      lastLifecycleMessage = { message: this.message, param, at: Date.now() };
    }
    const keyDown = this.message === 0x100 || this.message === 0x104;
    const keyUp = this.message === 0x101 || this.message === 0x105;
    if ((keyDown || keyUp) && [0x1b, 0x79, 0x54, 0x59, 0x0d].includes(param)) {
      const hwnd = ptr('0x548d50').readPointer();
      if (!hwnd.isNull() && args[0].equals(hwnd)) {
        // Consume both edges before the original online/menu handler sees
        // them. Window messages retain short presses missed between frames.
        args[1] = ptr(0); // WM_NULL
        if (keyUp) {
          if (param === 0x1b) escapeDown = false;
          else if (param === 0x79) f10Down = false;
          else if ((param === 0x54 || param === 0x0d)) chatAllDown = false;
          else chatTeamDown = false;
        } else if (!exitRequested && foreground().equals(hwnd)) {
          const repeat = (args[3].toUInt32() & 0x40000000) !== 0;
          if (repeat) {
            // Do not let a following async/DI poll turn this repeat into a
            // new edge. Only a release can rearm the key.
            if (param === 0x1b) escapeDown = true;
            else if (param === 0x79) f10Down = true;
            else if ((param === 0x54 || param === 0x0d)) chatAllDown = true;
            else chatTeamDown = true;
          } else {
            hotkeys('window-key', param === 0x1b ? true : undefined,
              param === 0x79 ? true : undefined,
              (param === 0x54 || param === 0x0d) ? true : undefined, param === 0x59 ? true : undefined);
          }
        }
      }
    }
    // TranslateMessage may already have queued a character for a consumed T/Y
    // edge. Never pass it into the original online chat handler. External chat
    // typing belongs to its own HWND; queued game key/character messages are
    // discarded while local input is released.
    const character = [0x102, 0x103, 0x106, 0x107].includes(this.message);
    if ((keyDown || keyUp || character) && args[0].equals(ptr('0x548d50').readPointer()) &&
        (paused || matchFinished || character && [0x54, 0x74, 0x59, 0x79, 0x0d].includes(param))) args[1] = ptr(0);
    if (this.message === MENU_MESSAGE) drainCommands();
    const inactive = (this.message === 0x06 && (param & 0xffff) === 0) ||
      (this.message === 0x1c && param === 0);
    if (inactive) {
      lastForeground = false;
      resetHotkeyPolling();
      if (!paused && !exitRequested) { escapeDown = false; f10Down = false; chatAllDown = false; chatTeamDown = false; }
      try { releaseInput(); }
      catch (error) { send({ kind: 'focus-release-warning', message: String(error) }); }
    }
  },
  onLeave(result) {
    if (this.message === 0x20 && cursorReleased) {
      showArrow();
      result.replace(1);
    }
  }
}));
// Some legacy DirectInput keyboard instances report S_OK but an entirely
// empty state while Win32 reports physical keys held. Supplement only that
// observed case, only for this game's configured controls, while foreground.
const keyboardFallback = (() => {
  try {
    const mapKey = api('MapVirtualKeyExW', 'uint', ['uint', 'uint', 'pointer']);
    const getLayout = api('GetKeyboardLayout', 'pointer', ['uint']);
    // Default config.cfg bindings. Esc/F10 retain the separate menu path.
    const scans = [0x11, 0x1f, 0x1e, 0x20, 0x39, 0x2a, 0x2d, 0x2e,
      0xcb, 0xcd, 0x12, 0x13, 0x1b, 0x1a, 0x02, 0x03, 0x04, 0x05,
      0x06, 0x07, 0x08, 0x21, 0x10, 0xc8, 0xd0, 0xcf, 0x18, 0x0f];
    let layoutKey = '', mapping = [], frames = 0, lastReport = 0;
    return function supplement(input) {
      if (inputUnavailable()) return;
      const hwnd = ptr('0x548d50').readPointer();
      if (hwnd.isNull() || !foreground().equals(hwnd)) return;
      if (input.add(4).readPointer().isNull()) return;
      const state = input.add(0x40);
      for (let i = 0; i < 256; i++) {
        if ((state.add(i).readU8() & 0x80) !== 0) return;
      }
      const layout = getLayout(0), key = layout.toString();
      if (key !== layoutKey) {
        mapping = scans.map(scan => {
          const code = (scan & 0x80) ? (0xe000 | (scan & 0x7f)) : scan;
          return [scan, mapKey(code, 3, layout)]; // MAPVK_VSC_TO_VK_EX
        }).filter(pair => pair[1] !== 0);
        layoutKey = key;
      }
      const held = [];
      for (const [scan, virtualKey] of mapping) {
        if ((getKey(virtualKey) & 0x8000) !== 0) {
          state.add(scan).writeU8(0x80);
          held.push(scan);
        }
      }
      if (held.length !== 0) {
        frames++;
        const now = Date.now();
        if (lastReport === 0 || now - lastReport >= 5000) {
          send({ kind: 'keyboard-empty-state-recovered', frames, scans: held });
          lastReport = now;
        }
      }
    };
  } catch (error) {
    send({ kind: 'keyboard-fallback-warning', message: String(error) });
    return () => {};
  }
})();



// Poll replacements only wrap the small input functions. The full game
// dispatcher below never calls native gameplay from a JS replacement.
const keyboardPollAddress = ptr('0x4a81c0');
const mousePollAddress = ptr('0x4a8220');
const nativeKeyboardPoll = new NativeFunction(keyboardPollAddress, 'int', ['pointer'], 'thiscall');
const nativeMousePoll = new NativeFunction(mousePollAddress, 'int', ['pointer'], 'thiscall');
retained.keyboardCallback = new NativeCallback(function (input) {
  if (inputUnavailable()) { clearInputBuffers(input); return 0; }
  const result = nativeKeyboardPoll(input);
  if (result < 0 || input.isNull()) return result;
  keyboardFallback(input);
  const escape = input.add(0x40 + 0x01), f10 = input.add(0x40 + 0x44);
  const chatAll = input.add(0x40 + 0x14), chatTeam = input.add(0x40 + 0x15);
  const escapeHeld = (escape.readU8() & 0x80) !== 0;
  const f10Held = (f10.readU8() & 0x80) !== 0;
  const chatAllHeld = ((chatAll.readU8() | input.add(0x40 + 0x1c).readU8()) & 0x80) !== 0;
  const chatTeamHeld = (chatTeam.readU8() & 0x80) !== 0;
  escape.writeU8(0);
  f10.writeU8(0);
  chatAll.writeU8(0);input.add(0x40 + 0x1c).writeU8(0);
  chatTeam.writeU8(0);
  const hwnd = ptr('0x548d50').readPointer();
  if (!hwnd.isNull() && foreground().equals(hwnd)) {
    hotkeys('directinput', escapeHeld || (getKey(0x1b) & 0x8000) !== 0,
      f10Held || (getKey(0x79) & 0x8000) !== 0,
      chatAllHeld || ((getKey(0x54) | getKey(0x0d)) & 0x8000) !== 0,
      chatTeamHeld || (getKey(0x59) & 0x8000) !== 0);
  }
  if (inputUnavailable()) clearInputBuffers(input);
  return result;
}, 'int', ['pointer'], 'thiscall');
let mouseRemote=false;
try{mouseRemote=api('GetSystemMetrics','int',['int'])(0x1000)!==0;}catch{}
const mouseOptions=globalThis.KARMA_INPUT_SETTINGS||{};
const remoteInput=typeof mouseOptions.remoteMode==='boolean'?mouseOptions.remoteMode:mouseRemote;
const mouseScale=Number.isFinite(mouseOptions.sensitivity)?Math.max(.05,Math.min(2,mouseOptions.sensitivity)):(remoteInput?.25:1);
let mouseReset=true,mouseRemainder=[0,0];
retained.mouseCallback = new NativeCallback(function (input) {
  if (inputUnavailable()) {
    mouseReset=true;mouseRemainder=[0,0];
    if (!input.isNull()) input.add(0x4e0).writeByteArray(zeroMouse);
    return 0;
  }
  const result=nativeMousePoll(input);
  if(result<0||input.isNull())return result;
  for(let axis=0;axis<2;axis++){
    const field=input.add(0x4e0+axis*4),raw=field.readS32();
    if(mouseReset||remoteInput&&Math.abs(raw)>500){field.writeS32(0);mouseRemainder[axis]=0;continue;}
    const scaled=raw*mouseScale+mouseRemainder[axis],whole=Math.trunc(scaled);
    field.writeS32(whole);mouseRemainder[axis]=scaled-whole;
  }
  mouseReset=false;return result;
}, 'int', ['pointer'], 'thiscall');
Interceptor.replace(keyboardPollAddress, retained.keyboardCallback);
Interceptor.replace(mousePollAddress, retained.mouseCallback);

const gate = retained.gatePage, gateAddress = gate.toUInt32();
// pushfd; cmp byte [flag],0; jne paused; popfd; jmp original;
// paused: popfd; xor eax,eax; ret. ECX and the caller's stack are preserved.
const gateCode = [0x9c, 0x80, 0x3d, ...little32(retained.flagPage.toUInt32()), 0,
  0x75, 0x06, 0x9d, 0xe9, ...little32(0x41a660 - (gateAddress + 16)),
  0x9d, 0x31, 0xc0, 0xc3];
Memory.protect(gate, Process.pageSize, 'rwx');
gate.writeByteArray(gateCode);
Memory.protect(gate, Process.pageSize, 'r-x');
retained.listeners.push(Interceptor.attach(gate, { onEnter() { serviceFrame(); } }));
Memory.patchCode(dispatcherCall, 5, code => code.writeByteArray(
  [0xe8, ...little32(gateAddress - (dispatcherCall.toUInt32() + 5))]));
send({ kind: 'input-menu-ready', keys: { Escape: 'confirm-exit', F10: 'input-menu', T: 'all-chat', Y: 'team-chat-in-tdm' },
  sources: ['window-key', 'directinput', 'async-key', 'external-menu'], behavior: 'external-input-menu', mode: 'lan', pausesWorld: false,
  confirmation: true, nativeFrameGate: gate.toString(),
  nativeClockGate: retained.clockPage.toString(), clockArithmetic: 'native-uint32', version: 11 });
