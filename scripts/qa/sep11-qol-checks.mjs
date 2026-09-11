import assert from 'node:assert/strict';
import path from 'node:path';

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
    await page.evaluate(()=>document.documentElement.classList.add('dark'));
    await page.screenshot({path:path.join(output,`order-dark-${width}.png`)});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    await detailsBody.evaluate(el=>{el.scrollTop=el.scrollHeight;});
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
    await page.goto(origin+item.route);await page.getByRole('navigation',{name:'Purchase order sections'}).waitFor();
  }
}
