import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CURRENT_LIVE_ROLES } from "./live-e2e-scenarios.mjs";
import {
  buildPersonaPasswords,
  getPersonaSecurityClass,
  provisionUatIntraUsers,
  validateProvisioningInputs,
} from "./provision-uat-intra-test-users.mjs";

const valid = {
  url: "https://uatref.supabase.co",
  serviceKey: "test-service-key",
  password: "Valid-UAT-Password-2026!",
  appEnv: "uat",
  expectedProjectRef: "uatref",
  productionProjectRef: "productionref",
  mutationsApproved: true,
};

const focusedPersonas = [
  {
    role: "employee_test",
    email: "intra.test.employee@mwell.com.ph",
    assignments: { core: ["staff"] },
    departmentCode: "operations",
    kind: "employee",
    title: "Employee tester",
  },
  {
    role: "privileged_test",
    email: "intra.test.privileged@mwell.com.ph",
    assignments: { core: ["staff", "platform_admin"] },
    departmentCode: "technology",
    kind: "employee",
    title: "Privileged tester",
  },
  {
    role: "vendor_test",
    email: "intra.test.vendor.focused@mwell.com.ph",
    assignments: { core: ["vendor_portal"] },
    departmentCode: null,
    kind: "vendor",
    title: "Vendor tester",
  },
];

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: body == null ? undefined : { "Content-Type": "application/json" },
  });
}

function createProvisioningFetch({ wrongFinalRoles = false } = {}) {
  const calls = [];
  const synced = new Set();
  const passwords = new Map();
  const metadata = new Map();
  const users = new Map(
    focusedPersonas.map((persona, index) => [
      `user-${index + 1}`,
      { id: `user-${index + 1}`, email: persona.email },
    ]),
  );
  const personaById = new Map(
    [...users.entries()].map(([id, user]) => [
      id,
      focusedPersonas.find((persona) => persona.email === user.email),
    ]),
  );
  const userIdByEmail = new Map(
    [...users.values()].map((user) => [user.email, user.id]),
  );
  const departmentIds = new Map([
    ["operations", "dept-operations"],
    ["technology", "dept-technology"],
  ]);

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const endpoint = `${url.pathname}${url.search}`;
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ endpoint, method, body });

    if (endpoint === "/auth/v1/admin/users?page=1&per_page=1000") {
      return jsonResponse({
        users: Array.from({ length: 1000 }, (_, index) => ({
          id: `filler-${index}`,
          email: `filler-${index}@example.test`,
        })),
      });
    }
    if (endpoint === "/auth/v1/admin/users?page=2&per_page=1000") {
      return jsonResponse({ users: [...users.values()] });
    }
    if (endpoint.startsWith("/rest/v1/roles?")) {
      return jsonResponse([
        { module: "core", role: "staff", is_active: true },
        { module: "core", role: "platform_admin", is_active: true },
        { module: "core", role: "vendor_portal", is_active: true },
      ]);
    }
    if (endpoint.startsWith("/rest/v1/departments?")) {
      return jsonResponse(
        [...departmentIds].map(([code, id]) => ({ code, id })),
      );
    }
    if (endpoint.startsWith("/rest/v1/vendors?")) {
      return jsonResponse([{ id: "vendor-uat" }]);
    }
    if (method === "PUT" && endpoint.startsWith("/auth/v1/admin/users/")) {
      const id = endpoint.split("/").at(-1);
      passwords.set(id, body.password);
      metadata.set(id, body.app_metadata);
      return jsonResponse({
        id,
        email: body.email,
        app_metadata: body.app_metadata,
      });
    }
    if (method === "POST" && endpoint === "/auth/v1/admin/users") {
      return jsonResponse({ message: "unexpected create" }, 500);
    }
    if (
      method === "POST" &&
      endpoint.startsWith("/rest/v1/profiles?on_conflict=")
    ) {
      return jsonResponse(null, 204);
    }
    if (endpoint.startsWith("/rest/v1/user_roles?select=")) {
      const id = url.searchParams.get("user_id")?.replace("eq.", "");
      if (!synced.has(id)) {
        return jsonResponse([{ module: "legacy", role: "stale" }]);
      }
      const persona = personaById.get(id);
      const roles = Object.entries(persona.assignments).flatMap(
        ([module, values]) => values.map((role) => ({ module, role })),
      );
      return jsonResponse(wrongFinalRoles ? roles.slice(0, 1) : roles);
    }
    if (endpoint.startsWith("/rest/v1/profile_department_scopes?select=")) {
      const id = url.searchParams.get("profile_id")?.replace("eq.", "");
      if (!synced.has(id)) {
        return jsonResponse([
          {
            id: `scope-stale-${id}`,
            department_id: "dept-stale",
            scope_type: "member",
            effective_from: "2026-01-01",
            effective_to: "2099-12-31",
          },
        ]);
      }
      const persona = personaById.get(id);
      return jsonResponse(
        persona.departmentCode
          ? [
              {
                id: `scope-current-${id}`,
                department_id: departmentIds.get(persona.departmentCode),
                scope_type: "member",
                effective_from: "2026-07-18",
                effective_to: null,
              },
            ]
          : [],
      );
    }
    if (
      method === "POST" &&
      endpoint.startsWith("/rest/v1/user_roles?on_conflict=")
    ) {
      return jsonResponse(null, 204);
    }
    if (method === "DELETE" && endpoint.startsWith("/rest/v1/user_roles?")) {
      return jsonResponse(null, 204);
    }
    if (
      method === "POST" &&
      endpoint === "/rest/v1/profile_department_scopes"
    ) {
      return jsonResponse(null, 204);
    }
    if (
      method === "DELETE" &&
      endpoint.startsWith("/rest/v1/profile_department_scopes?id=")
    ) {
      return jsonResponse(null, 204);
    }
    if (
      method === "POST" &&
      endpoint === "/rest/v1/rpc/sync_user_role_claims"
    ) {
      synced.add(body.target_user_id);
      return jsonResponse(null, 204);
    }
    if (method === "GET" && endpoint.startsWith("/auth/v1/admin/users/")) {
      const id = endpoint.split("/").at(-1);
      const user = users.get(id);
      return jsonResponse({ ...user, app_metadata: metadata.get(id) });
    }
    if (method === "GET" && endpoint.startsWith("/rest/v1/profiles?select=")) {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const persona = personaById.get(id);
      return jsonResponse([
        {
          id,
          email: persona.email,
          full_name: `UAT ${persona.role
            .split("_")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")}`,
          kind: persona.kind,
          vendor_id: persona.kind === "vendor" ? "vendor-uat" : null,
          status: "active",
        },
      ]);
    }
    if (
      method === "POST" &&
      endpoint === "/auth/v1/token?grant_type=password"
    ) {
      const id = userIdByEmail.get(body.email);
      assert.equal(body.password, passwords.get(id));
      return jsonResponse({
        user: { id, email: body.email },
        access_token: "test-token",
      });
    }

    return jsonResponse({ message: `Unhandled ${method} ${endpoint}` }, 500);
  };

  return { fetchImpl, calls, passwords };
}

test("covers every active role family plus unified Finance", () => {
  const assignments = new Set(
    CURRENT_LIVE_ROLES.flatMap((persona) =>
      Object.entries(persona.assignments).flatMap(([module, roles]) =>
        roles.map((role) => `${module}:${role}`),
      ),
    ),
  );
  for (const key of [
    "core:platform_admin",
    "core:staff",
    "core:vendor_portal",
    "warehouse:warehouse_operator",
    "warehouse:warehouse_supervisor",
    "warehouse:warehouse_admin",
    "procurement:requester",
    "procurement:procurement_officer",
    "procurement:approver",
    "procurement:finance",
    "procurement:admin",
    "legal:legal_reviewer",
    "legal:compliance",
    "legal:admin",
    "events:requester",
    "events:coordinator",
    "events:viewer",
    "events:admin",
    "insights:analyst",
    "insights:manager",
    "insights:executive",
    "insights:admin",
  ]) {
    assert.ok(assignments.has(key), `missing ${key}`);
  }
  const unified = CURRENT_LIVE_ROLES.find(
    (persona) => persona.role === "finance_unified",
  );
  assert.deepEqual(unified?.assignments, {
    core: ["staff"],
    procurement: ["finance"],
    warehouse: ["finance"],
  });
});

test("derives a unique password for every persona and separates security classes", () => {
  const passwords = buildPersonaPasswords({
    personas: CURRENT_LIVE_ROLES,
    masterPassword: valid.password,
  });
  assert.equal(passwords.size, 31);
  assert.equal(new Set(passwords.values()).size, 31);
  assert.equal(
    getPersonaSecurityClass(
      CURRENT_LIVE_ROLES.find((persona) => persona.role === "platform_admin"),
    ),
    "privileged",
  );
  assert.equal(
    getPersonaSecurityClass(
      CURRENT_LIVE_ROLES.find((persona) => persona.kind === "vendor"),
    ),
    "vendor",
  );
  assert.equal(
    getPersonaSecurityClass(
      CURRENT_LIVE_ROLES.find((persona) => persona.role === "core_staff_only"),
    ),
    "employee",
  );
});

test("accepts explicit per-persona passwords and rejects any shared override", () => {
  const distinct = Object.fromEntries(
    focusedPersonas.map((persona, index) => [
      persona.role,
      `Distinct-${persona.kind}-${index}-Password!A7`,
    ]),
  );
  const resolved = buildPersonaPasswords({
    personas: focusedPersonas,
    personaPasswords: distinct,
  });
  assert.equal(new Set(resolved.values()).size, focusedPersonas.length);

  assert.throws(
    () =>
      buildPersonaPasswords({
        personas: focusedPersonas,
        personaPasswords: Object.fromEntries(
          focusedPersonas.map((persona) => [
            persona.role,
            "Shared-UAT-Password-2026!A",
          ]),
        ),
      }),
    /must not share a password/i,
  );
});

test("rejects weak credentials and production mutation targets", () => {
  assert.throws(
    () => validateProvisioningInputs({ ...valid, password: "weak" }),
    /at least 16 characters/i,
  );
  assert.throws(
    () =>
      validateProvisioningInputs({
        ...valid,
        url: "https://productionref.supabase.co",
        appEnv: "production",
        expectedProjectRef: "productionref",
      }),
    /production/i,
  );
});

test("paginates Auth users, reconciles add-before-prune, verifies state, and never logs passwords", async () => {
  const mock = createProvisioningFetch();
  const logs = [];
  const result = await provisionUatIntraUsers({
    ...valid,
    personas: focusedPersonas,
    fetchImpl: mock.fetchImpl,
    log: (message) => logs.push(message),
  });

  assert.equal(result.provisioned.length, focusedPersonas.length);
  assert.equal(mock.passwords.size, focusedPersonas.length);
  assert.equal(new Set(mock.passwords.values()).size, focusedPersonas.length);
  assert.ok(
    mock.calls.some(
      (call) => call.endpoint === "/auth/v1/admin/users?page=2&per_page=1000",
    ),
    "expected second Auth page to be read",
  );
  assert.equal(
    mock.calls.filter(
      (call) =>
        call.method === "POST" && call.endpoint === "/auth/v1/admin/users",
    ).length,
    0,
    "an account found after the first 1,000 users must be updated, not recreated",
  );

  for (const [userId, password] of mock.passwords) {
    assert.ok(logs.every((line) => !line.includes(password)));
    const roleAdd = mock.calls.findIndex(
      (call) =>
        call.method === "POST" &&
        call.endpoint.startsWith("/rest/v1/user_roles?on_conflict=") &&
        call.body.some((row) => row.user_id === userId),
    );
    const rolePrune = mock.calls.findIndex(
      (call) =>
        call.method === "DELETE" &&
        call.endpoint.startsWith(`/rest/v1/user_roles?user_id=eq.${userId}`),
    );
    assert.ok(
      roleAdd >= 0 && rolePrune > roleAdd,
      "roles must be added before stale roles are pruned",
    );
  }

  for (const userId of ["user-1", "user-2"]) {
    const scopeAdd = mock.calls.findIndex(
      (call) =>
        call.method === "POST" &&
        call.endpoint === "/rest/v1/profile_department_scopes" &&
        call.body.profile_id === userId,
    );
    const scopePrune = mock.calls.findIndex(
      (call) =>
        call.method === "DELETE" &&
        call.endpoint ===
          `/rest/v1/profile_department_scopes?id=eq.scope-stale-${userId}`,
    );
    assert.ok(
      scopeAdd >= 0 && scopePrune > scopeAdd,
      "scope must be added before stale scope is pruned",
    );
  }
});

test("fails provisioning when exact postcondition verification detects role drift", async () => {
  const mock = createProvisioningFetch({ wrongFinalRoles: true });
  await assert.rejects(
    () =>
      provisionUatIntraUsers({
        ...valid,
        personas: focusedPersonas,
        fetchImpl: mock.fetchImpl,
        log: () => {},
      }),
    /Postcondition failed.*database roles do not match exactly/i,
  );
});

test("keeps credentials out of the provisioning source", async () => {
  const source = await readFile(
    new URL("./provision-uat-intra-test-users.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /service_role\s*[=:]\s*["'][A-Za-z0-9._-]+/i);
  assert.doesNotMatch(source, /MWELL_UAT_TEST_PASSWORD\s*[=:]\s*["'][^"']+/);
  assert.doesNotMatch(source, /Valid-UAT-Password-2026!/);
});
