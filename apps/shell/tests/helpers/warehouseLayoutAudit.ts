import type { Page } from '@playwright/test';

export interface WarehouseLayoutAudit {
  scrollWidth: number;
  viewportWidth: number;
  overflowElements: string[];
  overlaps: string[];
  clippedControls: string[];
  deadEnds: string[];
  undersizedTargets: string[];
}

export async function auditWarehouseLayout(
  page: Page,
  { minimumTarget = 44 }: { minimumTarget?: number } = {},
): Promise<WarehouseLayoutAudit> {
  return page.evaluate(({ minimumTarget }) => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 && !element.closest('[hidden], [aria-hidden="true"]');
    };
    const label = (element: HTMLElement) =>
      (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.tagName).trim().replace(/\s+/g, ' ').slice(0, 80);
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const isInsideContainedHorizontalScroller = (element: HTMLElement) => {
      let parent = element.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (
          /auto|scroll/.test(style.overflowX) &&
          parent.scrollWidth > parent.clientWidth + 2 &&
          bounds.left >= -2 &&
          bounds.right <= viewportWidth + 2
        ) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    const overflowElements = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (rect.left < -2 || rect.right > viewportWidth + 2) && !isInsideContainedHorizontalScroller(element);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const identifier = element.id
          ? `#${element.id}`
          : `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}`;
        return `${identifier} [${Math.round(rect.left)}, ${Math.round(rect.right)}] ${label(element)}`.slice(0, 240);
      })
      .slice(0, 20);
    const controls = Array.from(document.querySelectorAll<HTMLElement>('button, input, select, textarea, [role="button"], a[href]')).filter(visible);
    const clippedControls = controls.filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= viewportHeight) return false;
      if (rect.left < -2 || rect.right > viewportWidth + 2) {
        return !isInsideContainedHorizontalScroller(element);
      }
      let parent = element.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if (/hidden|clip/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) {
          const bounds = parent.getBoundingClientRect();
          if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2) return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }).map(label).slice(0, 20);
    const undersizedTargets = controls.filter((element) => {
      if (element.matches('input[type="file"].sr-only')) return false;
      if (element.matches('a[href]') && !element.matches('[role="button"], nav a')) return false;
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= viewportHeight) return false;
      return rect.width < minimumTarget || rect.height < minimumTarget;
    }).map((element) => `${label(element)} (${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)})`).slice(0, 20);
    const deadEnds = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(visible).filter((link) => {
      const href = link.getAttribute('href') ?? '';
      return href === '#' || /^javascript:/i.test(href) || (/^data:/i.test(href) && !link.hasAttribute('download'));
    }).map(label);
    deadEnds.push(...controls.filter((element) => !label(element)).map(() => 'Unlabelled interactive control'));
    const mobileNav = document.querySelector<HTMLElement>('nav[aria-label="Primary mobile"]');
    const stickyActions = Array.from(document.querySelectorAll<HTMLElement>('[class*="sticky"][class*="bottom"]')).filter(visible);
    const overlaps: string[] = [];
    if (mobileNav && visible(mobileNav)) {
      const navRect = mobileNav.getBoundingClientRect();
      for (const action of stickyActions) {
        const rect = action.getBoundingClientRect();
        const intersection = Math.max(0, Math.min(rect.bottom, navRect.bottom) - Math.max(rect.top, navRect.top));
        if (intersection > 2) overlaps.push(`${label(action)} overlaps mobile navigation by ${Math.round(intersection)}px`);
      }
    }
    return {
      scrollWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      viewportWidth,
      overflowElements,
      overlaps,
      clippedControls,
      deadEnds: deadEnds.slice(0, 20),
      undersizedTargets,
    };
  }, { minimumTarget });
}

export async function canvasHasVisualData(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return false;
    const context = element.getContext('2d');
    if (!context || element.width === 0 || element.height === 0) return false;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    const first = pixels.slice(0, 4).join(',');
    for (let index = 4; index < pixels.length; index += 4) {
      if (pixels.slice(index, index + 4).join(',') !== first) return true;
    }
    return false;
  });
}
