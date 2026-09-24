import { test, expect } from '@playwright/test';
import { mockApi, openApp } from './mockApi';

test('overview shows totals, status bar and the Docker space that compacting returns', async ({ page }) => {
  await mockApi(page);
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Storage overview' })).toBeVisible();
  await expect(page.getByText('Reclaim 2.9 GB')).toBeVisible();
  await expect(page.getByText(/About\s+44 GB of empty space/)).toBeVisible();
  const status = page.locator('.ins-statusbar');
  await expect(status).toContainText('C: 22 GB free');
  await expect(status).toContainText('Bin C:');
});

test('deleting "your data" needs the extra acknowledgement, then sends only that id', async ({ page }) => {
  const log = await mockApi(page);
  await openApp(page, 'STORAGE');
  await page.getByText('Claude Desktop data').click();
  const pane = page.locator('.ins-details');
  await expect(pane).toContainText('Cache_Data');
  await pane.getByRole('button', { name: 'Delete…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Confirm cleanup' });
  const confirm = dialog.getByRole('button', { name: /Move 1 to Recycle Bin/ });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('I understand, continue anyway').check();
  await confirm.click();

  await expect.poll(() => log.clean.length).toBe(1);
  expect((log.clean[0] as { itemIds: string[] }).itemIds).toEqual(['claude-data']);
});

test('keyboard: arrows move, Delete asks first (and ignores protected rows), Cancel sends nothing', async ({ page }) => {
  const log = await mockApi(page);
  await openApp(page, 'STORAGE');
  const list = page.locator('.ins-split-list');
  await list.focus();
  // Largest first: the protected Docker disk is row 1 — Delete must do nothing there.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('tr.is-focused')).toContainText('Docker virtual disk');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Confirm cleanup' })).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('tr.is-focused')).toContainText('npm download cache');
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Confirm cleanup' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(log.clean).toHaveLength(0);
});

test('protected items cannot be selected or deleted from the UI', async ({ page }) => {
  await mockApi(page);
  await openApp(page, 'STORAGE');
  await expect(page.getByLabel('Select Docker virtual disk')).toBeDisabled();
  await page.getByText('Docker virtual disk').click();
  await expect(page.locator('.ins-details').getByRole('button', { name: 'Locked' })).toBeDisabled();
});

test('a refused delete explains why and says nothing was deleted', async ({ page }) => {
  await mockApi(page, { cleanStatus: 409, cleanBody: { error: 'Claude Desktop data — it is larger than the C: Recycle Bin.\nNothing was deleted.' } });
  await openApp(page, 'STORAGE');
  await page.getByText('npm download cache').click();
  await page.locator('.ins-details').getByRole('button', { name: 'Delete…' }).click();
  const messages: string[] = [];
  page.on('dialog', d => { messages.push(d.message()); void d.accept(); });
  await page.getByRole('button', { name: /Move 1 to Recycle Bin/ }).click();
  await expect.poll(() => messages.join('\n')).toContain('larger than the C: Recycle Bin');
  expect(messages.join('\n')).toContain('Nothing was deleted');
});

test('title-bar search (Ctrl+F) jumps to All locations and filters', async ({ page }) => {
  await mockApi(page);
  await openApp(page);
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Search locations')).toBeFocused();
  await page.keyboard.type('chrome');
  await expect(page.getByRole('heading', { name: 'All locations' })).toBeVisible();
  const rows = page.locator('.ins-split-list tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Google Chrome');
});

test('stopping a process asks first; declining sends no kill request', async ({ page }) => {
  const log = await mockApi(page);
  await openApp(page, 'PROCESSES');
  page.once('dialog', d => { expect(d.message()).toContain('unsaved work'); void d.dismiss(); });
  await page.getByRole('button', { name: 'Stop' }).first().click();
  await page.waitForTimeout(300);
  expect(log.kill).toHaveLength(0);
});

test('first-run tour shows once and can be skipped', async ({ page }) => {
  await mockApi(page);
  await openApp(page, 'DASHBOARD', false);
  const tour = page.getByRole('dialog', { name: 'Getting started' });
  await expect(tour).toContainText('Welcome to AICacheCleaner');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Three safety colours');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour).toBeHidden();
  await page.reload();
  await expect(page.locator('.ins-h1')).toBeVisible();
  await expect(tour).toBeHidden();
});

test('reminder is opt-in and saved with the rest of the settings', async ({ page }) => {
  const log = await mockApi(page);
  await openApp(page, 'SETTINGS');
  await page.getByLabel(/Notify me when this much is safe to reclaim/).check();
  await page.getByLabel('Reminder threshold in GB').fill('8');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect.poll(() => log.config.length).toBe(1);
  expect(log.config[0]).toMatchObject({ reminderEnabled: true, reminderGb: 8 });
});

test('disk explorer lists everything at once and fills sizes in as they are measured', async ({ page }) => {
  await mockApi(page);
  await openApp(page, 'EXPLORER');
  await expect(page.locator('.ins-breadcrumb')).toHaveText('C:\\Users\\me');
  const rows = page.locator('.ins-split-list tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('AppData');
  await expect(rows.first()).toContainText('2 GB');
});

test('a selection hidden by search is never deleted; Delete acts on the focused row', async ({ page }) => {
  const log = await mockApi(page);
  await openApp(page, 'STORAGE');
  await page.getByLabel('Select npm download cache').check();
  await page.keyboard.press('Control+f');
  await page.keyboard.type('chrome');
  await page.locator('.ins-split-list tbody tr').first().click();
  await page.locator('.ins-split-list').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Confirm cleanup' });
  await expect(dialog).toContainText('Google Chrome');
  await expect(dialog).not.toContainText('npm download cache');
  await dialog.getByRole('button', { name: /Move 1 to Recycle Bin/ }).click();
  await expect.poll(() => log.clean.length).toBe(1);
  expect((log.clean[0] as { itemIds: string[] }).itemIds).toEqual(['chrome-cache']);
});

test('Space on a checkbox ticks that row, not the focused one; list keys are ignored behind the dialog', async ({ page }) => {
  await mockApi(page);
  await openApp(page, 'STORAGE');
  await page.getByText('npm download cache').click();
  await page.getByLabel('Select Google Chrome · Default — Cache').focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Select Google Chrome · Default — Cache')).toBeChecked();
  await expect(page.getByLabel('Select npm download cache')).not.toBeChecked();

  await page.locator('.ins-split-list').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Confirm cleanup' });
  await expect(dialog).toContainText('npm download cache');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Delete');
  await expect(dialog).toContainText('npm download cache');
});
