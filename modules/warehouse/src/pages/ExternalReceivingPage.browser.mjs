// Real-component responsive regression with a synthetic RPC transport. No live backend writes.
/* global window, document */
import assert from "node:assert/strict";
import console from "node:console";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/shell/package.json"));
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const output = path.join(tmpdir(), "warehouse-external-receiving-qa");
await mkdir(output, { recursive: true });

const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {MemoryRouter} from 'react-router-dom';
  import {ExternalReceivingPage} from './src/pages/ExternalReceivingPage';
  const user='11111111-1111-4111-8111-111111111111';
  const line='22222222-2222-4222-8222-222222222222';
  const po={id:'33333333-3333-4333-8333-333333333333',po_number:'EMAIL-2026-1042',supplier_id:'supplier',location_id:'warehouse',status:'draft',
    evidence_urls:[],email_sender:'deliveries@medical-supplier.example',email_date:'2026-10-18',notes:'Partial deliveries expected.',version:1,created_by:user,
    confirmed_by:null,review_note:null,created_at:'2026-10-18T08:00:00Z',lines:[{id:line,product_id:'device',quantity:12,uom:'piece',received_quantity:0}],shipments:[]};
  window.qa={calls:[],refreshes:0,po};
  const client={schema:()=>({rpc:async(name,args)=>{
    window.qa.calls.push({name,args:structuredClone(args)});
    if(name==='external_po_workspace')return {data:{can_confirm:false,orders:[structuredClone(po)],has_more:false,next_offset:100},error:null};
    if(args.payload.action==='save_shipment'){
      const p=args.payload;po.shipments=[{...p,id:p.shipment_id,status:'draft',version:1,receipt_id:null,created_by:user}];
      return {data:{order_id:po.id,shipment_id:p.shipment_id},error:null};
    }
    return {data:null,error:{message:'Unsupported test action',code:'P0001'}};
  }}),storage:{from:()=>({createSignedUrl:async()=>({data:null,error:{message:'Fixture has no uploaded files'}})})}};
  window.qa.session={mode:'supabase',profile:{id:user},supabaseClient:client};
  window.qa.store={data:{products:[{id:'device',name:'Portable diagnostic monitor',sku:'MD-204',serialized:false,uom:'piece'}],suppliers:[{id:'supplier',name:'Medical Equipment Supply Co.'}],
    locations:[{id:'warehouse',name:'Main warehouse',type:'warehouse',active:true}],storageAreas:[{id:'arrival',locationId:'warehouse',code:'RCV-A1',label:'Receiving custody',active:true}]},
    can:cap=>['receive_stock','inspect_quality','transfer_stock'].includes(cap),refresh:async()=>{window.qa.refreshes++;}};
  createRoot(document.getElementById('root')).render(<MemoryRouter basename='/warehouse' initialEntries={['/warehouse/external-receiving']}><main className='mx-auto max-w-6xl p-4 sm:p-6'><ExternalReceivingPage/></main></MemoryRouter>);
`;
const bundle = await build({
  stdin: {
    contents: entry,
    resolveDir: path.join(root, "modules/warehouse"),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "@": path.join(root, "modules/warehouse/src"),
    react: path.dirname(require.resolve("react/package.json")),
    "react-dom": path.dirname(require.resolve("react-dom/package.json")),
  },
  plugins: [
    {
      name: "test-rpc",
      setup(builder) {
        builder.onResolve(
          { filter: /^(@\/auth\/session|@intra\/auth)$/ },
          () => ({ path: "session", namespace: "fixture" }),
        );
        builder.onResolve({ filter: /^@\/app\/store$/ }, () => ({
          path: "store",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "session"
              ? "export const useSession=()=>window.qa.session;"
              : "export const useWarehouse=()=>window.qa.store;",
          loader: "js",
        }));
      },
    },
  ],
});
const css = await postcss([
  tailwind({
    presets: [require("@intra/config/tailwind/preset")],
    content: [
      { raw: entry, extension: "tsx" },
      path.join(root, "modules/warehouse/src/pages/ExternalReceivingPage.tsx"),
      path.join(
        root,
        "modules/warehouse/src/components/ExternalPOEvidence.tsx",
      ),
      path.join(
        root,
        "modules/warehouse/src/components/camera/EvidenceCapture.tsx",
      ),
      path.join(root, "packages/ui/src/**/*.{ts,tsx}"),
    ],
  }),
]).process(
  (await readFile(path.join(root, "packages/ui/src/styles.css"), "utf8")) +
    "\n" +
    (await readFile(path.join(root, "apps/shell/app/globals.css"), "utf8")),
  { from: undefined },
);
const html =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>External receiving UI regression</title><style>' +
  css.css +
  '</style></head><body><div id="root"></div><script>' +
  bundle.outputFiles[0].text.replaceAll("</script", "<\\/script") +
  "</script></body></html>";
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/warehouse/external-receiving`;
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (entry) => {
      if (entry.type() === "error") errors.push(entry.text());
    });
    await page.goto(url);
    await expect(page).toHaveTitle("External receiving UI regression");
    await expect(
      page.getByRole("heading", { name: "External PO receiving", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open EMAIL-2026-1042" }),
    ).toBeEnabled();
    await page.screenshot({
      path: path.join(output, `${width}-queue.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Register emailed PO" }).click();
    await expect(page.getByLabel("Product 1", { exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(output, `${width}-registration.png`),
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Open EMAIL-2026-1042" }).click();
    await expect(
      page.getByRole("button", { name: "Confirm PO record" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Record shipment" }).click();
    await page
      .getByLabel("Delivery reference", { exact: true })
      .fill("DR-PARTIAL-42");
    await page
      .getByLabel("Actual delivery date", { exact: true })
      .fill("2026-10-19");
    await page
      .getByLabel("Arrival bin", { exact: true })
      .selectOption("arrival");
    await page
      .getByLabel("Delivered quantity for Portable diagnostic monitor", {
        exact: true,
      })
      .fill("4");
    await page.screenshot({ path: path.join(output, `${width}-shipment.png`) });
    await page
      .getByRole("button", { name: "Save shipment", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume DR-PARTIAL-42" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Post DR-PARTIAL-42 to Quality" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Resume DR-PARTIAL-42" }).click();
    await expect(
      page.getByLabel("Delivered quantity for Portable diagnostic monitor"),
    ).toHaveValue("4");
    assert.equal(await page.evaluate(() => window.qa.refreshes), 1);
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth > window.innerWidth + 1,
      sheet: [...document.querySelectorAll(".intra-sheet-body")].some(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ),
    }));
    assert.deepEqual(overflow, { page: false, sheet: false });
    assert.deepEqual(errors, []);
    results.push({
      width,
      passed: true,
      mode: "synthetic RPC; real page and shared components",
      output,
    });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ url, results }, null, 2));
