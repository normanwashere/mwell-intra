import { expect, test } from "@playwright/test";
import { auditWarehouseLayout } from "../helpers/warehouseLayoutAudit";

test("clipping audit distinguishes escaped fixed controls from real ancestor clipping", async ({ page }) => {
  await page.setContent(`
    <style>
      .clip { margin-left:150px; width:100px; height:80px; overflow:hidden; }
      button { width:80px; height:44px; border-radius:12px; }
      .fixed { position:fixed; left:20px; top:20px; }
      .cropped { margin-left:70px; }
      .containing { transform:translateZ(0); position:relative; }
      .contained { position:fixed; left:70px; top:10px; }
    </style>
    <div class="clip"><button class="fixed">Escaped</button></div>
    <div class="clip"><button class="cropped">Clipped</button></div>
    <div class="clip containing"><button class="contained">Contained</button></div>
  `);
  const result = await auditWarehouseLayout(page);
  expect(result.clippedControls).not.toContain("Escaped");
  expect(result.clippedControls).toContain("Clipped");
  expect(result.clippedControls).toContain("Contained");
});
