// Legal accreditation domain types (preview build).
//
// Mirrors what @intra/core-data + legal.* RPCs will return once the live adapter
// lands; kept camelCase and jurisdiction-agnostic so the vendor portal can
// service PH + foreign vendors from the same code paths.
//
// v2 (2026-07-06): adds jurisdiction / entity / risk / instrument axes so the
// policy engine (requirements/policy.ts) can tailor the checklist against real
// mWell PH practice + international equivalents.

// ---------------------------------------------------------------------------
// Case lifecycle
// ---------------------------------------------------------------------------

export type CaseStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'provisional'
  | 'rejected'
  | 'expired'
  | 'renewal_due';

/** ISO 3166 style; `OTHER` = free-text country captured on originCountry. */
export type Jurisdiction = 'PH' | 'US' | 'EU' | 'UK' | 'SG' | 'HK' | 'OTHER';

/** Legal form of the vendor entity. */
export type EntityType =
  | 'corporation'
  | 'sole_prop'
  | 'partnership'
  | 'cooperative'
  | 'branch_foreign'
  | 'other';

/** Sourcing category — drives sector-specific docs (FDA, PCAB, etc.). */
export type VendorCategory =
  | 'goods'
  | 'services'
  | 'construction'
  | 'manpower'
  | 'consulting'
  | 'it_software'
  | 'medical_pharma'
  | 'marketing'
  | 'logistics'
  | 'subscription'
  | 'other';

/** Risk-tier per mWell §7 vendor accreditation (High triggers EDD). */
export type RiskTier = 'low' | 'medium' | 'high';

/** Contract type — drives bond / SLA obligations. */
export type ContractType =
  | 'spot_po'
  | 'master_supply'
  | 'sla'
  | 'retainer'
  | 'project'
  | 'manpower_supply';

/** Expected annual spend band — drives insurance / bond prompts. */
export type SpendBand =
  | 'below_100k'
  | '100k_1m'
  | '1m_10m'
  | '10m_50m'
  | 'above_50m';

/** Domain grouping used to bucket the checklist on the vendor portal. */
export type RequirementGroup =
  | 'statutory'
  | 'tax'
  | 'regulatory'
  | 'financial'
  | 'governance'
  | 'quality'
  | 'insurance'
  | 'ownership'
  | 'legal_instruments';

/** File format expected as evidence for a requirement. */
export type EvidenceFormat = 'pdf' | 'xlsx' | 'img' | 'any' | 'signed';

/** Issuing authority. Free-text-ish but centralized so it can be filtered. */
export type Authority =
  | 'SEC'
  | 'DTI'
  | 'BIR'
  | 'DOLE'
  | 'FDA'
  | 'DENR'
  | 'NPC'
  | 'PCAB'
  | 'PhilGEPS'
  | 'PhilHealth'
  | 'SSS'
  | 'Pag-IBIG'
  | 'LGU'
  | 'IRS'
  | 'US_SOS'
  | 'DUNS'
  | 'HMRC'
  | 'Companies House'
  | 'ACRA'
  | 'HK_CR'
  | 'ISO'
  | 'Insurer / Bank'
  | 'mWell Legal'
  | 'Vendor'
  | 'Notary / Consular'
  | 'Sanctions Body'
  | 'Other';

/**
 * Signable legal instrument code. Free-string so the catalog + instruments
 * modules can evolve independently of the type file (each catalog row still
 * pairs to exactly one `InstrumentTemplate.code`).
 */
export type InstrumentCode = string;

/**
 * Semantic bucket for grouping instruments in the vendor portal.
 * Free-string to keep the catalog + instruments modules loosely coupled;
 * the vendor portal simply renders whatever bucket labels arrive.
 */
export type InstrumentGroup = string;

/**
 * A signable legal instrument template. Rendered by `SignInstrumentPage` and
 * consumed by `SignaturePad` (@intra/ui). Versioning is snapshotted onto the
 * `SignedInstrument` row so historical signatures remain traceable against the
 * exact wording the signer saw.
 */
export interface InstrumentTemplate {
  code: InstrumentCode;
  label: string;
  /** Bump `version` (calendar-versioned "YYYY.MM.DD") when the body changes. */
  version: string;
  group: InstrumentGroup;
  summary: string;
  /** Jurisdictions that require this instrument. Empty = every jurisdiction. */
  jurisdictions: readonly (Jurisdiction | '*')[];
  /** Risk tiers that require this instrument. Empty = every tier. */
  riskTiers: readonly (RiskTier | '*')[];
  /** True when only required for vendors handling personal data. */
  personalDataOnly?: boolean;
  /** Ordered paragraphs — rendered as separate <p>'s on the sign page. */
  body: readonly string[];
  /**
   * Optional pre-signature disclosure fields the signer must fill in. Kind
   * `yesno` renders as a radio pair, `textarea` as a multi-line input. The
   * captured values are persisted alongside the signed instrument.
   */
  fields?: readonly InstrumentField[];
}

export interface InstrumentField {
  name: string;
  label: string;
  kind: 'yesno' | 'text' | 'textarea';
  required?: boolean;
  placeholder?: string;
}

/**
 * A single normalized requirement definition (row in `legal.requirement_catalog`).
 * `'*'` in an axis array means "applies to every value on that axis" — this
 * keeps the policy engine's filter cheap without every entry re-enumerating.
 */
export interface RequirementDefinition {
  code: string;
  label: string;
  description: string;
  /** Vendor-facing tooltip: why does mWell need this? */
  whyWeNeedIt: string;
  authority: Authority;
  helpUrl?: string;
  jurisdictions: readonly (Jurisdiction | '*')[];
  entityTypes: readonly (EntityType | '*')[];
  categories: readonly (VendorCategory | '*')[];
  riskTiers: readonly (RiskTier | '*')[];
  contractTypes?: readonly (ContractType | '*')[];
  /** When true this row is mandatory for the vendor to submit. */
  required: boolean;
  /** Renewal cadence — undefined = one-time / lifetime document. */
  renewsAfterMonths?: number;
  evidenceFormat: EvidenceFormat;
  group: RequirementGroup;
  /** True when this is a signable instrument (rendered via SignaturePad). */
  instrument: boolean;
  /** Instrument template code (matches `InstrumentCode`) when instrument = true. */
  instrumentCode?: InstrumentCode;
  /** Latest template version this catalog row expects. */
  templateVersion?: string;
  /** Minimum spend band that triggers this requirement (bond / insurance). */
  minSpendBand?: SpendBand;
  /** True when required only if the vendor handles personal data. */
  requiresPersonalData?: boolean;
  /** Free-form tags for filtering ("edd", "bond", "ph-mandatory"). */
  tags?: readonly string[];
  /** Governing source required before this row may block accreditation. */
  policySource?: PolicySourceReference;
}

export interface PolicySourceReference {
  id: string;
  version: string;
  owner: string;
  sourceDocument: string;
  section?: string;
}

// ---------------------------------------------------------------------------
// Case + checklist
// ---------------------------------------------------------------------------

/**
 * Electronic-signature record persisted on case-level events (vendor submit
 * attestation, Legal approve/reject sign-off). Mirrors `SignaturePayload`
 * from @intra/ui field-for-field — duplicated here (rather than imported) to
 * keep the domain types free of UI deps, same pattern as procurement's
 * `ApprovalSignature`.
 */
export interface CaseSignature {
  method: 'drawn' | 'typed';
  /** PNG rendering of the signature (data URL). */
  dataUrl: string;
  /** Full legal name the signer confirmed at capture. */
  signerName: string;
  /** ISO timestamp captured at commit. */
  signedAt: string;
  /** Best-effort audit fingerprint (browser + tzOffset). */
  userAgent: string;
}

export type AccreditationFieldDisposition =
  | { status: 'not_applicable'; reason: string }
  | { status: 'foreign_equivalent'; reason: string; reviewerEmail?: string; reviewedAt?: string };

export interface VendorCompanyDetails {
  tradeName: string;
  contactNumber: string;
  businessAddress: string;
  incorporationDate: string;
  incorporationPlace: string;
  tin: string;
  email: string;
  website: string;
  fax?: string;
  principalName: string;
  principalEmail: string;
  principalContactNumber: string;
  correspondenceName: string;
  correspondenceEmail: string;
  correspondenceContactNumber: string;
  productsOrServices: string;
  businessType: 'partnership' | 'corporation' | 'sole_prop';
}

export interface VendorManpowerExperience {
  countAndExpertise: string;
  qualifications: string;
  completedProjects: string;
}

export type TechnologyVendorPool = 'nodejs' | 'php_laravel' | 'mobile';

export interface TechnologyQualification {
  pool: TechnologyVendorPool;
  qualified: boolean;
  remarks: string;
}

export interface VendorAccreditationDeclaration {
  accepted: boolean;
  noLegalActions: boolean;
  disclosureDetails: string;
  verificationAuthorized: boolean;
  signerName: string;
  signerTitle: string;
  signedAt: string;
}

export interface VendorApplicationSnapshot {
  policyVersion: 'vendor-accreditation-v2025';
  entityType: Extract<EntityType, 'corporation' | 'sole_prop' | 'partnership'>;
  jurisdiction: Jurisdiction;
  company: VendorCompanyDetails;
  manpower: VendorManpowerExperience;
  technologyServiceProvider: boolean;
  technologyQualifications: TechnologyQualification[];
  fieldDispositions: Record<string, AccreditationFieldDisposition>;
  declaration: VendorAccreditationDeclaration;
}

export interface AccreditationCase {
  id: string;
  vendorId: string;
  vendorName: string;
  status: CaseStatus;
  openedAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedByEmail?: string;
  decisionNote?: string;
  /** ISO date the accreditation expires on approval. */
  expiresAt?: string;
  /** Scope of accreditation (e.g. "medical devices, consumables"). */
  scope?: string;
  /** Freeform label kept for backwards compat with v1 records. */
  category?: string;
  /**
   * Renewal continuity (F2.3): the vendor's latest prior case at the time
   * this one was opened, so reviewers can reach last cycle's documents.
   */
  previousCaseId?: string;

  // ---- v2 tailoring axes -------------------------------------------------
  jurisdiction?: Jurisdiction;
  /** Free-text ISO 3166 country when jurisdiction is `OTHER`. */
  originCountry?: string;
  entityType?: EntityType;
  vendorCategory?: VendorCategory;
  riskTier?: RiskTier;
  contractType?: ContractType;
  expectedAnnualSpend?: SpendBand;
  handlesPersonalData?: boolean;
  /** Last time a reminder was pushed to the vendor. */
  lastReminderAt?: string;
  /** Optional invited-by email captured on invite. */
  invitedByEmail?: string;
  /** Vendor contact email captured at invite time. */
  contactEmail?: string;
  /** Vendor's attestation signature captured on "Submit for review". */
  submissionSignature?: CaseSignature;
  /** Legal reviewer's sign-off signature captured on approve / reject. */
  decisionSignature?: CaseSignature;
  /** A high-risk disposition proposed by one Legal actor and awaiting another. */
  decisionPending?: boolean;
  pendingDecisionStatus?: 'approved' | 'rejected' | 'provisional';
  pendingDecisionProposedByEmail?: string;
}

export type ChecklistDecision = 'pending' | 'approved' | 'rejected' | 'na';

export interface RequirementChecklistItem {
  id: string;
  caseId: string;
  /** Catalog code (`PH_SEC_REG`, `SIGN_NDA`, …). Undefined on legacy v1 rows. */
  code?: string;
  requirement: string;
  description?: string;
  /** Vendor-facing tooltip copy. */
  whyWeNeedIt?: string;
  helpUrl?: string;
  authority?: Authority;
  evidenceFormat?: EvidenceFormat;
  group?: RequirementGroup;
  required: boolean;
  /** True when this checklist item is a signable instrument. */
  instrument?: boolean;
  instrumentCode?: InstrumentCode;
  templateVersion?: string;
  renewsAfterMonths?: number;
  decision: ChecklistDecision;
  reviewerEmail?: string;
  reviewedAt?: string;
  reviewerNote?: string;
  /** Ids of AccreditationDoc rows attached to this checklist item. */
  documentIds: string[];
}

export type DocumentStatus = 'submitted' | 'approved' | 'rejected' | 'expired';

export interface AccreditationDoc {
  id: string;
  caseId: string;
  vendorId: string;
  requirementId?: string;
  docType: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Demo/local preview URL. Live mode stores the object in private Storage. */
  dataUrl?: string;
  /** Private `documents` bucket object path used by live Supabase mode. */
  storagePath?: string;
  status: DocumentStatus;
  version: number;
  uploadedAt: string;
  uploadedByEmail?: string;
  expiresAt?: string;
  reviewerNote?: string;

  // ---- v2 fields ---------------------------------------------------------
  authority?: Authority;
  /** Externally-issued document number (e.g. BIR OCN, SEC company no.). */
  documentNumber?: string;
  /** Original issue date, distinct from uploadedAt. */
  issuedAt?: string;
  evidenceFormat?: EvidenceFormat;
  isOriginal?: boolean;
  isApostilled?: boolean;
}

export interface CaseTimelineEntry {
  id: string;
  caseId: string;
  at: string;
  actorEmail?: string;
  action: string;
  detail?: string;
}

export interface VendorInvite {
  id: string;
  email: string;
  companyName: string;
  category?: string;
  createdAt: string;
  createdByEmail?: string;
  acceptedAt?: string;
  expiresAt?: string;
  linkGeneration?: number;
  lastLinkIssuedAt?: string;
  replayRejectedAt?: string;
  status: 'sent' | 'accepted' | 'expired' | 'delivery_failed';
  /** Delivery is separate from case creation so a mail outage cannot orphan work. */
  deliveryStatus?: 'sent' | 'delivery_failed';
  /** User-safe delivery guidance; provider diagnostics remain server-side. */
  deliveryError?: string;
  // v2 additions carried over from the invite wizard
  jurisdiction?: Jurisdiction;
  originCountry?: string;
  entityType?: EntityType;
  vendorCategory?: VendorCategory;
  riskTier?: RiskTier;
  contractType?: ContractType;
  expectedAnnualSpend?: SpendBand;
  handlesPersonalData?: boolean;
  /** Live Supabase invite response links directly to the opened case. */
  caseId?: string;
  /** Live Supabase invite response links to the created core vendor. */
  vendorId?: string;
}

// ---------------------------------------------------------------------------
// Signed instruments (NDA / DPA / etc.)
// ---------------------------------------------------------------------------

export interface SignedInstrument {
  id: string;
  caseId: string;
  code: InstrumentCode;
  templateVersion: string;
  signerName: string;
  signerTitle?: string;
  signerEmail?: string;
  /** PNG data URL emitted by @intra/ui SignaturePad. */
  signaturePng: string;
  signatureMethod: 'drawn' | 'typed';
  signedAt: string;
  /** UA string + tz offset — audit fingerprint. */
  signerUa: string;
  /** Captured pre-signature disclosure field values (InstrumentField.name → value). */
  fields?: Record<string, string>;
  /** Both MNDA signatures must bind this same canonical document hash. */
  documentHash?: string;
  signerParty?: 'service_provider' | 'mphtc';
  revokedAt?: string;
  revokedByEmail?: string;
}

export type InstrumentLifecycleEventType =
  | 'definitive_agreement_executed'
  | 'expired'
  | 'terminated'
  | 'return_or_destroy_requested'
  | 'return_or_destroy_completed'
  | 'retention_exception_recorded';

export interface InstrumentLifecycleEvent {
  id: string;
  caseId: string;
  instrumentCode: InstrumentCode;
  documentHash: string;
  eventType: InstrumentLifecycleEventType;
  occurredAt: string;
  dueAt?: string;
  completedAt?: string;
  evidenceStoragePath?: string;
  retentionBasis?: string;
  actorEmail?: string;
}

// ---------------------------------------------------------------------------
// Requirement + progress derivation helpers
// ---------------------------------------------------------------------------

export interface RequirementGroupProgress {
  group: RequirementGroup;
  label: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  submitted: number;
  expiringSoon: number;
  /** 0..1 of required items that have been approved. */
  ratio: number;
}

export interface CaseProgressSummary {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  submitted: number;
  expiringSoon: number;
  /** 0..1 of required items approved across every group. */
  ratio: number;
  groups: RequirementGroupProgress[];
  /** Required items missing an approved doc / signature — "you still owe". */
  outstanding: RequirementChecklistItem[];
  /** Submitted items still awaiting reviewer decision. */
  awaitingReview: RequirementChecklistItem[];
}

/** Which "bucket" of the reviewer inbox a case belongs to. */
export type InboxBucket =
  | 'waiting_on_vendor'
  | 'waiting_on_legal'
  | 'ready_for_decision'
  | 'renewal_due';

/** Descriptive labels for RequirementGroup keys. */
export const REQUIREMENT_GROUP_LABEL: Record<RequirementGroup, string> = {
  statutory: 'Statutory & Registration',
  tax: 'Tax & Revenue',
  regulatory: 'Regulatory & Sector Permits',
  financial: 'Financial & Banking',
  governance: 'Governance & Sworn',
  quality: 'Quality & Standards',
  insurance: 'Insurance & Bonds',
  ownership: 'Ownership & Beneficial',
  legal_instruments: 'Legal Instruments',
};

export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  PH: 'Philippines',
  US: 'United States',
  EU: 'European Union',
  UK: 'United Kingdom',
  SG: 'Singapore',
  HK: 'Hong Kong SAR',
  OTHER: 'Other',
};

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  corporation: 'Corporation',
  sole_prop: 'Sole Proprietor',
  partnership: 'Partnership',
  cooperative: 'Cooperative',
  branch_foreign: 'Branch of Foreign Entity',
  other: 'Other',
};

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = {
  goods: 'Goods',
  services: 'Services',
  construction: 'Construction',
  manpower: 'Manpower / Contracting',
  consulting: 'Consulting',
  it_software: 'IT & Software',
  medical_pharma: 'Medical & Pharma',
  marketing: 'Marketing',
  logistics: 'Logistics',
  subscription: 'Subscription',
  other: 'Other',
};

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  spot_po: 'Spot Purchase Order',
  master_supply: 'Master Supply Agreement',
  sla: 'Service Level Agreement',
  retainer: 'Retainer',
  project: 'Project',
  manpower_supply: 'Manpower Supply',
};

export const SPEND_BAND_LABEL: Record<SpendBand, string> = {
  below_100k: 'Below ₱100,000',
  '100k_1m': '₱100,000 – ₱1M',
  '1m_10m': '₱1M – ₱10M',
  '10m_50m': '₱10M – ₱50M',
  above_50m: 'Above ₱50M',
};

export const RISK_TIER_LABEL: Record<RiskTier, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High — EDD',
};

/** SpendBand comparison helper. Higher = more spend. */
export const SPEND_BAND_ORDER: Record<SpendBand, number> = {
  below_100k: 0,
  '100k_1m': 1,
  '1m_10m': 2,
  '10m_50m': 3,
  above_50m: 4,
};
