import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  discardRequestDraft,
  loadLatestRequestDraft,
  saveRequestDraft,
  type RequestDraftClient,
} from "./requestDrafts";
import { validateRequestStep } from "./requestForm";

function clientReturning(data: unknown) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const client: RequestDraftClient = {
    schema: () => ({
      rpc: async (name, args) => {
        calls.push({ name, payload: args.payload });
        return { data, error: null };
      },
    }),
  };
  return { client, calls };
}

describe("purchase request server drafts", () => {
  it("exposes a server draft adapter", async () => {
    const module = await import("./requestDrafts").catch(() => null);

    expect(module).not.toBeNull();
    expect(module?.loadLatestRequestDraft).toBeTypeOf("function");
    expect(module?.saveRequestDraft).toBeTypeOf("function");
    expect(module?.discardRequestDraft).toBeTypeOf("function");
  });

  it("loads and maps the latest owner-scoped draft", async () => {
    const { client, calls } = clientReturning({
      id: "req_draft_12345678",
      client_key: "browser-key",
      draft_version: 4,
      draft_payload: { title: "Recovered request" },
      updated_at: "2026-07-22T02:00:00Z",
    });

    await expect(loadLatestRequestDraft(client)).resolves.toEqual({
      id: "req_draft_12345678",
      clientKey: "browser-key",
      version: 4,
      payload: { title: "Recovered request" },
      updatedAt: "2026-07-22T02:00:00Z",
    });
    expect(calls).toEqual([{ name: "get_latest_request_draft", payload: {} }]);
  });

  it("sends an idempotent client key and optimistic version when autosaving", async () => {
    const { client, calls } = clientReturning({
      id: "req_draft_12345678",
      client_key: "browser-key",
      draft_version: 5,
      draft_payload: { title: "Updated" },
      updated_at: "2026-07-22T02:01:00Z",
    });

    await saveRequestDraft(client, {
      clientKey: "browser-key",
      expectedVersion: 4,
      payload: { title: "Updated" },
    });

    expect(calls).toEqual([{
      name: "save_request_draft",
      payload: {
        client_key: "browser-key",
        expected_version: 4,
        draft: { title: "Updated" },
      },
    }]);
  });

  it("discards only the identified server draft", async () => {
    const { client, calls } = clientReturning(null);

    await discardRequestDraft(client, "req_draft_12345678");

    expect(calls).toEqual([{
      name: "discard_request_draft",
      payload: { id: "req_draft_12345678" },
    }]);
  });

  it("defines owner-scoped, optimistic and idempotent draft RPCs", () => {
    const migrationPath = resolve(
      process.cwd(),
      "../../supabase/migrations/20260722120500_procurement_event_workflow_remediation.sql",
    );

    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("procurement.get_latest_request_draft");
    expect(sql).toContain("procurement.save_request_draft");
    expect(sql).toContain("procurement.discard_request_draft");
    expect(sql).toContain("procurement.finalize_request_draft");
    expect(sql).toContain("requester_id = auth.uid()");
    expect(sql).toContain("expected_version");
    expect(sql).toContain("draft_payload = v_payload");
    expect(sql).toContain("unique (requester_id, draft_client_key)");
  });

  it("routes an existing server draft through transactional finalization", async () => {
    const module = await import("./requestDrafts");

    expect(module.requestCreationRpc).toBeTypeOf("function");
    expect(module.requestCreationRpc(undefined)).toBe("create_request");
    expect(module.requestCreationRpc("req_draft_12345678")).toBe(
      "finalize_request_draft",
    );
  });

  it("wires autosave, resume, discard, and field-level recovery into the wizard", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/pages/CreateRequestPage.tsx"),
      "utf8",
    );

    expect(source).toContain("loadLatestRequestDraft");
    expect(source).toContain("saveRequestDraft");
    expect(source).toContain("discardRequestDraft");
    expect(source).toContain('aria-invalid={Boolean(fieldErrors.title)}');
    expect(source).toContain("firstInvalidSelector");
    expect(source).toContain("target.focus()");
  });
});

describe("purchase request mobile validation", () => {
  it("exposes field-specific step validation", async () => {
    const module = await import("./requestForm").catch(() => null);

    expect(module).not.toBeNull();
    expect(module?.validateRequestStep).toBeTypeOf("function");
  });

  it("identifies every missing step-one field and focuses category first", () => {
    expect(validateRequestStep(1, {
      title: "",
      category: "",
      lines: [{ description: "", quantity: "1" }],
      needDescription: "",
    })).toEqual({
      fieldErrors: {
        category: "Pick a purchase category.",
        title: "Enter a request title.",
        lines: "Describe at least one line item.",
      },
      firstInvalidSelector: '[name="category"]',
    });
  });

  it("identifies the justification field on step two", () => {
    expect(validateRequestStep(2, {
      title: "Request",
      category: "goods",
      lines: [{ description: "Tablet", quantity: "1" }],
      needDescription: "",
    })).toEqual({
      fieldErrors: { needDescription: "Describe the business need." },
      firstInvalidSelector: "#need-description",
    });
  });
});
