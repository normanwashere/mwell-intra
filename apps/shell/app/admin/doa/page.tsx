"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  ModuleHero,
  useToast,
} from "@intra/ui";
import { can } from "@intra/rbac";
import { useSession } from "@intra/auth";
import { createSupabaseBrowserClient } from "@shell/lib/supabase/client";

type Tier =
  "dept_head" | "procurement_head" | "finance" | "legal" | "final_approver";
interface MatrixRow {
  id: string;
  department: string;
  version: string;
  status: "draft" | "active" | "superseded" | "expired";
  effective_at: string;
  active: boolean;
  source_document: string | null;
}
interface ProfileRow {
  id: string;
  full_name: string | null;
  title: string | null;
}
interface AssignmentDraft {
  key: string;
  tier: Tier;
  category: string;
  minAmount: string;
  maxAmount: string;
  approverUserId: string;
}

const TIERS: readonly Tier[] = [
  "dept_head",
  "procurement_head",
  "legal",
  "finance",
  "final_approver",
];
const assignment = (tier: Tier = "dept_head"): AssignmentDraft => ({
  key: crypto.randomUUID(),
  tier,
  category: "",
  minAmount: "0",
  maxAmount: "",
  approverUserId: "",
});

export default function DoaAdministrationPage() {
  const { userRoles, loading } = useSession();
  const allowed =
    can(userRoles, "core", "manage_rbac") ||
    can(userRoles, "legal", "manage_doa");
  if (loading) return null;
  if (!allowed)
    return (
      <div
        role="alert"
        className="rounded-xl border border-line bg-surface p-6 text-center"
      >
        <h1 className="text-title font-semibold text-ink">Access denied</h1>
        <p className="mt-2 text-sm text-muted">
          You are not authorized to configure Delegation of Authority.
        </p>
      </div>
    );
  return <DoaWorkspace />;
}

function DoaWorkspace() {
  const { mode } = useSession();
  const toast = useToast();
  const procurement = useMemo(
    () => createSupabaseBrowserClient("procurement"),
    [],
  );
  const core = useMemo(() => createSupabaseBrowserClient("core"), []);
  const [matrices, setMatrices] = useState<MatrixRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [department, setDepartment] = useState("");
  const [version, setVersion] = useState("");
  const [sourceDocument, setSourceDocument] = useState(
    "Mwell approved DOA schedule",
  );
  const [effectiveAt, setEffectiveAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([
    assignment(),
    assignment("final_approver"),
  ]);
  const [saving, setSaving] = useState(false);
  const [loadingRevision, setLoadingRevision] = useState<string | null>(null);
  const [captureActivationDraft, setCaptureActivationDraft] = useState(false);

  useEffect(() => {
    setCaptureActivationDraft(
      window.sessionStorage.getItem("intra.evidence-scenario") ===
        "doa-activation",
    );
  }, []);

  const load = useCallback(async () => {
    if (mode !== "supabase" || !procurement || !core) {
      setMatrices([
        {
          id: captureActivationDraft ? "evidence-draft" : "preview",
          department: "Operations",
          version: captureActivationDraft ? "OPS-DOA-2026.2" : "Preview 1",
          status: "draft",
          effective_at: effectiveAt,
          active: false,
          source_document: "Preview source",
        },
      ]);
      return;
    }
    const [matrixResult, profileResult] = await Promise.all([
      procurement
        .from("doa_matrices")
        .select(
          "id,department,version,status,effective_at,active,source_document",
        )
        .order("department"),
      core
        .from("profiles")
        .select("id,full_name,title")
        .eq("kind", "employee")
        .eq("status", "active")
        .order("full_name"),
    ]);
    if (matrixResult.error || profileResult.error) {
      toast.error(
        matrixResult.error?.message ??
          profileResult.error?.message ??
          "Unable to load DOA configuration",
      );
      return;
    }
    setMatrices((matrixResult.data ?? []) as unknown as MatrixRow[]);
    setProfiles((profileResult.data ?? []) as unknown as ProfileRow[]);
  }, [captureActivationDraft, core, effectiveAt, mode, procurement, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const updateAssignment = (key: string, patch: Partial<AssignmentDraft>) =>
    setAssignments((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const save = async () => {
    if (!department.trim() || !version.trim())
      return toast.error("Department and version are required.");
    if (assignments.some((row) => !row.approverUserId))
      return toast.error("Select a named approver for every assignment.");
    if (!assignments.some((row) => row.tier === "final_approver"))
      return toast.error("Add at least one final approver.");
    if (mode !== "supabase" || !procurement)
      return toast.toast(
        "Preview mode is read-only. Connect Supabase to save a matrix.",
      );
    setSaving(true);
    const { data, error } = await procurement.rpc("save_doa_matrix", {
      payload: {
        department: department.trim(),
        version: version.trim(),
        source_document: sourceDocument.trim(),
        effective_at: new Date(`${effectiveAt}T00:00:00+08:00`).toISOString(),
        assignments: assignments.map((row) => ({
          tier: row.tier,
          category: row.category.trim() || null,
          min_amount: Number(row.minAmount),
          max_amount: row.maxAmount ? Number(row.maxAmount) : null,
          approver_user_id: row.approverUserId,
        })),
      },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    const saved = data as unknown as MatrixRow;
    toast.success(`${saved.department} DOA saved as draft.`);
    await load();
  };

  const activate = async (matrix: MatrixRow) => {
    if (mode === "memory" && matrix.id === "evidence-draft") {
      setMatrices((rows) =>
        rows.map((row) =>
          row.id === matrix.id
            ? { ...row, active: true, status: "active" }
            : row,
        ),
      );
      toast.success(`${matrix.department} DOA activated.`);
      return;
    }
    if (!procurement || mode !== "supabase") return;
    if (
      !window.confirm(
        `Activate ${matrix.version} for ${matrix.department}? The current active matrix will be superseded.`,
      )
    )
      return;
    const { error } = await procurement.rpc("activate_doa_matrix", {
      payload: { id: matrix.id },
    });
    if (error) return toast.error(error.message);
    toast.success(`${matrix.department} DOA activated.`);
    await load();
  };

  const createRevision = async (matrix: MatrixRow) => {
    if (!procurement || mode !== "supabase") return;
    setLoadingRevision(matrix.id);
    const { data, error } = await procurement
      .from("doa_assignments")
      .select("tier,category,min_amount,max_amount,approver_user_id")
      .eq("matrix_id", matrix.id)
      .eq("active", true)
      .order("created_at");
    setLoadingRevision(null);
    if (error) return toast.error(error.message);
    if (!data?.length)
      return toast.error("This matrix has no active assignments to revise.");

    setDepartment(matrix.department);
    setVersion(`${matrix.version}-REV`);
    setSourceDocument(matrix.source_document ?? "Mwell approved DOA schedule");
    setEffectiveAt(new Date().toISOString().slice(0, 10));
    setAssignments(
      data.map((row) => ({
        key: crypto.randomUUID(),
        tier: row.tier as Tier,
        category: typeof row.category === "string" ? row.category : "",
        minAmount: String(row.min_amount ?? 0),
        maxAmount: row.max_amount == null ? "" : String(row.max_amount),
        approverUserId:
          typeof row.approver_user_id === "string" ? row.approver_user_id : "",
      })),
    );
    document
      .getElementById("doa-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.toast(
      `Loaded ${matrix.department}. Update the version and assignments, then save a new draft.`,
    );
  };

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <ModuleHero
        eyebrow="Intra governance"
        title="Delegation of Authority"
        description="Maintain department-specific approval ladders. Configuration access never grants approval authority."
        icon="clipboard"
      />
      <section aria-labelledby="coverage-heading">
        <h2
          id="coverage-heading"
          className="mb-3 text-lg font-semibold text-ink"
        >
          Department coverage
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {matrices.map((matrix) => (
            <Card key={matrix.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink">
                    {matrix.department}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {matrix.version} · Effective{" "}
                    {new Date(matrix.effective_at).toLocaleDateString("en-PH")}
                  </p>
                </div>
                <Badge tone={matrix.active ? "emerald" : "amber"}>
                  {matrix.status}
                </Badge>
              </div>
              {matrix.id !== "preview" && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="w-full sm:w-auto"
                    size="sm"
                    variant="outline"
                    disabled={loadingRevision === matrix.id}
                    onClick={() => void createRevision(matrix)}
                  >
                    {loadingRevision === matrix.id
                      ? "Loading..."
                      : "Create revision"}
                  </Button>
                  {matrix.status === "draft" && (
                    <Button
                      className="w-full sm:w-auto"
                      size="sm"
                      variant="outline"
                      onClick={() => void activate(matrix)}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
          {matrices.length === 0 && (
            <p className="text-sm text-muted">
              No department matrices are configured yet.
            </p>
          )}
        </div>
      </section>
      <div id="doa-editor" className="scroll-mt-24">
        <Card className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-ink">
            Create department matrix
          </h2>
          <p className="mt-1 text-sm text-muted">
            Save as draft, resolve validation issues, then activate
            deliberately.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Department">
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Operations"
              />
            </Field>
            <Field label="Version">
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. OPS-DOA-2026.1"
              />
            </Field>
            <Field label="Source document">
              <Input
                value={sourceDocument}
                onChange={(e) => setSourceDocument(e.target.value)}
              />
            </Field>
            <Field label="Effective date">
              <Input
                type="date"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-ink">Named assignments</h3>
              <Button
                size="sm"
                variant="outline"
                icon="plus"
                onClick={() =>
                  setAssignments((rows) => [...rows, assignment()])
                }
              >
                Add tier
              </Button>
            </div>
            {assignments.map((row, index) => (
              <div
                key={row.key}
                className="grid gap-3 rounded-lg border border-line bg-inset p-3 md:grid-cols-[1.1fr_1fr_.7fr_.7fr_1.4fr_auto] md:items-end"
              >
                <Field label={`Tier ${index + 1}`}>
                  <select
                    className="input-base w-full"
                    value={row.tier}
                    onChange={(e) =>
                      updateAssignment(row.key, {
                        tier: e.target.value as Tier,
                      })
                    }
                  >
                    {TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Category (optional)">
                  <Input
                    value={row.category}
                    onChange={(e) =>
                      updateAssignment(row.key, { category: e.target.value })
                    }
                  />
                </Field>
                <Field label="Minimum">
                  <Input
                    type="number"
                    min="0"
                    value={row.minAmount}
                    onChange={(e) =>
                      updateAssignment(row.key, { minAmount: e.target.value })
                    }
                  />
                </Field>
                <Field label="Maximum">
                  <Input
                    type="number"
                    min="0"
                    value={row.maxAmount}
                    onChange={(e) =>
                      updateAssignment(row.key, { maxAmount: e.target.value })
                    }
                    placeholder="No limit"
                  />
                </Field>
                <Field label="Named approver">
                  <select
                    className="input-base w-full"
                    value={row.approverUserId}
                    onChange={(e) =>
                      updateAssignment(row.key, {
                        approverUserId: e.target.value,
                      })
                    }
                  >
                    <option value="">Select employee</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name ?? "Unnamed employee"}
                        {profile.title ? ` · ${profile.title}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={assignments.length <= 1}
                  onClick={() =>
                    setAssignments((rows) =>
                      rows.filter((item) => item.key !== row.key),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              className="w-full sm:w-auto"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving..." : "Save draft"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
