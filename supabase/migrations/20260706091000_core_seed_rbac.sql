-- Mwell Intra — seed core.capabilities / core.roles / core.role_capabilities
--
-- ############################################################################
-- ## SOURCE OF TRUTH / SYNC CONTRACT (spec §6.6)                            ##
-- ## The RBAC matrices are OWNED by the `@intra/rbac` package (Step 1b) via ##
-- ## its `toRoleCapabilityRows()` export. TypeScript cannot be imported     ##
-- ## into SQL, so this seed is a HAND-MIRROR of that matrix and MUST STAY   ##
-- ## IN SYNC with it. When @intra/rbac changes, update this file too.       ##
-- ##                                                                        ##
-- ## Reconciliation checklist for @intra/rbac.toRoleCapabilityRows():       ##
-- ##  * WAREHOUSE rows below are an EXACT mirror of the warehouse matrix     ##
-- ##    (mwell-intra-warehouse/src/auth/roles.ts, docs/LLD.md §9) and now    ##
-- ##    MATCH @intra/rbac exactly: 8 roles, 15 capabilities, 38 grants       ##
-- ##    (incl. logistics_supervisor.manage_locations — reconciled).          ##
-- ##  * CORE rows match @intra/rbac's `core` module exactly (roles           ##
-- ##    platform_admin/staff/vendor_portal). These are the cross-cutting     ##
-- ##    caps this schema's RLS + RPCs gate on via has_any_cap().             ##
-- ##  * PROCUREMENT / LEGAL rows are MINIMAL + PROVISIONAL placeholders.     ##
-- ##    NOTE: they intentionally DIVERGE from @intra/rbac's provisional      ##
-- ##    procurement/legal roles for now (e.g. rbac uses legal:vendor/        ##
-- ##    upload_document; here the external tier is core:vendor_portal/       ##
-- ##    submit_documents, which is what register_document actually gates on). ##
-- ##    >>> RECONCILE procurement/legal in STEP 3 <<< when those modules are ##
-- ##    designed for real; regenerate this block from @intra/rbac then.      ##
-- ############################################################################
--
-- Re-runnable: the three tables are fully rebuilt on every run (delete + insert),
-- exactly like the warehouse role_capabilities seed. user_roles (per-user data)
-- is never touched here.

-- ===========================================================================
-- 1) Capability catalogue (module, cap)
-- ===========================================================================
delete from core.capabilities;
insert into core.capabilities (module, cap) values
  -- core (foundation, cross-cutting)
  ('core','view_directory'),
  ('core','manage_rbac'),
  ('core','view_vendors'),
  ('core','manage_vendors'),
  ('core','manage_accreditation'),
  ('core','view_documents'),
  ('core','manage_documents'),
  ('core','submit_documents'),
  ('core','view_approvals'),
  ('core','manage_approvals'),
  ('core','record_approval'),
  ('core','view_audit'),
  ('core','manage_notifications'),
  -- warehouse (mirror of docs/LLD.md §9 — 15 capabilities)
  ('warehouse','view_dashboard'),
  ('warehouse','receive_stock'),
  ('warehouse','manage_inventory'),
  ('warehouse','manage_products'),
  ('warehouse','manage_locations'),
  ('warehouse','cycle_count'),
  ('warehouse','manage_returns'),
  ('warehouse','reserve_allocate'),
  ('warehouse','issue_items'),
  ('warehouse','transfer_stock'),
  ('warehouse','view_finance'),
  ('warehouse','view_analytics'),
  ('warehouse','view_procurement'),
  ('warehouse','view_pricing'),
  ('warehouse','set_pricing'),
  -- procurement (provisional — Step 3)
  ('procurement','view_requests'),
  ('procurement','create_request'),
  ('procurement','approve_award'),
  ('procurement','view_vendors'),
  ('procurement','view_approvals'),
  ('procurement','record_approval'),
  -- legal (provisional — Step 3)
  ('legal','view_accreditation'),
  ('legal','review_accreditation'),
  ('legal','manage_accreditation'),
  ('legal','view_vendors'),
  ('legal','manage_vendors'),
  ('legal','view_documents'),
  ('legal','manage_documents'),
  ('legal','view_approvals'),
  ('legal','manage_approvals'),
  ('legal','record_approval');

-- ===========================================================================
-- 2) Roles (module, role, label)
-- ===========================================================================
delete from core.roles;
insert into core.roles (module, role, label) values
  -- core
  ('core','platform_admin','Platform Administrator'),
  ('core','staff','Internal Staff (baseline)'),
  ('core','vendor_portal','Vendor Portal User'),
  -- warehouse (8 roles, docs/LLD.md §4.3/§9)
  ('warehouse','logistics_supervisor','Logistics Supervisor'),
  ('warehouse','operations','Operations'),
  ('warehouse','finance','Finance'),
  ('warehouse','bi_analyst','BI Analyst'),
  ('warehouse','business_unit','Business Unit'),
  ('warehouse','marketing','Marketing'),
  ('warehouse','procurement','Procurement'),
  ('warehouse','pricing','Pricing'),
  -- procurement (provisional)
  ('procurement','requester','Requester'),
  ('procurement','approver','Approver'),
  -- legal (provisional)
  ('legal','legal_reviewer','Legal Reviewer'),
  ('legal','legal_admin','Legal Administrator');

-- ===========================================================================
-- 3) Role -> capability matrix
-- ===========================================================================
delete from core.role_capabilities;
insert into core.role_capabilities (module, role, cap) values
  -- --- core -----------------------------------------------------------------
  -- platform_admin: full foundation administration
  ('core','platform_admin','view_directory'),
  ('core','platform_admin','manage_rbac'),
  ('core','platform_admin','view_vendors'),
  ('core','platform_admin','manage_vendors'),
  ('core','platform_admin','manage_accreditation'),
  ('core','platform_admin','view_documents'),
  ('core','platform_admin','manage_documents'),
  ('core','platform_admin','view_approvals'),
  ('core','platform_admin','manage_approvals'),
  ('core','platform_admin','record_approval'),
  ('core','platform_admin','view_audit'),
  ('core','platform_admin','manage_notifications'),
  -- staff: baseline read access to shared master data. Assign this role to
  -- every internal employee alongside their module role(s) so has_any_cap()
  -- reads (vendors/documents/approvals/directory) resolve for them.
  ('core','staff','view_directory'),
  ('core','staff','view_vendors'),
  ('core','staff','view_documents'),
  ('core','staff','view_approvals'),
  -- vendor_portal: external tier. NO broad read caps — vendor visibility comes
  -- ONLY from the vendor-scoped RLS branches (own vendor row / own documents).
  ('core','vendor_portal','submit_documents'),

  -- --- warehouse (EXACT mirror of the current warehouse role_capabilities) --
  ('warehouse','logistics_supervisor','view_dashboard'),
  ('warehouse','logistics_supervisor','manage_inventory'),
  ('warehouse','logistics_supervisor','receive_stock'),
  ('warehouse','logistics_supervisor','manage_products'),
  ('warehouse','logistics_supervisor','manage_locations'),
  ('warehouse','logistics_supervisor','cycle_count'),
  ('warehouse','logistics_supervisor','manage_returns'),
  ('warehouse','logistics_supervisor','issue_items'),
  ('warehouse','logistics_supervisor','transfer_stock'),
  ('warehouse','operations','view_dashboard'),
  ('warehouse','operations','manage_inventory'),
  ('warehouse','operations','reserve_allocate'),
  ('warehouse','operations','issue_items'),
  ('warehouse','operations','manage_returns'),
  ('warehouse','operations','transfer_stock'),
  ('warehouse','finance','view_dashboard'),
  ('warehouse','finance','manage_inventory'),
  ('warehouse','finance','view_finance'),
  ('warehouse','finance','cycle_count'),
  ('warehouse','bi_analyst','view_dashboard'),
  ('warehouse','bi_analyst','manage_inventory'),
  ('warehouse','bi_analyst','view_analytics'),
  ('warehouse','business_unit','view_dashboard'),
  ('warehouse','business_unit','manage_inventory'),
  ('warehouse','business_unit','reserve_allocate'),
  ('warehouse','marketing','view_dashboard'),
  ('warehouse','marketing','manage_inventory'),
  ('warehouse','marketing','reserve_allocate'),
  ('warehouse','marketing','manage_returns'),
  ('warehouse','procurement','view_dashboard'),
  ('warehouse','procurement','manage_inventory'),
  ('warehouse','procurement','view_procurement'),
  ('warehouse','procurement','manage_products'),
  ('warehouse','pricing','view_dashboard'),
  ('warehouse','pricing','manage_inventory'),
  ('warehouse','pricing','view_pricing'),
  ('warehouse','pricing','set_pricing'),
  ('warehouse','pricing','view_finance'),

  -- --- procurement (provisional — Step 3) -----------------------------------
  ('procurement','requester','view_requests'),
  ('procurement','requester','create_request'),
  ('procurement','requester','view_vendors'),
  ('procurement','approver','view_requests'),
  ('procurement','approver','approve_award'),
  ('procurement','approver','view_vendors'),
  ('procurement','approver','view_approvals'),
  ('procurement','approver','record_approval'),

  -- --- legal (provisional — Step 3) -----------------------------------------
  ('legal','legal_reviewer','view_accreditation'),
  ('legal','legal_reviewer','review_accreditation'),
  ('legal','legal_reviewer','view_vendors'),
  ('legal','legal_reviewer','view_documents'),
  ('legal','legal_reviewer','view_approvals'),
  ('legal','legal_admin','view_accreditation'),
  ('legal','legal_admin','review_accreditation'),
  ('legal','legal_admin','manage_accreditation'),
  ('legal','legal_admin','view_vendors'),
  ('legal','legal_admin','manage_vendors'),
  ('legal','legal_admin','view_documents'),
  ('legal','legal_admin','manage_documents'),
  ('legal','legal_admin','view_approvals'),
  ('legal','legal_admin','manage_approvals'),
  ('legal','legal_admin','record_approval');
