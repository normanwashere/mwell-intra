-- Mwell Intra — RBAC ladder grants reconcile (post-audit fix)
--
-- The multi-tier approval ladder (policy §3/§9) seats procurement_officer
-- (Procurement Head tier), finance (Finance tier), and legal_reviewer
-- (contract-review tier / case decisions) — but the seeded matrix left them
-- without the capability that gates the corresponding UI + RPCs:
--   • procurement:procurement_officer  → + approve_request
--   • procurement:finance              → + approve_request
--   • legal:legal_reviewer             → + approve_accreditation
--
-- Source of truth: packages/rbac (modules/procurement.ts, modules/legal.ts)
-- edited in the same commit. `procurement.decide_request_step`'s tier↔role
-- verification remains the authoritative per-step check; these grants let the
-- right seats through the coarse capability gate.
--
-- Idempotent: on conflict do nothing.

insert into core.role_capabilities (module, role, cap) values
  ('procurement','procurement_officer','approve_request'),
  ('procurement','finance','approve_request'),
  ('legal','legal_reviewer','approve_accreditation')
on conflict do nothing;
