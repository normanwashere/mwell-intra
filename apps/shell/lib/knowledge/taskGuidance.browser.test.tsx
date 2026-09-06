import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";
import { KnowledgeRoleGuide } from "@shell/components/knowledge/KnowledgeRoleGuide";
import { KNOWLEDGE_CONTENT } from "./content";
import { knowledgeContentForAudience } from "./audience";

// Opt in locally: KB_TASK_BROWSER=1 pnpm exec vitest run lib/knowledge/taskGuidance.browser.test.tsx
it.skipIf(process.env.KB_TASK_BROWSER !== "1")(
  "keeps role tasks readable at desktop and mobile widths",
  async () => {
    const css = await postcss([tailwindcss(tailwindConfig)]).process(
      (await readFile(
        path.resolve("../../packages/ui/src/styles.css"),
        "utf8",
      )) + (await readFile(path.resolve("app/globals.css"), "utf8")),
      { from: path.resolve("app/globals.css") },
    );
    const browser = await chromium.launch({ headless: true });
    const output = path.join(tmpdir(), "kb-role-task-verification");
    await mkdir(output, { recursive: true });
    try {
      const page = await browser.newPage();
      for (const roleId of [
        "warehouse_operator",
        "vendor_portal",
        "events_viewer",
        "product_owner",
      ]) {
        const role = KNOWLEDGE_CONTENT.roles.find(
          (item) => item.id === roleId,
        )!;
        const content = knowledgeContentForAudience(
          KNOWLEDGE_CONTENT,
          roleId === "vendor_portal" ? "vendor" : "employee",
        );
        const html = renderToStaticMarkup(
          <KnowledgeRoleGuide
            role={role}
            rolesById={
              new Map(KNOWLEDGE_CONTENT.roles.map((item) => [item.id, item]))
            }
            relatedFeatures={content.features.filter((item) =>
              item.roleIds.includes(role.id),
            )}
            relatedFlows={content.flows.filter((item) =>
              item.roles.includes(role.id),
            )}
            relatedArticles={[]}
            onBack={() => {}}
            onOpenArticle={() => {}}
            onOpenFlow={() => {}}
          />,
        );
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.setContent(
            `<html><head><style>${css.css}\n:root { --font-poppins: Arial; --font-inter: Arial; --font-jbmono: monospace; }</style></head><body><main style="padding:16px">${html}</main></body></html>`,
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${roleId} at ${width}`,
          ).toBe(true);
          const tasks = page.locator("#role-tasks");
          expect(await tasks.locator("li").count()).toBe(
            role.dailyTasks.length,
          );
          for (const button of await tasks.locator("button").all()) {
            const box = await button.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(
              await button.evaluate(
                (element) => element.scrollWidth <= element.clientWidth,
              ),
            ).toBe(true);
          }
          if (width < 1024) {
            expect(
              await tasks.boundingBox().then((box) => box!.y),
            ).toBeLessThan(650);
            await page.locator("summary").click();
            expect(
              await page.locator("details").getAttribute("open"),
            ).not.toBeNull();
            await page.locator("summary").click();
          }
          await page.screenshot({
            path: path.join(output, `${roleId}-${width}.png`),
            fullPage: true,
          });
        }
      }
    } finally {
      await browser.close();
    }
  },
  120_000,
);
