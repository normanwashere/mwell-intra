import { expect, test, type Page } from '@playwright/test';
import { auditWarehouseLayout } from '../helpers/warehouseLayoutAudit';

async function setContent(page: Page, html: string) {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1">${html}`);
}

test('associated native labels count only when their full touch area is usable', async ({ page }) => {
  await setContent(page, `
    <style>label { display:flex; width:100px; height:44px; align-items:center; }</style>
    <label id="wrapped"><input type="checkbox" aria-label="Wrapped"> Select</label>
    <input id="external" type="radio" aria-label="External"><label for="external"> Choose</label>
  `);
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.locator('#wrapped').click({ position: { x: 95, y: 22 } });
  await expect(page.getByRole('checkbox', { name: 'Wrapped' })).toBeChecked();
  await page.locator('label[for="external"]').click({ position: { x: 95, y: 22 } });
  await expect(page.getByRole('radio', { name: 'External' })).toBeChecked();
});

test('small, occluded or separately interactive labels do not hide undersized controls', async ({ page }) => {
  await setContent(page, `
    <style>body { margin:0; } label { display:flex; width:100px; height:44px; align-items:center; }</style>
    <label style="height:20px"><input type="checkbox" aria-label="Small"> Small</label>
    <label><input type="checkbox" aria-label="Covered"> Covered</label>
    <div style="position:absolute;left:90px;top:20px;width:10px;height:44px"></div>
    <label><input type="checkbox" aria-label="Linked"><a href="#policy" onclick="event.preventDefault()">Policy</a></label>
  `);
  const audit = await auditWarehouseLayout(page);
  expect(audit.undersizedTargets).toHaveLength(3);
  expect(audit.undersizedTargets).toEqual(expect.arrayContaining([
    expect.stringMatching(/^Small /), expect.stringMatching(/^Covered /), expect.stringMatching(/^Linked /),
  ]));
  await page.getByRole('link', { name: 'Policy' }).click();
  await expect(page.getByRole('checkbox', { name: 'Linked' })).not.toBeChecked();
});

test('closed disclosure content is audited when opened, not as a visible control', async ({ page }) => {
  await setContent(page, '<details><summary>Inspect items</summary><input type="checkbox" aria-label="Unwrapped"></details>');
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.getByText('Inspect items', { exact: true }).click();
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([expect.stringMatching(/^Unwrapped /)]);
});

test('partially visible native labels retain their intrinsic target size when exposed edges are usable', async ({ page }) => {
  await setContent(page, `
    <style>
      body { margin:0; }
      label { position:fixed; left:20px; display:flex; width:100px; height:44px; align-items:center; }
    </style>
    <label style="top:-12px"><input type="checkbox" aria-label="Top"> Top</label>
    <label style="bottom:-12px"><input type="radio" aria-label="Bottom"> Bottom</label>
  `);
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.mouse.click(115, 10);
  await expect(page.getByRole('checkbox', { name: 'Top', exact: true })).toBeChecked();
  await page.mouse.click(115, page.viewportSize()!.height - 10);
  await expect(page.getByRole('radio', { name: 'Bottom', exact: true })).toBeChecked();
});

test('partially visible labels do not bypass intrinsic size, sticky overlays or nested controls', async ({ page }) => {
  const cases = [
    { name: 'Short', height: 20, extra: '', content: 'Short' },
    { name: 'Sticky', height: 44, extra: '<div style="position:sticky;top:0;margin-left:20px;width:100px;height:8px;z-index:3;background:white"></div>', content: 'Sticky' },
    { name: 'Overlay', height: 44, extra: '<div style="position:fixed;left:110px;top:18px;width:10px;height:14px;z-index:3;background:white"></div>', content: 'Overlay' },
    { name: 'Nested', height: 44, extra: '', content: '<a href="#policy" onclick="event.preventDefault()" style="position:absolute;inset:0;background:white">Policy</a>' },
  ];
  for (const fixture of cases) {
    await setContent(page, `
      <style>body { margin:0; } label { position:fixed; left:20px; top:-12px; display:flex; width:100px; align-items:center; } input { position:relative; z-index:1; }</style>
      <label style="height:${fixture.height}px"><input type="checkbox" aria-label="${fixture.name}">${fixture.content}</label>
      ${fixture.extra}
    `);
    expect((await auditWarehouseLayout(page)).undersizedTargets, fixture.name).toEqual([
      expect.stringMatching(new RegExp(`^${fixture.name} `)),
    ]);
    if (fixture.name === 'Sticky') await page.mouse.click(115, 2);
    if (fixture.name === 'Overlay') await page.mouse.click(115, 25);
    if (fixture.name === 'Nested') await page.getByRole('link', { name: 'Policy' }).click();
    await expect(page.getByRole('checkbox', { name: fixture.name, exact: true })).not.toBeChecked();
  }
});

test('partially visible native labels use their scrollport intersection without hiding overlays', async ({ page }) => {
  await setContent(page, `
    <style>body { margin:0; } label { display:flex; width:100px; height:44px; align-items:center; }</style>
    <div id="scrollport" style="position:fixed;left:20px;top:80px;width:120px;height:100px;overflow:auto">
      <div style="height:150px"></div>
      <label><input type="checkbox" aria-label="Clipped"> Clipped</label>
      <div style="height:200px"></div>
    </div>
  `);
  await page.locator('#scrollport').evaluate(element => { element.scrollTop = 162; });
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.mouse.click(115, 90);
  await expect(page.getByRole('checkbox', { name: 'Clipped' })).toBeChecked();
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:20px;top:80px;width:100px;height:8px;z-index:3;background:white';
    document.body.append(overlay);
  });
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([expect.stringMatching(/^Clipped /)]);
});

test('partially visible scrollport excludes fully scrolled-out native controls but restores them on reveal', async ({ page }) => {
  await setContent(page, `
    <style>body { margin:0; }</style>
    <div id="scrollport" style="position:fixed;left:20px;top:80px;width:120px;height:100px;overflow:auto">
      <div style="height:150px"></div>
      <input type="checkbox" aria-label="Hidden by scroll">
      <div style="height:200px"></div>
    </div>
  `);
  await page.locator('#scrollport').evaluate(element => { element.scrollTop = 190; });
  expect(await page.getByRole('checkbox', { name: 'Hidden by scroll' }).evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(0);
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.locator('#scrollport').evaluate(element => { element.scrollTop = 150; });
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([expect.stringMatching(/^Hidden by scroll /)]);
});

test('partially visible scrollports do not hide fixed escape targets or their overlays', async ({ page }) => {
  await setContent(page, `
    <style>body { margin:0; }</style>
    <div style="position:relative;width:140px;height:40px;overflow:hidden">
      <label style="position:fixed;left:20px;top:100px;display:flex;width:100px;height:44px;align-items:center">
        <input type="checkbox" aria-label="Fixed label"> Choose
      </label>
    </div>
  `);
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.mouse.click(115, 122);
  await expect(page.getByRole('checkbox', { name: 'Fixed label' })).toBeChecked();
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:20px;top:100px;width:100px;height:44px;z-index:3;background:white';
    document.body.append(overlay);
  });
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([expect.stringMatching(/^Fixed label /)]);
});

test('partially visible fixed containing blocks preserve actual clipping rather than blanket fixed exemptions', async ({ page }) => {
  await setContent(page, `
    <style>body { margin:0; }</style>
    <div id="container" style="position:relative;transform:translateZ(0);width:140px;height:40px;overflow:hidden">
      <input type="checkbox" aria-label="Fixed input" style="position:fixed;left:20px;top:100px">
    </div>
  `);
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([]);
  await page.locator('#container').evaluate(element => { element.style.transform = 'none'; });
  expect(await page.getByRole('checkbox', { name: 'Fixed input' }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === element;
  })).toBe(true);
  expect((await auditWarehouseLayout(page)).undersizedTargets).toEqual([expect.stringMatching(/^Fixed input /)]);
});
