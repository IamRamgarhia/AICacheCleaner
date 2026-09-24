import { test } from '@playwright/test';
import { mockApi, openApp } from './mockApi';

// Marketing screenshots from mocked data (no real paths from any machine).
// Run: AICC_SHOTS=1 npx playwright test e2e/screenshots.spec.ts
test.skip(!process.env.AICC_SHOTS, 'set AICC_SHOTS=1 to regenerate docs screenshots');

const shots: { tab: string; file: string; select?: string }[] = [
  { tab: 'DASHBOARD', file: 'overview.png' },
  { tab: 'STORAGE', file: 'locations.png', select: 'Claude Desktop data' },
  { tab: 'EXPLORER', file: 'explorer.png' }
];

for (const s of shots) {
  test(`screenshot ${s.file}`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 1440, height: 860 });
    await openApp(page, s.tab);
    if (s.select) {
      await page.getByText(s.select).click();
      await page.locator('.ins-details').getByText('Cache_Data').waitFor();
    }
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `docs/screenshots/${s.file}` });
  });
}
