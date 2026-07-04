-- Mwell Intra — Step 3: reconcile provisional procurement/legal RBAC with @intra/rbac
--
-- Patches deployments that already applied the pre-Step-3 seed in
-- 20260706091000_core_seed_rbac.sql. Fresh installs get the corrected matrix from
-- that file directly; this migration is idempotent for them too.
--
-- Source of truth: packages/rbac `toRoleCapabilityRows()` (procurement + legal).

delete from core.role_capabilities where module in ('procurement', 'legal');
delete from core.roles where module in ('procurement', 'legal');
delete from core.capabilities where module in ('procurement', 'legal');

insert into core.capabilities (module, cap) values
  ('procurement','view_dashboard'),
  ('procurement','create_request'),
  ('procurement','manage_rfp'),
  ('procurement','author_po'),
  ('procurement','approve_request'),
  ('procurement','approve_award'),
  ('procurement','manage_vendors'),
  ('procurement','view_finance'),
  ('procurement','admin'),
  ('legal','view_dashboard'),
  ('legal','review_accreditation'),
  ('legal','manage_checklist'),
  ('legal','approve_accreditation'),
  ('legal','manage_documents'),
  ('legal','admin'),
  ('legal','submit_accreditation'),
  ('legal','upload_document'),
  ('legal','view_own_accreditation');

insert into core.roles (module, role, label) values
  ('procurement','requester','Requester'),
  ('procurement','procurement_officer','Procurement Officer'),
  ('procurement','approver','Approver'),
  ('procurement','finance','Finance'),
  ('procurement','admin','Procurement Admin'),
  ('legal','legal_reviewer','Legal Reviewer'),
  ('legal','compliance','Compliance'),
  ('legal','admin','Legal Admin'),
  ('legal','vendor','Vendor (external)');

insert into core.role_capabilities (module, role, cap) values
  ('procurement','requester','view_dashboard'),
  ('procurement','requester','create_request'),
  ('procurement','procurement_officer','view_dashboard'),
  ('procurement','procurement_officer','create_request'),
  ('procurement','procurement_officer','manage_rfp'),
  ('procurement','procurement_officer','author_po'),
  ('procurement','procurement_officer','manage_vendors'),
  ('procurement','approver','view_dashboard'),
  ('procurement','approver','approve_request'),
  ('procurement','approver','approve_award'),
  ('procurement','finance','view_dashboard'),
  ('procurement','finance','view_finance'),
  ('procurement','admin','view_dashboard'),
  ('procurement','admin','create_request'),
  ('procurement','admin','manage_rfp'),
  ('procurement','admin','author_po'),
  ('procurement','admin','approve_request'),
  ('procurement','admin','approve_award'),
  ('procurement','admin','manage_vendors'),
  ('procurement','admin','view_finance'),
  ('procurement','admin','admin'),
  ('legal','legal_reviewer','view_dashboard'),
  ('legal','legal_reviewer','review_accreditation'),
  ('legal','legal_reviewer','manage_checklist'),
  ('legal','legal_reviewer','manage_documents'),
  ('legal','compliance','view_dashboard'),
  ('legal','compliance','review_accreditation'),
  ('legal','compliance','approve_accreditation'),
  ('legal','compliance','manage_documents'),
  ('legal','admin','view_dashboard'),
  ('legal','admin','review_accreditation'),
  ('legal','admin','manage_checklist'),
  ('legal','admin','approve_accreditation'),
  ('legal','admin','manage_documents'),
  ('legal','admin','admin'),
  ('legal','vendor','submit_accreditation'),
  ('legal','vendor','upload_document'),
  ('legal','vendor','view_own_accreditation');
