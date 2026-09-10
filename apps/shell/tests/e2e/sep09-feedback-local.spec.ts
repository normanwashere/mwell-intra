import { test, expect } from '@playwright/test';
import { installWarehouseSession } from '../helpers/warehouseFixtures';

test.skip(({baseURL}) => !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname),
  'Synthetic fixture rehearsal is local-only; it is not a live UAT transaction test.');

test('September 9 candidate screens: inventory, returns and fulfillment', async ({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await installWarehouseSession(page,'warehouse_admin','light');
  for(const route of ['/warehouse/inventory/smart-watch','/warehouse/returns','/warehouse/fulfillment']){
    await page.goto(route,{waitUntil:'domcontentloaded'});
    await expect(page.locator('main').first()).toBeVisible({timeout:60000});
    await expect(page.locator('body')).not.toContainText(/Application error|Configuration missing/);
    if(route.endsWith('/returns')){
      await page.getByText('Which return flow should I use?',{exact:true}).click();
      await expect(page.getByText(/Do not record the same physical return/)).toBeVisible();
    }
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
    await page.screenshot({path:info.outputPath(route.split('/').at(-1)+'-'+info.project.name+'.png')});
  }
  expect(errors).toEqual([]);
});

test('relocation scan correction and draft recovery', async ({page},info)=>{
  await installWarehouseSession(page,'warehouse_admin','light');
  await page.goto('/warehouse/inventory/smart-watch');
  await page.getByRole('button',{name:/relocate/i}).click();
  let dialog=page.getByRole('dialog',{name:'Relocate stock'});
  await expect(dialog).toBeVisible();
  for(const serial of ['SMART-WATCH-SN0001','SMART-WATCH-SN0002']){
    await dialog.getByLabel('Enter barcode manually').fill(serial);
    await dialog.getByRole('button',{name:'Add',exact:true}).click();
  }
  await dialog.getByRole('button',{name:'Remove SMART-WATCH-SN0001',exact:true}).click();
  await expect(dialog.getByRole('list',{name:'Accepted scans'})).not.toContainText('SMART-WATCH-SN0001');
  await dialog.getByLabel('To bin').selectOption('bin-pasig-a1');
  await page.screenshot({path:info.outputPath('relocation-corrected-'+info.project.name+'.png')});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/relocate/i}).click();
  dialog=page.getByRole('dialog',{name:'Relocate stock'});
  await expect(dialog.getByRole('list',{name:'Accepted scans'})).toContainText('SMART-WATCH-SN0002');
  await expect(dialog.getByLabel('To bin')).toHaveValue('bin-pasig-a1');
  await page.reload();
  await page.getByRole('button',{name:/relocate/i}).click();
  dialog=page.getByRole('dialog',{name:'Relocate stock'});
  await expect(dialog.getByRole('button',{name:'Move stock',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Resume draft',exact:true}).click();
  await expect(dialog.getByRole('list',{name:'Accepted scans'})).toContainText('SMART-WATCH-SN0002');
  await dialog.getByRole('button',{name:'Discard draft',exact:true}).click();
  await expect(dialog.getByRole('list',{name:'Accepted scans'})).toHaveCount(0);
});
