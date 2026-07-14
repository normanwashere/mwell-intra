import type {
  Authority,
  EntityType,
  Jurisdiction,
  PolicySourceReference,
  TechnologyVendorPool,
  VendorApplicationSnapshot,
} from '../types';

export const VENDOR_ACCREDITATION_V2025: PolicySourceReference & {
  declarationVersion: string;
} = Object.freeze({
  id: 'vendor-accreditation-v2025',
  version: '2025',
  owner: 'Vendor Management Office / Legal',
  sourceDocument: 'LGL004-Vendor Accreditation Form 2.0 (3).pdf',
  section: 'Sections A-C and signed declaration',
  declarationVersion: 'vendor-accreditation-declaration-v2025',
});

export interface V2025ChecklistOptions {
  jurisdiction?: Jurisdiction;
  handlesPersonalData?: boolean;
  technologyServiceProvider?: boolean;
}

export interface V2025ChecklistItem {
  code: string;
  label: string;
  authority: Authority;
  required: boolean;
  conditional?: 'personal_data' | 'technology_service';
  equivalentAllowed: boolean;
  source: typeof VENDOR_ACCREDITATION_V2025;
}

const common: readonly Omit<V2025ChecklistItem, 'required' | 'equivalentAllowed' | 'source'>[] = [
  { code: 'PH_AFS_3Y', label: 'Audited Financial Statements for the last three years', authority: 'Vendor' },
  { code: 'PH_COMPANY_PROFILE', label: 'Company profile', authority: 'Vendor' },
  { code: 'PH_BANK_PROOF', label: 'Bank details / proof of bank account', authority: 'Insurer / Bank' },
  { code: 'PH_OFFICIAL_RECEIPT', label: 'Photocopy of Official Receipt', authority: 'BIR' },
  { code: 'PH_PRIVACY_COMPLIANCE', label: 'Privacy Impact Assessment or data privacy compliance evidence', authority: 'NPC', conditional: 'personal_data' },
  { code: 'PH_CYBERSECURITY_POLICIES', label: 'Cybersecurity policies', authority: 'Vendor', conditional: 'technology_service' },
  { code: 'SIGN_NDA', label: 'Non-Disclosure Agreement', authority: 'mWell Legal' },
];

const byEntity: Record<
  Extract<EntityType, 'corporation' | 'sole_prop' | 'partnership'>,
  readonly Omit<V2025ChecklistItem, 'required' | 'equivalentAllowed' | 'source'>[]
> = {
  sole_prop: [
    { code: 'PH_DTI_REG', label: 'Registration of Trade Name with DTI', authority: 'DTI' },
    { code: 'PH_BIR_2303', label: 'BIR Certificate of Registration (Form 2303)', authority: 'BIR' },
    { code: 'PH_MAYORS_PERMIT', label: "Business Permit / Mayor's Permit", authority: 'LGU' },
    { code: 'PH_CLIENT_LIST', label: 'Client list and current/past transaction proof with contact details', authority: 'Vendor' },
  ],
  partnership: [
    { code: 'PH_SEC_REG', label: 'SEC Certificate of Registration', authority: 'SEC' },
    { code: 'PH_PARTNERSHIP_ARTICLES', label: 'Articles of Partnership', authority: 'SEC' },
    { code: 'PH_BIR_2303', label: 'BIR Certificate of Registration (Form 2303)', authority: 'BIR' },
    { code: 'PH_PARTNERSHIP_RESOLUTION', label: 'Notarized Partnership Resolution', authority: 'Notary / Consular' },
    { code: 'PH_MAYORS_PERMIT', label: "Business Permit / Mayor's Permit", authority: 'LGU' },
    { code: 'PH_CLIENT_LIST', label: 'Client list and current/past transaction proof with contact details', authority: 'Vendor' },
  ],
  corporation: [
    { code: 'PH_SEC_REG_ARTICLES_BYLAWS', label: 'SEC registration, Articles of Incorporation and By-Laws', authority: 'SEC' },
    { code: 'PH_BIR_2303', label: 'BIR Certificate of Registration (Form 2303)', authority: 'BIR' },
    { code: 'PH_SECRETARY_CERT', label: "Notarized Secretary's Certificate or Board Resolution", authority: 'Notary / Consular' },
    { code: 'PH_GIS', label: 'Updated General Information Sheet', authority: 'SEC' },
    { code: 'PH_MAYORS_PERMIT', label: "Business Permit / Mayor's Permit", authority: 'LGU' },
    { code: 'PH_EXPERTISE_CERTS', label: 'Certifications demonstrating expertise', authority: 'Vendor' },
    { code: 'PH_CLIENT_PORTFOLIO', label: 'Portfolio of clients and completed projects with contact details', authority: 'Vendor' },
  ],
};

export function buildV2025Checklist(
  entityType: Extract<EntityType, 'corporation' | 'sole_prop' | 'partnership'>,
  options: V2025ChecklistOptions = {},
): V2025ChecklistItem[] {
  const foreign = (options.jurisdiction ?? 'PH') !== 'PH';
  return [...byEntity[entityType], ...common].map((item) => ({
    ...item,
    required:
      item.conditional === 'personal_data'
        ? options.handlesPersonalData === true
        : item.conditional === 'technology_service'
          ? options.technologyServiceProvider === true
          : true,
    equivalentAllowed: foreign && item.authority !== 'mWell Legal',
    source: VENDOR_ACCREDITATION_V2025,
  }));
}

export const TECHNOLOGY_VENDOR_POOLS: Readonly<Record<TechnologyVendorPool, readonly string[]>> = {
  nodejs: [
    'MongoDB, MySQL, PostgreSQL',
    'NodeJS, Express, NestJS, NextJS, ReactJS',
    'Google Cloud or Azure',
    'Full-stack, API, performance, database, cloud-native and DevOps capability',
  ],
  php_laravel: [
    'MySQL, PHP Laravel, Angular',
    'Google Cloud or Azure',
    'Full-stack, API, performance, database, cloud-native and DevOps capability',
  ],
  mobile: [
    'Native iOS and Android; Huawei capability is a plus',
    'Swift and Kotlin',
    'Native mobile development and mobile UI/UX practices',
  ],
};

const requiredCompanyFields = [
  'tradeName',
  'contactNumber',
  'businessAddress',
  'incorporationDate',
  'incorporationPlace',
  'tin',
  'email',
  'website',
  'principalName',
  'principalEmail',
  'principalContactNumber',
  'correspondenceName',
  'correspondenceEmail',
  'correspondenceContactNumber',
  'productsOrServices',
  'businessType',
] as const;

export interface V2025ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateV2025Application(
  application: VendorApplicationSnapshot,
): V2025ValidationResult {
  const errors: string[] = [];
  for (const field of requiredCompanyFields) {
    const path = `company.${field}`;
    const value = application.company[field];
    const disposition = application.fieldDispositions[path];
    const validNa =
      disposition?.status === 'not_applicable' && disposition.reason.trim().length > 0;
    if (String(value ?? '').trim().length === 0 && !validNa) errors.push(path);
  }
  if (!application.manpower.countAndExpertise.trim()) errors.push('manpower.countAndExpertise');
  if (!application.manpower.qualifications.trim()) errors.push('manpower.qualifications');
  if (!application.manpower.completedProjects.trim()) errors.push('manpower.completedProjects');
  if (application.technologyServiceProvider && application.technologyQualifications.length === 0) {
    errors.push('technologyQualifications');
  }
  if (!application.declaration.accepted) errors.push('declaration.accepted');
  if (!application.declaration.verificationAuthorized) errors.push('declaration.verificationAuthorized');
  if (!application.declaration.noLegalActions && !application.declaration.disclosureDetails.trim()) {
    errors.push('declaration.disclosureDetails');
  }
  if (!application.declaration.signerName.trim()) errors.push('declaration.signerName');
  if (!application.declaration.signerTitle.trim()) errors.push('declaration.signerTitle');
  if (!application.declaration.signedAt.trim()) errors.push('declaration.signedAt');
  return { ok: errors.length === 0, errors };
}
