'use strict';
// Karma 2.90 draws HUD/help/scoreboard text into its fixed-size game surface.
// Its font constructors turn point sizes into pixels using desktop LOGPIXELSY.
// At 200% desktop scale that doubles glyph sizes without doubling UI spacing.
// Keep the process DPI aware (required by mouse input) and normalize only the
// seven original font-creation queries, not window/input/display DPI APIs.
(() => {
  const fontDpiCallers = new Set([
    '0x40123f', // Latin glyph atlas: GetDeviceCaps -> MulDiv -> CreateFontA.
    '0x426dd1', '0x426e26', // Main UI font pair (10 and 12 points).
    '0x477cdc', // UI text texture font.
    '0x480ba6', // Secondary glyph atlas.
    '0x4b9f6e', '0x4b9fbb' // Additional UI font pair.
  ]);
  const reported = new Set();
  const getDeviceCaps = Process.getModuleByName('gdi32.dll').getExportByName('GetDeviceCaps');
  Interceptor.attach(getDeviceCaps, {
    onEnter(args) {
      this.fontCaller = args[1].toInt32() === 90 && fontDpiCallers.has(this.returnAddress.toString())
        ? this.returnAddress.toString() : null;
    },
    onLeave(result) {
      if (!this.fontCaller) return;
      const desktopDpi = result.toInt32();
      // Preserve a failed native query rather than turn failure into success.
      if (desktopDpi <= 0) return;
      result.replace(96);
      if (!reported.has(this.fontCaller)) {
        reported.add(this.fontCaller);
        send({event:'native-font-dpi', caller:this.fontCaller, desktopDpi, fontDpi:96});
      }
    }
  });
  send({event:'native-font-ready', fontDpi:96});
})();
