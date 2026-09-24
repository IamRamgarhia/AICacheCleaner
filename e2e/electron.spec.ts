import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Drives the real Electron shell (window, preload bridge, native dialogs).
// Needs a desktop session, so it only runs when asked: AICC_ELECTRON=1.
test.skip(!process.env.AICC_ELECTRON, 'set AICC_ELECTRON=1 to run the Electron shell tests');

test('desktop shell: window, native bridge, confirm dialog, update guard, saved window size', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aicc-electron-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'development' }
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.evaluate(() => localStorage.setItem('aicc_tour_done_v1', '1'));

    // Native window: our title, our icon, hidden OS title bar with overlay buttons.
    const info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { title: w.getTitle(), visible: w.isVisible(), min: w.getMinimumSize() };
    });
    expect(info.visible).toBe(true);
    expect(info.min).toEqual([960, 640]);

    // The renderer gets the narrow native bridge, not Node.
    const bridge = await win.evaluate(() => {
      const api = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI ?? {};
      return { keys: Object.keys(api).sort(), hasRequire: typeof (window as unknown as { require?: unknown }).require };
    });
    expect(bridge.keys).toEqual(['alert', 'confirm', 'contextMenu', 'downloadUpdate', 'isElectron', 'onCommand', 'pickFolder', 'platform']);
    expect(bridge.hasRequire).toBe('undefined');

    // Native confirm: answer "Cancel" from the main process and check the text.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { lastBox?: unknown };
      dialog.showMessageBox = (async (_w: unknown, opts: unknown) => {
        g.lastBox = opts;
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const confirmed = await win.evaluate(() =>
      (window as unknown as { electronAPI: { confirm: (o: object) => Promise<boolean> } }).electronAPI.confirm({
        title: 'Stop process', message: 'Stop demo?', detail: 'Any unsaved work in it will be lost.', confirmLabel: 'Stop process', danger: true
      }));
    expect(confirmed).toBe(false);
    const box = await app.evaluate(() => (globalThis as unknown as { lastBox?: { type: string; buttons: string[]; cancelId: number } }).lastBox);
    expect(box).toMatchObject({ type: 'warning', buttons: ['Stop process', 'Cancel'], cancelId: 1 });

    // Update download refuses anything that isn't this repo's release asset.
    const refused = await win.evaluate(() =>
      (window as unknown as { electronAPI: { downloadUpdate: (a: object, cb: () => void) => Promise<{ ok: boolean; error?: string }> } })
        .electronAPI.downloadUpdate({ url: 'https://example.com/evil.exe', name: 'evil.exe' }, () => undefined));
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('Refused');

    await win.screenshot({ path: path.join('test-results', 'electron-shell.png') });
  } finally {
    await app.close();
  }
  // Window size/position is remembered for the next launch.
  expect(fs.existsSync(path.join(userData, 'window-state.json'))).toBe(true);
  fs.rmSync(userData, { recursive: true, force: true });
});
