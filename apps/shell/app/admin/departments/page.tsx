"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Guard, useSession } from "@intra/auth";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  Input,
  ModuleHero,
  Sheet,
  Skeleton,
  useToast,
} from "@intra/ui";

interface Department {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly parent_id: string | null;
  readonly parent_code: string | null;
  readonly is_active: boolean;
  readonly sort_order: number;
  readonly purpose: string | null;
  readonly updated_at: string;
  readonly active_scope_count: number;
  readonly can_deactivate: boolean;
  readonly deactivation_blocked_reason: string | null;
}

interface DepartmentForm {
  id: string | null;
  code: string;
  name: string;
  parentId: string;
  sortOrder: string;
  purpose: string;
  isActive: boolean;
}

const EMPTY_FORM: DepartmentForm = {
  id: null,
  code: "",
  name: "",
  parentId: "",
  sortOrder: "0",
  purpose: "",
  isActive: true,
};

const PREVIEW_DEPARTMENTS: readonly Department[] = [
  ["marketing", "Marketing", null, 10],
  ["sales", "Sales", null, 20],
  ["product", "Product", null, 30],
  ["technology", "Technology", null, 40],
  ["pmo", "Project Management Office", null, 50],
  ["operations", "Operations", null, 60],
  ["operations.warehouse_logistics", "Warehouse & Logistics", "operations", 61],
  ["operations.customer_service", "Customer Service", "operations", 62],
  [
    "operations.client_product_implementation",
    "Client & Product Implementation",
    "operations",
    63,
  ],
  ["finance", "Finance", null, 70],
  ["procurement", "Procurement", null, 80],
  ["legal_compliance", "Legal & Compliance", null, 90],
  ["people_culture", "People & Culture", null, 100],
  ["administration", "Administration", null, 110],
].map(([code, name, parentId, sortOrder]) => ({
  id: String(code),
  code: String(code),
  name: String(name),
  parent_id: parentId ? String(parentId) : null,
  parent_code: parentId ? String(parentId) : null,
  is_active: true,
  sort_order: Number(sortOrder),
  purpose:
    code === "product" ? "Final client and product go-live authority" : null,
  updated_at: "2026-07-14T00:00:00.000Z",
  active_scope_count: 0,
  can_deactivate: true,
  deactivation_blocked_reason: null,
}));

export function descendantIds(
  departments: readonly Department[],
  departmentId: string,
): ReadonlySet<string> {
  const descendants = new Set<string>();
  const queue = [departmentId];
  while (queue.length > 0) {
    const parentId = queue.shift();
    for (const department of departments) {
      if (
        department.parent_id === parentId &&
        !descendants.has(department.id)
      ) {
        descendants.add(department.id);
        queue.push(department.id);
      }
    }
  }
  return descendants;
}

interface DepartmentTreeItem {
  readonly department: Department;
  readonly children: DepartmentTreeItem[];
}

function buildDepartmentTree(
  departments: readonly Department[],
): readonly DepartmentTreeItem[] {
  const nodes = new Map<string, DepartmentTreeItem>();
  for (const department of departments) {
    nodes.set(department.id, { department, children: [] });
  }
  const roots: DepartmentTreeItem[] = [];
  for (const node of nodes.values()) {
    const parent = node.department.parent_id
      ? nodes.get(node.department.parent_id)
      : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: DepartmentTreeItem[]) => {
    items.sort(
      (left, right) =>
        left.department.sort_order - right.department.sort_order ||
        left.department.name.localeCompare(right.department.name),
    );
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}

function DepartmentTreeNode({
  item,
  level,
  parentName,
  isLive,
  saving,
  onAddChild,
  onEdit,
  onDeactivate,
}: {
  item: DepartmentTreeItem;
  level: number;
  parentName: string | null;
  isLive: boolean;
  saving: boolean;
  onAddChild: (departmentId: string) => void;
  onEdit: (department: Department) => void;
  onDeactivate: (department: Department) => void;
}) {
  const { department, children } = item;
  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-expanded={children.length > 0 ? true : undefined}
    >
      <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-2 py-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center bg-inset text-muted">
            <Icon
              name={level === 1 ? "building" : "transfer"}
              className="h-4 w-4"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-ink">
                {department.name}
              </p>
              <Badge tone={department.is_active ? "emerald" : "slate"}>
                {department.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="truncate font-mono text-xs text-faint">
              {department.code} - order {department.sort_order}
            </p>
            <p className="truncate text-xs text-muted">
              {parentName ? `Reports to ${parentName}` : "Top-level department"}
            </p>
            {department.deactivation_blocked_reason && department.is_active && (
              <p className="mt-1 text-xs text-amber-700">
                {department.deactivation_blocked_reason}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            aria-label={`Add child to ${department.name}`}
            title={`Add child to ${department.name}`}
            disabled={!isLive || !department.is_active}
            onClick={() => onAddChild(department.id)}
          >
            <span className="hidden lg:inline">Child</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="edit"
            aria-label={`Edit ${department.name}`}
            title={`Edit ${department.name}`}
            disabled={!isLive}
            onClick={() => onEdit(department)}
          >
            <span className="hidden lg:inline">Edit</span>
          </Button>
          {department.is_active && (
            <Button
              variant="ghost"
              size="sm"
              icon="minus"
              aria-label={`Deactivate ${department.name}`}
              title={
                department.deactivation_blocked_reason ??
                `Deactivate ${department.name}`
              }
              disabled={!isLive || saving || !department.can_deactivate}
              onClick={() => onDeactivate(department)}
            >
              <span className="hidden xl:inline">Deactivate</span>
            </Button>
          )}
        </div>
      </div>
      {children.length > 0 && (
        <ul role="group" className="ml-5 border-l border-line pl-2 sm:ml-7">
          {children.map((child) => (
            <DepartmentTreeNode
              key={child.department.id}
              item={child}
              level={level + 1}
              parentName={department.name}
              isLive={isLive}
              saving={saving}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDeactivate={onDeactivate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DepartmentAdministrationPage() {
  return (
    <Guard module="core" cap="manage_rbac">
      <DepartmentAdministration />
    </Guard>
  );
}

function DepartmentAdministration() {
  const toast = useToast();
  const { mode, supabaseClient } = useSession();
  const isLive = mode === "supabase";
  const supabase = useMemo(
    () => supabaseClient?.schema("core") ?? null,
    [supabaseClient],
  );
  const [departments, setDepartments] = useState<readonly Department[]>(
    isLive ? [] : PREVIEW_DEPARTMENTS,
  );
  const [loading, setLoading] = useState(isLive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<DepartmentForm | null>(null);
  const [pendingDeactivation, setPendingDeactivation] =
    useState<Department | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("list_departments");
    if (rpcError) {
      setError(rpcError.message);
      toast.error(rpcError.message);
    } else {
      setDepartments((data ?? []) as Department[]);
    }
    setLoading(false);
  }, [supabase, toast]);

  useEffect(() => {
    if (isLive) void refresh();
  }, [isLive, refresh]);

  const departmentTree = useMemo(
    () => buildDepartmentTree(departments),
    [departments],
  );
  const editing = form?.id
    ? (departments.find((department) => department.id === form.id) ?? null)
    : null;
  const excludedParents = useMemo(() => {
    if (!form?.id) return new Set<string>();
    return new Set([form.id, ...descendantIds(departments, form.id)]);
  }, [departments, form?.id]);
  const parentOptions = departments.filter(
    (department) => department.is_active && !excludedParents.has(department.id),
  );
  const pendingActiveChildren = pendingDeactivation
    ? departments.filter(
        (department) =>
          department.parent_id === pendingDeactivation.id &&
          department.is_active,
      ).length
    : 0;

  const openCreate = (parentId = "") => {
    setForm({ ...EMPTY_FORM, parentId });
  };

  const openEdit = (department: Department) => {
    setForm({
      id: department.id,
      code: department.code,
      name: department.name,
      parentId: department.parent_id ?? "",
      sortOrder: String(department.sort_order),
      purpose: department.purpose ?? "",
      isActive: department.is_active,
    });
  };

  const save = async () => {
    if (!form || !supabase) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Department code and name are required.");
      return;
    }
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("upsert_department", {
      payload: {
        ...(form.id ? { id: form.id } : {}),
        ...(editing ? { expected_updated_at: editing.updated_at } : {}),
        code: form.code.trim().toLowerCase(),
        name: form.name.trim(),
        parent_id: form.parentId || null,
        sort_order: Number(form.sortOrder) || 0,
        purpose: form.purpose.trim() || null,
        is_active: form.isActive,
      },
    });
    setSaving(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(form.id ? "Department updated." : "Department added.");
    setForm(null);
    await refresh();
  };

  const deactivate = async (department: Department) => {
    if (!supabase || !department.can_deactivate) return;
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("upsert_department", {
      payload: {
        id: department.id,
        expected_updated_at: department.updated_at,
        code: department.code,
        name: department.name,
        parent_id: department.parent_id,
        sort_order: department.sort_order,
        purpose: department.purpose,
        is_active: false,
      },
    });
    setSaving(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(`${department.name} deactivated.`);
    setPendingDeactivation(null);
    if (form?.id === department.id) setForm(null);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Platform administration"
        title="Departments"
        description="Maintain accountable organization units and reporting relationships."
        icon="building"
        action={
          <Button icon="plus" onClick={() => openCreate()} disabled={!isLive}>
            Add department
          </Button>
        }
      />

      {!isLive && (
        <div className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          Demo mode shows the seeded hierarchy. Connect the live identity
          service to make changes.
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="border-l-4 border-rose-500 bg-rose-50 p-4 text-sm text-rose-900"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : departmentTree.length === 0 ? (
        <EmptyState
          icon="building"
          title="No departments configured"
          message="Add the first top-level department to begin the hierarchy."
          action={
            <Button icon="plus" onClick={() => openCreate()}>
              Add department
            </Button>
          }
        />
      ) : (
        <ul
          role="tree"
          aria-label="Department hierarchy"
          className="border-y border-line"
        >
          {departmentTree.map((item) => (
            <DepartmentTreeNode
              key={item.department.id}
              item={item}
              level={1}
              parentName={null}
              isLive={isLive}
              saving={saving}
              onAddChild={openCreate}
              onEdit={openEdit}
              onDeactivate={setPendingDeactivation}
            />
          ))}
        </ul>
      )}

      <Sheet
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        title={editing ? `Edit ${editing.name}` : "Add department"}
        description="Names, hierarchy, ordering, and active status take effect without a deployment."
        side="right"
        footer={
          <Button onClick={() => void save()} disabled={!form || saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        }
      >
        {form && (
          <div className="space-y-5">
            <Field
              label="Code"
              htmlFor="department-code"
              hint="Stable lowercase code; it cannot be changed later."
            >
              <Input
                id="department-code"
                value={form.code}
                disabled={Boolean(form.id)}
                onChange={(event) =>
                  setForm({ ...form, code: event.currentTarget.value })
                }
                placeholder="operations.new_team"
              />
            </Field>
            <Field label="Name" htmlFor="department-name">
              <Input
                id="department-name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.currentTarget.value })
                }
              />
            </Field>
            <Field
              label="Parent"
              htmlFor="department-parent"
              hint="The department itself and all descendants are excluded."
            >
              <select
                id="department-parent"
                className="input"
                value={form.parentId}
                onChange={(event) =>
                  setForm({ ...form, parentId: event.currentTarget.value })
                }
              >
                <option value="">Top level</option>
                {parentOptions.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Sort order"
              htmlFor="department-sort"
              hint="Lower numbers appear first among siblings."
            >
              <Input
                id="department-sort"
                type="number"
                value={form.sortOrder}
                onChange={(event) =>
                  setForm({ ...form, sortOrder: event.currentTarget.value })
                }
              />
            </Field>
            <Field label="Purpose" htmlFor="department-purpose">
              <Input
                id="department-purpose"
                value={form.purpose}
                onChange={(event) =>
                  setForm({ ...form, purpose: event.currentTarget.value })
                }
              />
            </Field>
            {editing && (
              <label className="flex items-start gap-3 border-t border-line pt-4">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={form.isActive}
                  disabled={editing.is_active && !editing.can_deactivate}
                  onChange={(event) => {
                    if (editing.is_active && !event.currentTarget.checked) {
                      setPendingDeactivation(editing);
                      return;
                    }
                    setForm({ ...form, isActive: event.currentTarget.checked });
                  }}
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Active department
                  </span>
                  <span className="block text-xs text-muted">
                    {editing.deactivation_blocked_reason ??
                      "Deactivation preserves this department in historical records."}
                  </span>
                </span>
              </label>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={Boolean(pendingDeactivation)}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingDeactivation(null);
        }}
        title="Confirm deactivation"
        description={
          pendingDeactivation
            ? `Review the impact before deactivating ${pendingDeactivation.name}.`
            : "Review the impact before deactivation."
        }
        side="right"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingDeactivation(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingDeactivation) void deactivate(pendingDeactivation);
              }}
              disabled={!pendingDeactivation || saving}
            >
              {saving ? "Deactivating..." : "Deactivate department"}
            </Button>
          </div>
        }
      >
        {pendingDeactivation && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 border-y border-line py-4">
              <dt className="text-muted">Active child departments</dt>
              <dd className="font-semibold text-ink">
                {pendingActiveChildren}
              </dd>
              <dt className="text-muted">Current or future assignments</dt>
              <dd className="font-semibold text-ink">
                {pendingDeactivation.active_scope_count}
              </dd>
            </dl>
            <p className="text-muted">
              Historical assignments remain available for audit and reporting.
              The department code and prior relationships are retained.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
