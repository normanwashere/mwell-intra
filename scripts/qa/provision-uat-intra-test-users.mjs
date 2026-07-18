#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertApprovedMutationTarget } from "../lib/target-environment.mjs";
import { CURRENT_LIVE_ROLES } from "./live-e2e-scenarios.mjs";

const REQUIRED_PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/;
const AUTH_PAGE_SIZE = 1000;

function titleCase(value) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeAssignments(assignments) {
  return Object.fromEntries(
    Object.entries(assignments)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([module, roles]) => [module, [...roles].sort()]),
  );
}

function assignmentKeys(assignments) {
  return Object.entries(assignments).flatMap(([module, roles]) =>
    roles.map((role) => `${module}:${role}`),
  );
}

export function getPersonaSecurityClass(persona) {
  if (persona.kind === "vendor") return "vendor";
  const isPrivileged = assignmentKeys(persona.assignments).some((key) => {
    const role = key.slice(key.indexOf(":") + 1);
    return (
      role === "platform_admin" || role === "admin" || role.endsWith("_admin")
    );
  });
  return isPrivileged ? "privileged" : "employee";
}

function configuredPassword(personaPasswords, persona) {
  if (!personaPasswords) return null;
  if (typeof personaPasswords === "function") {
    return personaPasswords(persona) ?? null;
  }
  if (personaPasswords instanceof Map) {
    return (
      personaPasswords.get(persona.role) ??
      personaPasswords.get(persona.email) ??
      null
    );
  }
  return (
    personaPasswords[persona.role] ?? personaPasswords[persona.email] ?? null
  );
}

export function resolveSharedUatPassword(masterPassword) {
  if (!REQUIRED_PASSWORD_PATTERN.test(masterPassword ?? "")) {
    throw new Error(
      "MWELL_UAT_TEST_PASSWORD must be at least 16 characters and include upper, lower, numeric, and symbol characters.",
    );
  }
  return masterPassword;
}

export function buildPersonaPasswords({
  personas = CURRENT_LIVE_ROLES,
  masterPassword,
  personaPasswords,
}) {
  const sharedPassword = resolveSharedUatPassword(masterPassword);
  const resolved = new Map();

  for (const persona of personas) {
    const configured = configuredPassword(personaPasswords, persona);
    if (configured && configured !== sharedPassword) {
      throw new Error(
        `Password configured for ${persona.role} must match the shared UAT password.`,
      );
    }
    const password = sharedPassword;
    if (!REQUIRED_PASSWORD_PATTERN.test(password)) {
      throw new Error(
        `Password configured for ${persona.role} does not meet the UAT password policy.`,
      );
    }
    resolved.set(persona.email.toLowerCase(), password);
  }

  return resolved;
}

async function retireObsoleteTestPersona({
  request,
  schemaHeaders,
  user,
  log,
}) {
  const originalEmail = user.email?.toLowerCase() ?? "unknown";
  try {
    await request(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    log(`Removed obsolete UAT identity ${originalEmail}.`);
    return;
  } catch (error) {
    // Historical workflow records can intentionally restrict hard deletion.
    // In that case anonymize and disable the identity while preserving audit FKs.
    const retiredEmail = `retired.${user.id}@invalid.mwell.local`;
    await request(`/rest/v1/user_roles?user_id=eq.${user.id}`, {
      method: "DELETE",
      headers: schemaHeaders("core"),
    });
    await request(
      `/rest/v1/profile_department_scopes?profile_id=eq.${user.id}`,
      {
        method: "DELETE",
        headers: schemaHeaders("core"),
      },
    );
    await request(`/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers: schemaHeaders("core", "return=minimal"),
      body: JSON.stringify({
        email: retiredEmail,
        full_name: "Retired UAT identity",
        title: "Retired UAT identity",
        status: "inactive",
      }),
    });
    await request(`/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({
        email: retiredEmail,
        ban_duration: "876000h",
        app_metadata: { kind: "employee", roles: {} },
        user_metadata: { full_name: "Retired UAT identity" },
      }),
    });
    log(
      `Disabled obsolete UAT identity ${originalEmail}; hard deletion was restricted by retained audit history.`,
    );
  }
}

export function validateProvisioningInputs({
  url,
  serviceKey,
  password,
  personaPasswords,
  personas = CURRENT_LIVE_ROLES,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
  mutationsApproved,
}) {
  assertApprovedMutationTarget({
    appEnv,
    supabaseUrl: url,
    expectedProjectRef,
    productionProjectRef,
    mutationsRequested: true,
    mutationsApproved,
  });
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  buildPersonaPasswords({
    personas,
    masterPassword: password,
    personaPasswords,
  });
}

export async function listAllAuthUsers(request, pageSize = AUTH_PAGE_SIZE) {
  const users = [];
  let page = 1;

  while (true) {
    const payload = await request(
      `/auth/v1/admin/users?page=${page}&per_page=${pageSize}`,
    );
    const pageUsers = payload?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < pageSize) break;
    page += 1;
  }

  return users;
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

function assertPostcondition(condition, persona, detail) {
  if (!condition) {
    throw new Error(`Postcondition failed for ${persona.role}: ${detail}.`);
  }
}

function isActiveScope(scope, today = new Date().toISOString().slice(0, 10)) {
  return (
    (scope.effective_from == null || scope.effective_from <= today) &&
    (scope.effective_to == null || scope.effective_to >= today)
  );
}

async function readAuthorizationState(request, schemaHeaders, userId) {
  const [roles, scopes] = await Promise.all([
    request(`/rest/v1/user_roles?select=module,role&user_id=eq.${userId}`, {
      headers: schemaHeaders("core"),
    }),
    request(
      `/rest/v1/profile_department_scopes?select=id,department_id,scope_type,effective_from,effective_to&profile_id=eq.${userId}`,
      { headers: schemaHeaders("core") },
    ),
  ]);
  return { roles, scopes };
}

async function reconcileAuthorization({
  request,
  schemaHeaders,
  userId,
  persona,
  departmentByCode,
}) {
  const before = await readAuthorizationState(request, schemaHeaders, userId);
  const desiredAssignments = Object.entries(persona.assignments).flatMap(
    ([module, roles]) =>
      roles.map((role) => ({ user_id: userId, module, role })),
  );
  const desiredRoleKeys = new Set(
    desiredAssignments.map(({ module, role }) => `${module}:${role}`),
  );

  if (desiredAssignments.length > 0) {
    await request("/rest/v1/user_roles?on_conflict=user_id,module,role", {
      method: "POST",
      headers: schemaHeaders(
        "core",
        "resolution=merge-duplicates,return=minimal",
      ),
      body: JSON.stringify(desiredAssignments),
    });
  }
  for (const row of before.roles) {
    if (!desiredRoleKeys.has(`${row.module}:${row.role}`)) {
      await request(
        `/rest/v1/user_roles?user_id=eq.${userId}&module=eq.${encodeURIComponent(row.module)}&role=eq.${encodeURIComponent(row.role)}`,
        { method: "DELETE", headers: schemaHeaders("core") },
      );
    }
  }

  const desiredDepartmentId = persona.departmentCode
    ? departmentByCode.get(persona.departmentCode)
    : null;
  const desiredScopeExists = before.scopes.some(
    (scope) =>
      scope.department_id === desiredDepartmentId &&
      scope.scope_type === "member" &&
      isActiveScope(scope),
  );
  if (desiredDepartmentId && !desiredScopeExists) {
    await request("/rest/v1/profile_department_scopes", {
      method: "POST",
      headers: schemaHeaders("core", "return=minimal"),
      body: JSON.stringify({
        profile_id: userId,
        department_id: desiredDepartmentId,
        scope_type: "member",
      }),
    });
  }
  for (const scope of before.scopes) {
    const isDesiredActiveScope =
      scope.department_id === desiredDepartmentId &&
      scope.scope_type === "member" &&
      isActiveScope(scope);
    if (isActiveScope(scope) && !isDesiredActiveScope) {
      await request(`/rest/v1/profile_department_scopes?id=eq.${scope.id}`, {
        method: "DELETE",
        headers: schemaHeaders("core"),
      });
    }
  }
}

async function verifyPersonaPostconditions({
  request,
  authRequest,
  schemaHeaders,
  persona,
  user,
  password,
  fullName,
  vendorId,
  departmentByCode,
}) {
  const [authUser, profiles, authorization, signIn] = await Promise.all([
    request(`/auth/v1/admin/users/${user.id}`),
    request(
      `/rest/v1/profiles?select=id,email,full_name,kind,vendor_id,status&id=eq.${user.id}`,
      { headers: schemaHeaders("core") },
    ),
    readAuthorizationState(request, schemaHeaders, user.id),
    authRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: persona.email.toLowerCase(), password }),
    }),
  ]);
  const profile = profiles[0];
  const expectedRoleKeys = new Set(assignmentKeys(persona.assignments));
  const actualRoleKeys = new Set(
    authorization.roles.map(({ module, role }) => `${module}:${role}`),
  );
  const activeScopes = authorization.scopes.filter((scope) =>
    isActiveScope(scope),
  );
  const expectedDepartmentId = persona.departmentCode
    ? departmentByCode.get(persona.departmentCode)
    : null;

  assertPostcondition(
    authUser.id === user.id,
    persona,
    "Auth identity does not match",
  );
  assertPostcondition(
    authUser.email?.toLowerCase() === persona.email.toLowerCase(),
    persona,
    "Auth email does not match",
  );
  assertPostcondition(
    authUser.app_metadata?.kind === persona.kind,
    persona,
    "Auth identity kind does not match",
  );
  assertPostcondition(
    JSON.stringify(normalizeAssignments(authUser.app_metadata?.roles ?? {})) ===
      JSON.stringify(normalizeAssignments(persona.assignments)),
    persona,
    "Auth role claims do not match",
  );
  assertPostcondition(
    signIn?.user?.id === user.id,
    persona,
    "password sign-in did not return the expected user",
  );
  assertPostcondition(
    profile?.email?.toLowerCase() === persona.email.toLowerCase(),
    persona,
    "profile email does not match",
  );
  assertPostcondition(
    profile?.full_name === fullName,
    persona,
    "profile name does not match",
  );
  assertPostcondition(
    profile?.kind === persona.kind && profile?.status === "active",
    persona,
    "profile kind or status does not match",
  );
  assertPostcondition(
    (profile?.vendor_id ?? null) ===
      (persona.kind === "vendor" ? vendorId : null),
    persona,
    "profile vendor binding does not match",
  );
  assertPostcondition(
    setsEqual(actualRoleKeys, expectedRoleKeys),
    persona,
    "database roles do not match exactly",
  );
  assertPostcondition(
    expectedDepartmentId
      ? activeScopes.length === 1 &&
          activeScopes[0].department_id === expectedDepartmentId &&
          activeScopes[0].scope_type === "member"
      : activeScopes.length === 0,
    persona,
    "active department scope does not match exactly",
  );
}

export async function provisionUatIntraUsers({
  url,
  serviceKey,
  password,
  personaPasswords,
  personas = CURRENT_LIVE_ROLES,
  appEnv,
  expectedProjectRef,
  productionProjectRef,
  mutationsApproved,
  fetchImpl = fetch,
  log = console.log,
}) {
  validateProvisioningInputs({
    url,
    serviceKey,
    password,
    personaPasswords,
    personas,
    appEnv,
    expectedProjectRef,
    productionProjectRef,
    mutationsApproved,
  });
  const resolvedPasswords = buildPersonaPasswords({
    personas,
    masterPassword: password,
    personaPasswords,
  });

  const baseUrl = url.replace(/\/$/, "");
  const privilegedHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const executeRequest = async (endpoint, options, defaultHeaders) => {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers },
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const detail = bodyText.slice(0, 400) || response.statusText;
      throw new Error(
        `${options.method ?? "GET"} ${endpoint} failed (${response.status}): ${detail}`,
      );
    }
    return bodyText ? JSON.parse(bodyText) : null;
  };
  const request = (endpoint, options = {}) =>
    executeRequest(endpoint, options, privilegedHeaders);
  const authRequest = (endpoint, options = {}) =>
    executeRequest(endpoint, options, {
      apikey: serviceKey,
      "Content-Type": "application/json",
    });
  const schemaHeaders = (schema, prefer) => ({
    "Accept-Profile": schema,
    "Content-Profile": schema,
    ...(prefer ? { Prefer: prefer } : {}),
  });

  const [listedUsers, roleRows, departmentRows] = await Promise.all([
    listAllAuthUsers(request),
    request("/rest/v1/roles?select=module,role,is_active", {
      headers: schemaHeaders("core"),
    }),
    request("/rest/v1/departments?select=id,code&is_active=eq.true", {
      headers: schemaHeaders("core"),
    }),
  ]);
  const liveRoleKeys = new Set(
    roleRows
      .filter((row) => row.is_active)
      .map((row) => `${row.module}:${row.role}`),
  );
  const departmentByCode = new Map(
    departmentRows.map((row) => [row.code, row.id]),
  );

  for (const persona of personas) {
    if (!persona.email.startsWith("intra.test.")) {
      throw new Error(
        `Refusing to provision non-test identity ${persona.email}.`,
      );
    }
    for (const key of assignmentKeys(persona.assignments)) {
      if (!liveRoleKeys.has(key)) {
        throw new Error(
          `Persona ${persona.role} references inactive or missing role ${key}.`,
        );
      }
    }
    if (
      persona.departmentCode &&
      !departmentByCode.has(persona.departmentCode)
    ) {
      throw new Error(
        `Persona ${persona.role} references missing department ${persona.departmentCode}.`,
      );
    }
  }

  let vendorId = null;
  const vendorPersona = personas.find((persona) => persona.kind === "vendor");
  if (vendorPersona) {
    const vendorName = "MWELL UAT Test Vendor";
    const existingVendors = await request(
      `/rest/v1/vendors?select=id&legal_name=eq.${encodeURIComponent(vendorName)}&limit=1`,
      { headers: schemaHeaders("core") },
    );
    if (existingVendors.length > 0) {
      vendorId = existingVendors[0].id;
    } else {
      const inserted = await request("/rest/v1/vendors", {
        method: "POST",
        headers: schemaHeaders("core", "return=representation"),
        body: JSON.stringify({
          legal_name: vendorName,
          trade_name: "MWELL UAT Vendor",
          tin: "UAT-TEST-0001",
          category: "technology_services",
          accreditation_status: "draft",
          owner_module: "legal",
        }),
      });
      vendorId = inserted[0]?.id ?? null;
    }
    if (!vendorId)
      throw new Error("UAT vendor identity could not be provisioned.");
  }

  const usersByEmail = new Map(
    listedUsers.map((user) => [user.email?.toLowerCase(), user]),
  );
  const provisioned = [];

  for (const persona of personas) {
    const email = persona.email.toLowerCase();
    const personaPassword = resolvedPasswords.get(email);
    const fullName = `UAT ${titleCase(persona.role)}`;
    const appMetadata = {
      kind: persona.kind,
      roles: persona.assignments,
      ...(persona.kind === "vendor" ? { vendor_id: vendorId } : {}),
    };
    const attributes = {
      email,
      password: personaPassword,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { full_name: fullName },
    };
    const existing = usersByEmail.get(email);
    const user = existing
      ? await request(`/auth/v1/admin/users/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify(attributes),
        })
      : await request("/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify(attributes),
        });

    await request("/rest/v1/profiles?on_conflict=id", {
      method: "POST",
      headers: schemaHeaders(
        "core",
        "resolution=merge-duplicates,return=minimal",
      ),
      body: JSON.stringify({
        id: user.id,
        email,
        full_name: fullName,
        title: persona.title,
        kind: persona.kind,
        vendor_id: persona.kind === "vendor" ? vendorId : null,
        status: "active",
      }),
    });

    await reconcileAuthorization({
      request,
      schemaHeaders,
      userId: user.id,
      persona,
      departmentByCode,
    });
    await request("/rest/v1/rpc/sync_user_role_claims", {
      method: "POST",
      headers: schemaHeaders("core"),
      body: JSON.stringify({ target_user_id: user.id }),
    });
    await verifyPersonaPostconditions({
      request,
      authRequest,
      schemaHeaders,
      persona,
      user,
      password: personaPassword,
      fullName,
      vendorId,
      departmentByCode,
    });

    provisioned.push({ role: persona.role, email, userId: user.id });
    log(`Provisioned and verified ${email} as ${persona.role}.`);
  }

  const desiredEmails = new Set(
    personas.map((persona) => persona.email.toLowerCase()),
  );
  const obsoleteTestUsers = listedUsers.filter((user) => {
    const email = user.email?.toLowerCase() ?? "";
    return email.startsWith("intra.test.") && !desiredEmails.has(email);
  });
  for (const user of obsoleteTestUsers) {
    await retireObsoleteTestPersona({ request, schemaHeaders, user, log });
  }

  const finalTestEmails = (await listAllAuthUsers(request))
    .map((user) => user.email?.toLowerCase() ?? "")
    .filter((email) => email.startsWith("intra.test."));
  if (
    finalTestEmails.length !== desiredEmails.size ||
    finalTestEmails.some((email) => !desiredEmails.has(email))
  ) {
    throw new Error(
      `UAT identity roster does not match the ${desiredEmails.size} approved personas.`,
    );
  }

  return {
    provisioned,
    retired: obsoleteTestUsers.map((user) => user.email?.toLowerCase()),
    vendorId,
  };
}

async function main() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const password =
    process.env.MWELL_UAT_TEST_PASSWORD ?? process.env.AUDIT_PASSWORD ?? "";
  const personaPasswords = process.env.MWELL_UAT_PERSONA_PASSWORDS_JSON
    ? JSON.parse(process.env.MWELL_UAT_PERSONA_PASSWORDS_JSON)
    : undefined;
  const result = await provisionUatIntraUsers({
    url,
    serviceKey,
    password,
    personaPasswords,
    appEnv: process.env.APP_ENV,
    expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
    productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
    mutationsApproved: process.env.POLICY_ALLOW_TEST_MUTATIONS === "true",
  });
  console.log(
    `Provisioned ${result.provisioned.length} guarded UAT personas. Passwords were not printed.`,
  );
}

if (
  typeof process !== "undefined" &&
  typeof process.argv?.[1] === "string" &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
