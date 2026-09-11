import assert from 'node:assert/strict';
import path from 'node:path';

export async function setPreviewTheme(page, theme) {
  if(await page.getByRole('dialog').count()) {
    // Warehouse sheets remain open when a theme preference arrives from another tab.
    await page.evaluate(value => {
      localStorage.setItem('intra-theme', value);
      window.dispatchEvent(new StorageEvent('storage', {key:'intra-theme',newValue:value}));
    }, theme);
  } else {
    // The suite shell uses its visible switch, not the Warehouse storage listener.
    const viewport=page.viewportSize();
    if(viewport.width<768) await page.setViewportSize({width:1440,height:1000});
    const toggle=page.locator('[role="switch"][aria-label^="Switch to"]:visible').first();
    await toggle.waitFor();
    if((await toggle.getAttribute('aria-checked')==='true')!==(theme==='dark')) await toggle.click();
    if(viewport.width<768) await page.setViewportSize(viewport);
  }
  await page.waitForFunction(value=>document.documentElement.classList.contains('dark')===(value==='dark'),theme);
  await page.waitForTimeout(300);
}

async function checkPinnedNavigation(page, width) {
  if (width < 768) return;
  const aside = page.locator('aside:visible').first();
  const rect = await aside.boundingBox();
  const viewport = page.viewportSize();
  assert(Math.abs(rect.y) <= 1, 'Desktop navigation must remain at the top while the page scrolls');
  assert(Math.abs(rect.height - viewport.height) <= 1, 'Desktop navigation must fit the viewport');
  const nav = aside.getByRole('navigation', {name:'Primary', exact:true});
  const box = await nav.boundingBox();
  assert(box.y >= 0 && box.y + box.height <= viewport.height, 'Sidebar navigation is reachable');
}

export async function checkConvenience({page, context, item, width, origin, output}) {
  console.log(`Checking convenience: ${item.id} ${width}`);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const copy = async (container) => {
    await container.getByRole('button',{name:'Copy reference',exact:true}).click();
    const reference = await page.evaluate(()=>navigator.clipboard.readText());
    assert(reference.length > 0 && !reference.includes('http'));
    await container.getByRole('button',{name:'Copy record link',exact:true}).click();
    const link = await page.evaluate(()=>navigator.clipboard.readText());
    assert.equal(new URL(link).origin,origin);
    assert(!link.includes('token=') && !link.includes('fromFilter='));
    return {reference,link};
  };
  if (item.id === 'pick-pack') {
    if (width >= 768) {
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(300);
      await checkPinnedNavigation(page,width);
      await page.screenshot({path:path.join(output,`warehouse-sidebar-scroll-${width}.png`)});
      await page.evaluate(() => window.scrollTo(0,0));
    }
    await page.getByRole('button',{name:'View order details',exact:true}).first().click();
    const details=page.getByRole('dialog',{name:/^Order details/});await details.waitFor();
    const copied=await copy(details);
    assert.equal(new URL(copied.link).pathname,'/warehouse/fulfillment');
    assert(new URL(copied.link).searchParams.get('order'));
    await page.screenshot({path:path.join(output,`order-copy-${width}.png`)});
    assert(await details.getByRole('definition').count() > 0);
    const detailsBody=details.getByRole('region',{name:/^Order details.* content$/});
    assert(await detailsBody.evaluate(el=>el.scrollWidth <= el.clientWidth + 1), 'Order details must not scroll horizontally');
    await setPreviewTheme(page,'dark');
    const outlineContrast = await details.locator('.btn-outline:not(:disabled)').evaluateAll(buttons => buttons.map(button => {
      const style = getComputedStyle(button);
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return { name: button.textContent, ratio: (Math.max(foreground,background) + 0.05) / (Math.min(foreground,background) + 0.05) };
    }));
    for (const button of outlineContrast) assert(button.ratio >= 4.5, `Dark dialog action contrast: ${button.name}`);
    await page.screenshot({path:path.join(output,`order-dark-${width}.png`)});
    await setPreviewTheme(page,'light');
    await detailsBody.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const timelineBox=await details.locator('section[aria-labelledby="shipment-timeline-title"]').boundingBox();
    const linesBox=await details.locator('section[aria-labelledby="order-lines-title"]').boundingBox();
    assert(Math.abs(timelineBox.width-linesBox.width)<=1, 'Timeline uses the record width instead of leaving an empty grid column');
    await page.screenshot({path:path.join(output,`order-bottom-${width}.png`)});
    await page.keyboard.press('Escape');
    await details.waitFor({state:'hidden'});
    assert(await page.getByRole('button',{name:'View order details',exact:true}).first().evaluate(el=>el===document.activeElement), 'Closing restores focus to the order');
    await page.getByRole('button',{name:'New order / demand',exact:true}).click();
    const form=page.getByRole('dialog',{name:'Create order or fulfillment demand',exact:true});await form.waitFor();
    const body=form.getByRole('region',{name:'Create order or fulfillment demand content',exact:true});
    await page.screenshot({path:path.join(output,`order-intake-top-${width}.png`)});
    await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const footer=form.getByRole('group',{name:'Create order or fulfillment demand actions',exact:true});
    const footerBox=await footer.boundingBox(),dialogBox=await form.boundingBox(),bodyBox=await body.boundingBox();
    assert(footerBox.y+footerBox.height <= dialogBox.y+dialogBox.height+1);
    assert(bodyBox.y+bodyBox.height <= footerBox.y+1);
    await page.screenshot({path:path.join(output,`order-footer-${width}.png`)});
    await form.getByRole('button',{name:'Close',exact:true}).click();
  }
  if (item.id === 'my-work') {
    const link=page.locator('a[aria-label^="Open tracked request:"]').last();
    assert(await link.evaluate(el=>getComputedStyle(el).whiteSpace==='nowrap' && el.scrollWidth<=el.clientWidth+1), 'Request action label stays on one line without clipping');
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300); // Let the existing compact header settle before measuring departure.
    const saved=await page.evaluate(()=>window.scrollY),original=page.url();
    await link.click();await page.waitForURL(url=>url.pathname!=='/work');
    await page.locator('main h1:visible').first().waitFor();
    await page.goBack();await page.waitForURL(original);
    await page.locator('a[aria-label^="Open tracked request:"]').last().waitFor();
    try { await page.waitForFunction(top=>Math.abs(window.scrollY-top)<5,saved,{timeout:10000}); }
    catch(error) { console.log('Work scroll mismatch', {saved,actual:await page.evaluate(()=>({top:window.scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight,checkpoints:Object.keys(sessionStorage).filter(k=>k.startsWith('intra.list-return:')).map(k=>sessionStorage.getItem(k))}))});throw error; }
    assert.equal(await page.getByRole('button',{name:'Waiting on someone else',exact:true}).getAttribute('aria-pressed'),'true');
    await checkPinnedNavigation(page,width);
    await page.screenshot({path:path.join(output,`work-return-${width}.png`)});
  }
  if (item.id === 'purchase-order') {
    const copied=await copy(page.locator('main'));
    assert.equal(new URL(copied.link).pathname,'/procurement/purchase-orders/HANDBOOK-T7-R1-PO');
    await page.screenshot({path:path.join(output,`po-copy-${width}.png`)});
    await page.goto(origin+'/procurement/purchase-orders?filter=active&sort=total&dir=desc');
    const row=page.getByRole('button',{name:'Open HANDBOOK-T7-R1-PO',exact:true});await row.waitFor();await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const saved=await page.evaluate(()=>window.scrollY);
    await row.click();await page.getByRole('link',{name:'Back to POs',exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('fromSort'),'total');
    await page.getByRole('link',{name:'Back to POs',exact:true}).click();await row.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('filter'),'active');
    assert.equal(new URL(page.url()).searchParams.get('sort'),'total');
    try { await page.waitForFunction(top=>Math.abs(window.scrollY-top)<5,saved,{timeout:10000}); }
    catch(error) { console.log('PO scroll mismatch', {saved,actual:await page.evaluate(()=>({top:window.scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight,checkpoints:Object.keys(sessionStorage).filter(k=>k.startsWith('intra.list-return:')).map(k=>sessionStorage.getItem(k))}))});throw error; }
    await page.screenshot({path:path.join(output,`po-list-return-${width}.png`)});
    await checkPinnedNavigation(page,width);
    if(width>=1024) {
      const lineBox=await page.getByRole('combobox',{name:/^PO line/}).boundingBox();
      const quantityBox=await page.getByLabel('New whole-number quantity',{exact:true}).boundingBox();
      assert(Math.abs(lineBox.y-quantityBox.y)<=1, 'Amendment controls align even when labels wrap');
    }
    await page.goto(origin+item.route);await page.getByRole('navigation',{name:'Purchase order sections'}).waitFor();
  }
}
