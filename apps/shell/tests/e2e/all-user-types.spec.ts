import { expect, type Page, test, type TestInfo } from '@playwright/test';

type ModuleName = 'core' | 'warehouse' | 'procurement' | 'legal';
type Roles = Partial<Record<ModuleName, readonly string[]>>;

interface LoginProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly title: string;
  readonly roles: Roles;
}

interface Persona {
  readonly id: string;
  readonly label: string;
  readonly profileId: string;
  readonly roles: Roles;
}

interface RouteExpectation {
  readonly path: string;
  readonly label: string;
  readonly allowed: boolean;
  readonly allowedText?: RegExp;
  readonly deniedText?: RegExp;
  readonly finalPath?: RegExp;
  readonly allowDeniedCopy?: boolean;
}

interface RouteAudit {
  readonly bodyText: string;
  readonly mainCount: number;
  readonly h1: readonly string[];
  readonly horizontalOverflow: boolean;
  readonly overflowOffenders: readonly string[];
  readonly deadLinks: readonly string[];
  readonly unlabeledControls: readonly string[];
}

interface ConsoleIssue {
  readonly type: string;
  readonly text: string;
  readonly location: string;
}

const MEMORY_SESSION_KEY = 'intra.memory-session.v1';
const DEMO_PASSWORD = 'demo';
const INTERNAL_PROFILE_ID = 'demo-operations';
const VENDOR_PROFILE_ID = 'demo-vendor';

const LOGIN_PROFILES: readonly LoginProfile[] = [
  {
    id: 'demo-logistics',
    email: 'logistics@mwell.demo',
    name: 'Bea Santos',
    title: 'Logistics Supervisor',
    roles: { core: ['staff'], warehouse: ['logistics_supervisor', 'procurement'] },
  },
  {
    id: 'demo-operations',
    email: 'ops@mwell.demo',
    name: 'Marco Reyes',
    title: 'eCommerce / Operations',
    roles: { core: ['staff'], warehouse: ['operations'] },
  },
  {
    id: 'demo-procurement',
    email: 'procurement@mwell.demo',
    name: 'Liza Cruz',
    title: 'Procurement Officer',
    roles: { core: ['staff'], procurement: ['procurement_officer'] },
  },
  {
    id: 'demo-procurement-approver',
    email: 'approver@mwell.demo',
    name: 'Marta Ramos',
    title: 'Department Head - Procurement Approver',
    roles: { core: ['staff'], procurement: ['approver'] },
  },
  {
    id: 'demo-procurement-finance',
    email: 'finance.procurement@mwell.demo',
    name: 'Elena Torres',
    title: 'Finance - Procurement Reviewer',
    roles: { core: ['staff'], procurement: ['finance'] },
  },
  {
    id: 'demo-procurement-cfo',
    email: 'cfo@mwell.demo',
    name: 'Diego Ang',
    title: 'CFO / DOA Approver',
    roles: { core: ['staff'], procurement: ['admin'] },
  },
  {
    id: 'demo-legal',
    email: 'legal@mwell.demo',
    name: 'Andre Villanueva',
    title: 'Legal Reviewer',
    roles: { core: ['staff'], legal: ['legal_reviewer'] },
  },
  {
    id: 'demo-finance',
    email: 'finance@mwell.demo',
    name: 'Rina Domingo',
    title: 'Finance Manager',
    roles: {
      core: ['staff'],
      warehouse: ['finance'],
      procurement: ['finance'],
    },
  },
  {
    id: 'demo-bi',
    email: 'bi@mwell.demo',
    name: 'Jules Aquino',
    title: 'BI Analyst',
    roles: { core: ['staff'], warehouse: ['bi_analyst'] },
  },
  {
    id: 'demo-marketing',
    email: 'marketing@mwell.demo',
    name: 'Kai Mendoza',
    title: 'Marketing Lead',
    roles: { core: ['staff'], warehouse: ['marketing'] },
  },
  {
    id: 'demo-pricing',
    email: 'pricing@mwell.demo',
    name: 'Pia Salcedo',
    title: 'Pricing Analyst',
    roles: { core: ['staff'], warehouse: ['pricing'] },
  },
  {
    id: 'demo-warehouse-admin',
    email: 'warehouse.admin@mwell.demo',
    name: 'Alex Rivera',
    title: 'Warehouse Administrator',
    roles: { core: ['staff'], warehouse: ['warehouse_admin'] },
  },
  {
    id: 'demo-admin',
    email: 'admin@mwell.demo',
    name: 'Patricia Lim',
    title: 'Platform Administrator',
    roles: { core: ['platform_admin', 'staff'] },
  },
  {
    id: 'demo-vendor',
    email: 'vendor@acme.demo',
    name: 'Acme Medical Supplies',
    title: 'Vendor Portal',
    roles: { core: ['vendor_portal'] },
  },
];

const CANONICAL_PERSONAS: readonly Persona[] = [
  {
    id: 'core-staff-only',
    label: 'Core staff without module roles',
    profileId: INTERNAL_PROFILE_ID,
    roles: { core: ['staff'] },
  },
  {
    id: 'core-platform-admin',
    label: 'Core platform administrator',
    profileId: 'demo-admin',
    roles: { core: ['platform_admin', 'staff'] },
  },
  {
    id: 'core-vendor-portal',
    label: 'External vendor portal user',
    profileId: VENDOR_PROFILE_ID,
    roles: { core: ['vendor_portal'] },
  },
  ...[
    'logistics_supervisor',
    'operations',
    'finance',
    'bi_analyst',
    'business_unit',
    'marketing',
    'procurement',
    'pricing',
    'warehouse_admin',
  ].map((role) => ({
    id: `warehouse-${role}`,
    label: `Warehouse ${role}`,
    profileId: INTERNAL_PROFILE_ID,
    roles: { core: ['staff'], warehouse: [role] },
  })),
  ...[
    'requester',
    'procurement_officer',
    'approver',
    'finance',
    'admin',
  ].map((role) => ({
    id: `procurement-${role}`,
    label: `Procurement ${role}`,
    profileId: INTERNAL_PROFILE_ID,
    roles: { core: ['staff'], procurement: [role] },
  })),
  ...['legal_reviewer', 'compliance', 'admin'].map((role) => ({
    id: `legal-${role}`,
    label: `Legal ${role}`,
    profileId: INTERNAL_PROFILE_ID,
    roles: { core: ['staff'], legal: [role] },
  })),
  {
    id: 'finance-dual-scope',
    label: 'Finance with Warehouse and Procurement scopes',
    profileId: 'demo-finance',
    roles: {
      core: ['staff'],
      warehouse: ['finance'],
      procurement: ['finance'],
    },
  },
];

const WAREHOUSE_CAPS: Record<string, readonly string[]> = {
  logistics_supervisor: [
    'view_dashboard',
    'manage_inventory',
    'receive_stock',
    'manage_products',
    'manage_locations',
    'cycle_count',
    'manage_returns',
    'issue_items',
    'transfer_stock',
    'manage_operation_routes',
    'inspect_quality',
    'release_quality_hold',
    'approve_stock_adjustment',
    'view_exceptions',
    'resolve_exceptions',
    'import_warehouse_data',
  ],
  operations: [
    'view_dashboard',
    'manage_inventory',
    'reserve_allocate',
    'issue_items',
    'manage_returns',
    'transfer_stock',
    'inspect_quality',
    'view_exceptions',
  ],
  finance: [
    'view_dashboard',
    'manage_inventory',
    'view_finance',
    'cycle_count',
    'approve_stock_adjustment',
    'view_exceptions',
  ],
  bi_analyst: [
    'view_dashboard',
    'manage_inventory',
    'view_analytics',
    'view_exceptions',
  ],
  business_unit: ['view_dashboard', 'manage_inventory', 'reserve_allocate'],
  marketing: [
    'view_dashboard',
    'manage_inventory',
    'reserve_allocate',
    'manage_returns',
  ],
  procurement: [
    'view_dashboard',
    'manage_inventory',
    'view_procurement',
    'manage_products',
  ],
  pricing: [
    'view_dashboard',
    'manage_inventory',
    'view_pricing',
    'set_pricing',
    'view_finance',
  ],
  warehouse_admin: [
    'view_dashboard',
    'receive_stock',
    'manage_inventory',
    'manage_products',
    'manage_locations',
    'cycle_count',
    'manage_returns',
    'reserve_allocate',
    'issue_items',
    'transfer_stock',
    'view_finance',
    'view_analytics',
    'view_procurement',
    'view_pricing',
    'set_pricing',
    'manage_operation_routes',
    'inspect_quality',
    'release_quality_hold',
    'approve_stock_adjustment',
    'view_exceptions',
    'resolve_exceptions',
    'import_warehouse_data',
  ],
};

const PROCUREMENT_CAPS: Record<string, readonly string[]> = {
  requester: ['view_dashboard', 'create_request'],
  procurement_officer: [
    'view_dashboard',
    'create_request',
    'manage_rfp',
    'author_po',
    'manage_vendors',
    'approve_request',
  ],
  approver: ['view_dashboard', 'approve_request', 'approve_award'],
  finance: ['view_dashboard', 'view_finance', 'approve_request'],
  admin: [
    'view_dashboard',
    'create_request',
    'manage_rfp',
    'author_po',
    'approve_request',
    'approve_award',
    'manage_vendors',
    'view_finance',
    'admin',
  ],
};

const LEGAL_CAPS: Record<string, readonly string[]> = {
  legal_reviewer: [
    'view_dashboard',
    'review_accreditation',
    'manage_checklist',
    'approve_accreditation',
    'manage_documents',
  ],
  compliance: [
    'view_dashboard',
    'review_accreditation',
    'approve_accreditation',
    'manage_documents',
  ],
  admin: [
    'view_dashboard',
    'review_accreditation',
    'manage_checklist',
    'approve_accreditation',
    'manage_documents',
    'admin',
  ],
};

test.describe('full Mwell Intra user-type E2E', () => {
  for (const profile of LOGIN_PROFILES) {
    test(`demo login: ${profile.title} (${profile.email})`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      const consoleIssues = collectConsoleIssues(page);
      await page.goto('/login?redirect=%2F', { waitUntil: 'load' });
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
      await page.getByLabel('Email').fill(profile.email);
      await page.getByLabel('Password').fill(DEMO_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();

      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('body')).toContainText(profile.name.split(/\s+/)[0]!);
      const audit = await auditPage(page);
      expectUsablePage(audit, '/', testInfo);
      expect(
        consoleIssues.filter((issue) => !isAllowedConsoleIssue(issue)),
        `${profile.email} should not emit browser console/page errors`,
      ).toEqual([]);
    });
  }

  for (const persona of CANONICAL_PERSONAS) {
    test(`route access matrix: ${persona.label}`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const consoleIssues = collectConsoleIssues(page);
      await installMemorySession(page, persona);

      for (const route of expectationsFor(persona)) {
        await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await expect.poll(async () => (await page.locator('main').allInnerTexts()).join(' ').trim().length).toBeGreaterThan(20);
        const audit = await auditPage(page);
        expectUsablePage(audit, route.path, testInfo);
        if (route.finalPath) {
          expect(new URL(page.url()).pathname).toMatch(route.finalPath);
        }
        if (route.allowed) {
          if (!route.allowDeniedCopy) {
            expect(
              audit.bodyText,
              `${persona.label} should not see a denied/not-found state on ${route.path}`,
            ).not.toMatch(deniedPattern());
          }
          if (route.allowedText) {
            expect(audit.bodyText).toMatch(route.allowedText);
          }
        } else {
          expect(
            audit.bodyText,
            `${persona.label} should see an explicit denied state on ${route.path}`,
          ).toMatch(route.deniedText ?? deniedPattern());
        }
      }

      expect(
        consoleIssues.filter((issue) => !isAllowedConsoleIssue(issue)),
        `${persona.label} should not emit browser console/page errors`,
      ).toEqual([]);
    });
  }
});

function expectationsFor(persona: Persona): readonly RouteExpectation[] {
  const roles = persona.roles;
  return [
    {
      path: '/',
      label: 'dashboard',
      allowed: true,
      allowedText: dashboardTextFor(roles),
      allowDeniedCopy: !hasAnyModuleOrPortal(roles),
    },
    {
      path: '/finance',
      label: 'unified finance',
      allowed: canAccessFinance(roles),
      allowedText: /Finance|Payment readiness|Cross-module activity/i,
      deniedText: /No Finance access/i,
    },
    {
      path: '/warehouse',
      label: 'warehouse home',
      allowed: hasWarehouseCap(roles, 'view_dashboard'),
      allowedText: /Warehouse|Dashboard/i,
      deniedText: /No warehouse access/i,
      finalPath: /\/warehouse\/?$/,
    },
    ...warehouseRoutes(roles),
    {
      path: '/procurement',
      label: 'procurement home',
      allowed: canEnterProcurement(roles),
      allowedText: /Procurement|Approval inbox|Purchase request/i,
      deniedText: /No procurement access/i,
      finalPath: canEnterProcurement(roles) ? /\/procurement\/?(approvals)?$/ : undefined,
    },
    {
      path: '/procurement/approvals',
      label: 'procurement approvals',
      allowed: canApproveProcurement(roles),
      allowedText: /Approval inbox|Waiting on you|Inbox zero/i,
    },
    {
      path: '/procurement/requests/new',
      label: 'new procurement request',
      allowed: hasProcurementCap(roles, 'create_request') || isTierOnlyProcurement(roles),
      allowedText: hasProcurementCap(roles, 'create_request')
        ? /Draft a purchase request|New request/i
        : /Approval inbox|Waiting on you|Inbox zero/i,
      finalPath: hasProcurementCap(roles, 'create_request')
        ? undefined
        : isTierOnlyProcurement(roles)
          ? /\/procurement\/approvals$/
          : undefined,
    },
    {
      path: '/procurement/requests/req_seed_001',
      label: 'procurement request detail',
      allowed: canEnterProcurement(roles),
      allowedText: /Purchase request|Line items|Activity/i,
    },
    {
      path: '/procurement/purchase-orders',
      label: 'procurement purchase orders',
      allowed:
        canViewProcurementPurchaseOrders(roles) || isTierOnlyProcurement(roles),
      allowedText: canViewProcurementPurchaseOrders(roles)
        ? /Purchase orders|POs/i
        : /Approval inbox|Waiting on you|Inbox zero/i,
      finalPath: canViewProcurementPurchaseOrders(roles)
        ? undefined
        : isTierOnlyProcurement(roles)
          ? /\/procurement\/approvals$/
          : undefined,
    },
    {
      path: '/procurement/purchase-orders/po_seed_001',
      label: 'procurement PO detail',
      allowed:
        canViewProcurementPurchaseOrders(roles) || isTierOnlyProcurement(roles),
      allowedText: canViewProcurementPurchaseOrders(roles)
        ? /Purchase order|Line items|Status/i
        : /Approval inbox|Waiting on you|Inbox zero/i,
      finalPath: canViewProcurementPurchaseOrders(roles)
        ? undefined
        : isTierOnlyProcurement(roles)
          ? /\/procurement\/approvals$/
          : undefined,
    },
    {
      path: '/legal',
      label: 'legal home',
      allowed: hasLegalCap(roles, 'view_dashboard'),
      allowedText: /Accreditation cases|Your application|Legal/i,
      deniedText: /No legal access/i,
    },
    {
      path: '/legal/cases/case_seed_001',
      label: 'legal case detail',
      allowed: hasLegalCap(roles, 'view_dashboard'),
      allowedText: /Accreditation|Checklist|Documents|Timeline|Activity/i,
    },
    {
      path: '/legal/invites/new',
      label: 'legal invite vendor',
      allowed: hasLegalCap(roles, 'manage_checklist'),
      allowedText: /Invite vendor|Onboard a new vendor/i,
    },
    {
      path: '/vendor',
      label: 'vendor portal',
      allowed: hasCoreRole(roles, 'vendor_portal'),
      allowedText: /Your accreditation|Your application|Vendor/i,
      deniedText: /No legal access|not enrolled/i,
    },
    {
      path: '/vendor/cases/case_seed_001',
      label: 'vendor case detail',
      allowed: hasCoreRole(roles, 'vendor_portal'),
      allowedText: /Accreditation|requirements|documents|application/i,
      deniedText: /No legal access|not enrolled/i,
    },
    {
      path: '/admin/users',
      label: 'admin users',
      allowed: hasCoreRole(roles, 'platform_admin'),
      allowedText: /Users & Roles|Access matrix/i,
    },
  ];
}

function warehouseRoutes(roles: Roles): readonly RouteExpectation[] {
  const routeCaps: Array<{
    readonly path: string;
    readonly label: string;
    readonly caps: readonly string[];
    readonly allowedText: RegExp;
  }> = [
    {
      path: '/warehouse/inventory',
      label: 'warehouse inventory',
      caps: ['manage_inventory'],
      allowedText: /Inventory|SKUs|Low stock/i,
    },
    {
      path: '/warehouse/inventory/ecg-ring-10',
      label: 'warehouse product detail',
      caps: ['manage_inventory'],
      allowedText: /Traceability|Stock|ECG Ring/i,
    },
    {
      path: '/warehouse/receiving',
      label: 'warehouse receiving',
      caps: ['receive_stock'],
      allowedText: /Receiving|Receive/i,
    },
    {
      path: '/warehouse/allocations',
      label: 'warehouse allocations',
      caps: ['reserve_allocate', 'issue_items'],
      allowedText: /Allocations|Reserve|Issue/i,
    },
    {
      path: '/warehouse/events',
      label: 'warehouse events',
      caps: ['reserve_allocate', 'view_finance'],
      allowedText: /Events|Activations/i,
    },
    {
      path: '/warehouse/cycle-counts',
      label: 'warehouse cycle counts',
      caps: ['cycle_count'],
      allowedText: /Cycle|Count/i,
    },
    {
      path: '/warehouse/returns',
      label: 'warehouse returns',
      caps: ['manage_returns'],
      allowedText: /Returns|Record return/i,
    },
    {
      path: '/warehouse/procurement',
      label: 'warehouse procurement',
      caps: ['view_procurement'],
      allowedText: /Procurement|Reorder|Supplier/i,
    },
    {
      path: '/warehouse/purchase-orders',
      label: 'warehouse purchase orders',
      caps: ['view_procurement', 'receive_stock'],
      allowedText: /Purchase Orders|PO/i,
    },
    {
      path: '/warehouse/suppliers',
      label: 'warehouse suppliers',
      caps: ['view_procurement'],
      allowedText: /Suppliers|Lead time/i,
    },
    {
      path: '/warehouse/storage',
      label: 'warehouse storage',
      caps: ['receive_stock', 'manage_locations', 'transfer_stock', 'cycle_count'],
      allowedText: /Storage|Bin|Area/i,
    },
    {
      path: '/warehouse/locations',
      label: 'warehouse locations',
      caps: ['manage_locations'],
      allowedText: /Locations|Warehouse|Site/i,
    },
    {
      path: '/warehouse/pricing',
      label: 'warehouse pricing',
      caps: ['view_pricing'],
      allowedText: /Pricing|Landed cost|Set price/i,
    },
    {
      path: '/warehouse/data',
      label: 'warehouse data',
      caps: ['view_analytics'],
      allowedText: /Data|Reports|Export/i,
    },
  ];

  return routeCaps.map((route) => ({
    ...route,
    allowed: route.caps.some((cap) => hasWarehouseCap(roles, cap)),
    deniedText: hasWarehouseRole(roles)
      ? /You don't have access to this page|not available for your role/i
      : /No warehouse access/i,
  }));
}

function hasCoreRole(roles: Roles, role: string): boolean {
  return roles.core?.includes(role) ?? false;
}

function canAccessFinance(roles: Roles): boolean {
  return (
    hasWarehouseCap(roles, 'view_finance') ||
    hasProcurementCap(roles, 'view_finance')
  );
}

function hasWarehouseRole(roles: Roles): boolean {
  return (roles.warehouse?.length ?? 0) > 0;
}

function hasAnyModuleOrPortal(roles: Roles): boolean {
  return (
    (roles.warehouse?.length ?? 0) > 0 ||
    (roles.procurement?.length ?? 0) > 0 ||
    (roles.legal?.length ?? 0) > 0 ||
    hasCoreRole(roles, 'platform_admin') ||
    hasCoreRole(roles, 'vendor_portal')
  );
}

function hasWarehouseCap(roles: Roles, cap: string): boolean {
  return (roles.warehouse ?? []).some((role) => WAREHOUSE_CAPS[role]?.includes(cap));
}

function hasProcurementCap(roles: Roles, cap: string): boolean {
  return (roles.procurement ?? []).some((role) =>
    PROCUREMENT_CAPS[role]?.includes(cap),
  );
}

function hasLegalCap(roles: Roles, cap: string): boolean {
  return (roles.legal ?? []).some((role) => LEGAL_CAPS[role]?.includes(cap));
}

function procurementTiers(roles: Roles): readonly string[] {
  const tiers = new Set<string>();
  const proc = roles.procurement ?? [];
  const legal = roles.legal ?? [];
  const warehouse = roles.warehouse ?? [];
  if (proc.includes('approver')) tiers.add('dept_head');
  if (proc.includes('procurement_officer')) tiers.add('procurement_head');
  if (proc.includes('admin')) {
    tiers.add('procurement_head');
    tiers.add('final_approver');
  }
  if (proc.includes('finance') || warehouse.includes('finance')) tiers.add('finance');
  if (legal.includes('legal_reviewer')) tiers.add('legal');
  return [...tiers];
}

function canEnterProcurement(roles: Roles): boolean {
  return (roles.procurement?.length ?? 0) > 0 || procurementTiers(roles).length > 0;
}

function isTierOnlyProcurement(roles: Roles): boolean {
  return !hasProcurementCap(roles, 'view_dashboard') && procurementTiers(roles).length > 0;
}

function canApproveProcurement(roles: Roles): boolean {
  return hasProcurementCap(roles, 'approve_request') || procurementTiers(roles).length > 0;
}

function canViewProcurementPurchaseOrders(roles: Roles): boolean {
  return (
    hasProcurementCap(roles, 'author_po') ||
    hasProcurementCap(roles, 'approve_award') ||
    hasProcurementCap(roles, 'view_finance') ||
    hasProcurementCap(roles, 'admin')
  );
}

function dashboardTextFor(roles: Roles): RegExp {
  if (hasCoreRole(roles, 'vendor_portal')) return /Vendor Portal|Your modules/i;
  if (hasCoreRole(roles, 'platform_admin')) return /Admin|Users & Roles/i;
  if ((roles.warehouse?.length ?? 0) > 0) return /Warehouse/i;
  if ((roles.procurement?.length ?? 0) > 0) return /Procurement/i;
  if ((roles.legal?.length ?? 0) > 0) return /Legal/i;
  return /Knowledge Base/i;
}

async function installMemorySession(page: Page, persona: Persona): Promise<void> {
  await page.addInitScript(
    ({ key, session }) => {
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    {
      key: MEMORY_SESSION_KEY,
      session: { profileId: persona.profileId, roles: persona.roles },
    },
  );
}

async function auditPage(page: Page): Promise<RouteAudit> {
  return page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        element.closest('[hidden], [aria-hidden="true"], details:not([open])')
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const viewportWidth = document.documentElement.clientWidth;
    const overflowThreshold = Math.max(viewportWidth + 2, window.innerWidth + 1);
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    const overflowOffenders = Array.from(
      document.body.querySelectorAll<HTMLElement>('*'),
    )
      .filter(visible)
      .map((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute('aria-label') ??
            element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 64) ??
            element.tagName.toLowerCase(),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          chrome: style.position === 'fixed' || style.position === 'sticky',
        };
      })
      .filter((item) => !item.chrome)
      .filter((item) => item.left < -2 || item.right > overflowThreshold)
      .map((item) => `${item.label} (${item.left}-${item.right})`)
      .slice(0, 10);

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const deadLinks = links
      .filter((link) => {
        const href = link.getAttribute('href') ?? '';
        if (href === '#' || /^javascript:/i.test(href)) return true;
        if (/^data:/i.test(href)) return !link.hasAttribute('download');
        return false;
      })
      .map((link) => link.getAttribute('href') ?? '')
      .slice(0, 10);

    const unlabeledControls = Array.from(
      document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]'),
    )
      .filter(visible)
      .filter((element) => {
        const label =
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.textContent;
        return !label || label.trim().length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 120))
      .slice(0, 10);

    return {
      bodyText: document.body.innerText.trim().replace(/\s+/g, ' '),
      mainCount: document.querySelectorAll('main').length,
      h1: Array.from(document.querySelectorAll('h1'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 4),
      horizontalOverflow: scrollWidth > overflowThreshold && overflowOffenders.length > 0,
      overflowOffenders,
      deadLinks,
      unlabeledControls,
    };
  });
}

function expectUsablePage(
  audit: RouteAudit,
  path: string,
  testInfo: TestInfo,
): void {
  expect(audit.bodyText.length, `${path} should not be blank`).toBeGreaterThan(20);
  expect(audit.mainCount, `${path} should expose a main landmark`).toBeGreaterThan(0);
  expect(
    audit.bodyText,
    `${path} should not render a framework runtime error`,
  ).not.toMatch(/application error|runtime error|hydration failed|500 internal|internal server error/i);
  expect(
    audit.horizontalOverflow,
    `${path} should not have page-level horizontal overflow in ${testInfo.project.name}: ${audit.overflowOffenders.join('; ')}`,
  ).toBe(false);
  expect(audit.deadLinks, `${path} should not expose dead/unsafe links`).toEqual([]);
  expect(
    audit.unlabeledControls,
    `${path} should not expose unlabeled button/link controls`,
  ).toEqual([]);
}

function deniedPattern(): RegExp {
  return /Access denied|No (?:warehouse|procurement|legal|admin|module|purchase order) access|don't have access|not available for your role|Page not found|not enrolled/i;
}

function collectConsoleIssues(page: Page): ConsoleIssue[] {
  const issues: ConsoleIssue[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    issues.push({
      type: msg.type(),
      text: msg.text(),
      location: `${msg.location().url}:${msg.location().lineNumber}`,
    });
  });
  page.on('pageerror', (error) => {
    issues.push({
      type: 'pageerror',
      text: error.message,
      location: error.stack ?? 'pageerror',
    });
  });
  return issues;
}

function isAllowedConsoleIssue(issue: ConsoleIssue): boolean {
  return /Failed to load resource.*404|favicon\.ico/i.test(issue.text);
}
