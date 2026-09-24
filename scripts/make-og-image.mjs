// Renders docs/og-image.png (1200x630 social preview) from HTML with the
// Playwright browser the project already uses for UI tests.
// Run: node scripts/make-og-image.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shot = fs.readFileSync(path.join(root, 'docs', 'screenshots', 'locations.png')).toString('base64');
const icon = fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64');

const html = `<!doctype html><html><body style="margin:0">
<div style="width:1200px;height:630px;background:#0e1116;color:#eceff3;font-family:'Segoe UI',system-ui,sans-serif;display:flex;overflow:hidden;position:relative">
  <div style="padding:64px 0 64px 64px;width:560px;display:flex;flex-direction:column;justify-content:center;gap:22px;z-index:1">
    <div style="display:flex;align-items:center;gap:14px;font-size:28px;font-weight:600">
      <img src="data:image/png;base64,${icon}" width="56" height="56"/> AICacheCleaner
    </div>
    <div style="font-size:50px;font-weight:700;line-height:1.08;letter-spacing:-1px">Free AI cache cleaner for Windows</div>
    <div style="font-size:24px;color:#a8b0bc;line-height:1.4">Claude · Cursor · Antigravity · Ollama · Docker · Chrome Gemini Nano · npm &amp; pip</div>
    <div style="display:flex;gap:10px;font-size:18px">
      <span style="border:1px solid #3fb98a;color:#3fb98a;border-radius:6px;padding:6px 12px">Recycle Bin only</span>
      <span style="border:1px solid #a8b0bc;color:#a8b0bc;border-radius:6px;padding:6px 12px">100% offline</span>
      <span style="border:1px solid #a8b0bc;color:#a8b0bc;border-radius:6px;padding:6px 12px">Open source</span>
    </div>
  </div>
  <img src="data:image/png;base64,${shot}" style="position:absolute;left:640px;top:70px;width:900px;border:1px solid #222831;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.6)"/>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: path.join(root, 'docs', 'og-image.png') });
await browser.close();
console.log('docs/og-image.png written');
