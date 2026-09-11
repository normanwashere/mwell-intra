import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://localhost:3022';
if (!process.env.AUDIT_PASSWORD) throw new Error('AUDIT_PASSWORD required');
const output = path.resolve('outputs/sep11-admin-ux');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/login`);
  await page.locator('#email').fill('intra.test.admin@mwell.com.ph');
  await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(url => url.pathname !== '/login', { timeout: 60000 });
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/admin/users`);
    await page.getByRole('button', { name: 'Manage', exact: true }).first().waitFor({ timeout: 60000 });
    if (width > 600) {
      const region = page.getByRole('region', { name: 'Users and scoped role assignments horizontal scroll area' });
      const bounds = await region.evaluate(node => {
        const box = node.getBoundingClientRect();
        return { overflow: node.scrollWidth - node.clientWidth, left: box.left, right: box.right,
          actions: [...node.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Manage').map(button => {
            const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right };
          }) };
      });
      expect(bounds.overflow).toBeLessThanOrEqual(2);
      expect(bounds.actions.length).toBeGreaterThan(0);
      for (const action of bounds.actions) { expect(action.left).toBeGreaterThanOrEqual(bounds.left); expect(action.right).toBeLessThanOrEqual(bounds.right); }
      console.log(`PASS ${width}: ${bounds.actions.length} Manage actions fit inside the table; overflow=${bounds.overflow}px`);
    } else {
      const action = await page.getByRole('button', { name: 'Manage', exact: true }).first().boundingBox();
      expect(action.y + action.height).toBeLessThan(820);
      console.log(`PASS 390: first Manage action bottom=${Math.round(action.y + action.height)}px`);
    }
    await page.screenshot({ path: path.join(output, `users-actions-${width}.png`), animations: 'disabled' });
  }
} finally { await browser.close(); }
