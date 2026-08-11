import { describe, expect, it } from "vitest";
import {
  auditActorLabel,
  auditEntityLabel,
  auditEventSummary,
  humanizeAuditToken,
} from "./auditPresentation";

describe("audit presentation", () => {
  it("turns implementation tokens into readable labels", () => {
    expect(humanizeAuditToken("role_assignment.created")).toBe(
      "Role assignment created",
    );
    expect(
      auditEventSummary({
        module: "core",
        entity_type: "department_scope",
        entity_id: "scope_123",
        action: "role_assignment.created",
        actor: "profile_1",
      }),
    ).toBe("Role assignment created department scope");
  });

  it("keeps raw identifiers out of the primary actor and entity labels", () => {
    const actors = new Map([["profile_1", "Avery Santos"]]);
    expect(auditActorLabel("profile_1", actors)).toBe("Avery Santos");
    expect(auditActorLabel("profile_missing", actors)).toBe(
      "Unavailable account",
    );
    expect(auditActorLabel("", actors)).toBe("System process");
    expect(
      auditEntityLabel({
        module: "core",
        entity_type: "department_scope",
        entity_id: "scope_123",
        action: "updated",
        actor: "profile_1",
      }),
    ).toBe("Department scope");
  });

  it("presents legacy audit rows with null fields without crashing", () => {
    const row = {
      module: null,
      entity_type: null,
      entity_id: null,
      action: null,
      actor: null,
    };
    expect(auditEventSummary(row)).toBe("Activity recorded");
    expect(auditEntityLabel(row)).toBe("Governed record");
    expect(auditActorLabel(row.actor, new Map())).toBe("System process");
  });
});
