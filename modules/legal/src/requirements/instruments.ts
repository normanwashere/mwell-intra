// Signable legal instrument templates.
//
// Each template pairs with a catalog `legal_instrument` requirement of the
// same code (`nda_mutual`, `dpa_ph`, ...). Rendering + signature capture
// happen in `pages/SignInstrumentPage.tsx`; the signed record is persisted
// via `localStore.signInstrument` (or the live `legal.sign_instrument` RPC).
//
// Versioning: bump `version` and add a note in
// `docs/VENDOR-ACCREDITATION.md#nda-template-versioning` whenever the body
// text changes. The signed record snapshots the version so historical
// signatures remain traceable against the exact wording the signer saw.

import type { InstrumentCode, InstrumentTemplate } from '../types';

export const TECHNOLOGY_MNDA_TEMPLATE_VERSION =
  'mnda-tech-service-provider-2026.06.10-clean-v1';

export interface TechnologyMndaFields {
  executionDate: string;
  serviceProviderName: string;
  serviceProviderAddress: string;
  potentialTransaction: string;
  serviceProviderNoticeName: string;
  serviceProviderNoticeAddress: string;
  serviceProviderNoticeFax: string;
  serviceProviderNoticeEmail: string;
  serviceProviderSignatoryName: string;
  serviceProviderSignatoryDesignation: string;
  mphtcSignatoryName: string;
  mphtcSignatoryDesignation: string;
}

export interface GeneratedTechnologyMnda {
  templateVersion: typeof TECHNOLOGY_MNDA_TEMPLATE_VERSION;
  body: string[];
  canonicalText: string;
  sha256: string;
}

export function renderTechnologyMnda(fields: TechnologyMndaFields): string[] {
  return [
    `This Non-Disclosure Agreement is made on ${fields.executionDate} between Metro Pacific Health Tech Corporation, a Philippine company with registered office at 9F Rockwell Business Center Tower 1, Ortigas Avenue, Pasig City ("MPHTC"), and ${fields.serviceProviderName}, with registered address at ${fields.serviceProviderAddress} ("SERVICE PROVIDER"). MPHTC and SERVICE PROVIDER are each a "Party" and together the "Parties".`,
    `The Parties are exploring a potential technology engagement involving ${fields.potentialTransaction} (the "Potential Transaction") and may disclose Confidential Information to facilitate those discussions.`,
    '"Confidential Information" means confidential, proprietary, or non-public information concerning a Party, its Affiliates, their activities, or the Potential Transaction, including related documents and analyses, the existence and terms of this Agreement, and the fact that discussions or negotiations are taking place, whether disclosed before or after execution.',
    'The Receiving Party shall keep Confidential Information strictly confidential, use no less than reasonable care, use it only for the Potential Transaction, and disclose it only to Representatives with a need to know who are bound to protect it. The Receiving Party remains liable for unauthorized disclosure or use by its Representatives.',
    'Confidential Information excludes information that becomes public without breach, was already known as shown by records, is disclosed with written approval, is ascertainable from commercially available products or manuals, or is received lawfully from a third party without a confidentiality restriction.',
    'A Receiving Party compelled by a court, government agency, regulator, or applicable stock exchange may disclose only what is required and, where practicable and legally permitted, shall notify the Disclosing Party in advance.',
    'Nothing in this Agreement authorizes either Party to bind the other, creates a joint venture, partnership, or formal business organization, promises a future contract, or grants a license or other right in Confidential Information.',
    'Each Party shall comply with Republic Act No. 10173, the Data Privacy Act of the Philippines, its implementing rules and regulations, and other applicable privacy laws. Personal data may be collected, processed, shared, and used only for the Potential Transaction. Each Party warrants that required consents have been obtained before disclosure.',
    'Upon written request, expiry, or termination, the Receiving Party shall within five (5) business days return or destroy the Disclosing Party\'s Confidential Information and copies. A copy may be retained only where required by law, regulation, professional standard, or internal retention policy, and remains subject to confidentiality.',
    'This Agreement remains effective until the earlier of (a) two (2) years from execution and (b) the date the Parties execute definitive agreements implementing the Potential Transaction.',
    'Notices must be in writing. Service Provider notices are addressed to ' +
      `${fields.serviceProviderName}, ${fields.serviceProviderNoticeAddress}, attention ${fields.serviceProviderNoticeName}, fax ${fields.serviceProviderNoticeFax}, email ${fields.serviceProviderNoticeEmail}.`,
    'Any addition or modification must be in a written instrument signed by duly authorized representatives of both Parties. Neither Party may assign its rights or obligations without prior consent, except an assignment to a subsidiary or holding company with prior written notice.',
    'Announcements, publications, press releases, and media participation concerning the Potential Transaction or this Agreement require the other Party\'s written approval where practicable and legally feasible.',
    'This Agreement is governed by the laws of the Republic of the Philippines. Disputes shall be settled under the Philippine Dispute Resolution Center Inc. (PDRCI) Arbitration Rules by three (3) arbitrators. The seat and venue are Makati, Philippines, and the language is English.',
    'Money damages may be insufficient for breach; the Disclosing Party may seek equitable relief, including injunction or specific performance, in addition to other remedies.',
    `The Parties execute this Agreement through authorized representatives: MPHTC by ${fields.mphtcSignatoryName}, ${fields.mphtcSignatoryDesignation}; SERVICE PROVIDER by ${fields.serviceProviderSignatoryName}, ${fields.serviceProviderSignatoryDesignation}. Counterparts together constitute one agreement.`,
  ];
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function generateTechnologyMnda(
  fields: TechnologyMndaFields,
): Promise<GeneratedTechnologyMnda> {
  const body = renderTechnologyMnda(fields);
  const canonicalText = body.join('\n\n').replace(/\r\n/g, '\n').trim();
  return {
    templateVersion: TECHNOLOGY_MNDA_TEMPLATE_VERSION,
    body,
    canonicalText,
    sha256: await sha256(canonicalText),
  };
}

export function technologyMndaReturnOrDestroyDueAt(triggeredAt: string): string {
  const due = new Date(triggeredAt);
  if (!Number.isFinite(due.getTime())) throw new Error('Invalid MNDA lifecycle timestamp');
  let remaining = 5;
  while (remaining > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    const day = due.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return due.toISOString();
}

const TEMPLATE_FIELDS: TechnologyMndaFields = {
  executionDate: '[EXECUTION DATE]',
  serviceProviderName: '[SERVICE PROVIDER LEGAL NAME]',
  serviceProviderAddress: '[SERVICE PROVIDER REGISTERED ADDRESS]',
  potentialTransaction: '[POTENTIAL TECHNOLOGY TRANSACTION]',
  serviceProviderNoticeName: '[NOTICE CONTACT]',
  serviceProviderNoticeAddress: '[NOTICE ADDRESS]',
  serviceProviderNoticeFax: '[FAX OR N/A]',
  serviceProviderNoticeEmail: '[NOTICE EMAIL]',
  serviceProviderSignatoryName: '[SERVICE PROVIDER SIGNATORY]',
  serviceProviderSignatoryDesignation: '[DESIGNATION]',
  mphtcSignatoryName: '[APPROVED MPHTC SIGNATORY]',
  mphtcSignatoryDesignation: '[DESIGNATION]',
};

export const INSTRUMENT_TEMPLATES: readonly InstrumentTemplate[] = [
  {
    code: 'nda_mutual',
    label: 'Mutual Non-Disclosure Agreement',
    version: TECHNOLOGY_MNDA_TEMPLATE_VERSION,
    group: 'nda',
    summary:
      'Technology service-provider MNDA. Both parties protect confidential information exchanged while evaluating or performing software, systems-integration, consulting, or technical services.',
    jurisdictions: [],
    riskTiers: [],
    body: renderTechnologyMnda(TEMPLATE_FIELDS),
    fields: [
      { name: 'executionDate', label: 'Execution date', kind: 'text', required: true },
      { name: 'serviceProviderName', label: 'Service provider legal name', kind: 'text', required: true },
      { name: 'serviceProviderAddress', label: 'Registered address', kind: 'textarea', required: true },
      { name: 'potentialTransaction', label: 'Potential transaction', kind: 'textarea', required: true },
      { name: 'serviceProviderNoticeName', label: 'Notice contact', kind: 'text', required: true },
      { name: 'serviceProviderNoticeAddress', label: 'Notice address', kind: 'textarea', required: true },
      { name: 'serviceProviderNoticeFax', label: 'Fax number or N/A', kind: 'text', required: true },
      { name: 'serviceProviderNoticeEmail', label: 'Notice email', kind: 'text', required: true },
      { name: 'serviceProviderSignatoryName', label: 'Service provider signatory', kind: 'text', required: true },
      { name: 'serviceProviderSignatoryDesignation', label: 'Service provider designation', kind: 'text', required: true },
      { name: 'mphtcSignatoryName', label: 'Approved MPHTC signatory', kind: 'text', required: true },
      { name: 'mphtcSignatoryDesignation', label: 'MPHTC signatory designation', kind: 'text', required: true },
    ],
  },
  {
    code: 'nda_one_way',
    label: 'One-way Non-Disclosure Agreement',
    version: '2026.07.01',
    group: 'nda',
    summary:
      'One-way NDA for when the vendor receives mWell confidential information only (e.g. RFP recipients).',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'This One-way Non-Disclosure Agreement is entered into by mWell Corporation ("Discloser") and the vendor identified on the accreditation case ("Recipient").',
      'Discloser may share information that is confidential or proprietary ("Confidential Information") for the sole purpose of evaluating a potential engagement.',
      'Recipient shall protect Confidential Information with the same care as its own confidential information (never less than reasonable care) and restrict access to personnel with a strict need-to-know.',
      'Confidential Information does not include information that is or becomes public through no fault of Recipient, was rightfully known before disclosure, is independently developed, or is rightfully received from a third party.',
      'Obligations survive for five (5) years from disclosure. On written request Recipient shall promptly destroy or return all Confidential Information.',
      'This NDA is governed by the laws of the Republic of the Philippines.',
    ],
  },
  {
    code: 'dpa_ph',
    label: 'Data Sharing / Processing Agreement (PH — RA 10173)',
    version: '2026.07.01',
    group: 'dpa',
    summary:
      'NPC-aligned DPA. Applies whenever the vendor processes personal data on mWell\u2019s behalf. Establishes purpose, security, breach, and cross-border rules.',
    jurisdictions: ['PH'],
    riskTiers: [],
    personalDataOnly: true,
    body: [
      'This Data Sharing / Processing Agreement is entered into by mWell Corporation as Personal Information Controller ("PIC") and the vendor identified on the accreditation case as Personal Information Processor ("PIP"), pursuant to the Data Privacy Act of 2012 (RA 10173) and NPC Circular 20-04.',
      'The PIP processes personal data solely for the documented purposes agreed with the PIC. Processing outside that scope requires the PIC\u2019s prior written instruction.',
      'The PIP implements reasonable, appropriate organizational, physical and technical security measures, including but not limited to encryption at rest and in transit, access controls, MFA on privileged accounts, and staff privacy training.',
      'The PIP maintains a record of processing activities (RoPA) and makes it available to the PIC on request. The PIP notifies the PIC of any personal data breach within twenty-four (24) hours of discovery.',
      'The PIP does not engage sub-processors without the PIC\u2019s prior written consent. Any sub-processor is bound to at least the same obligations set out here.',
      'Cross-border transfers require additional NPC-compliant safeguards (adequacy decision, standard contractual clauses, or explicit data subject consent as applicable).',
      'On termination the PIP returns or securely deletes all personal data (including copies) unless retention is required by law.',
      'The PIP indemnifies the PIC for administrative fines or damages arising from the PIP\u2019s breach of this DPA.',
    ],
    fields: [
      { name: 'dpo_name', label: 'Vendor\u2019s Data Protection Officer name', kind: 'text', required: true },
      { name: 'dpo_email', label: 'Vendor\u2019s DPO contact email', kind: 'text', required: true },
      { name: 'subprocessors_declared', label: 'List declared sub-processors (or "none")', kind: 'textarea' },
    ],
  },
  {
    code: 'dpa_gdpr',
    label: 'Data Processing Agreement (GDPR Article 28)',
    version: '2026.07.01',
    group: 'dpa',
    summary:
      'GDPR-compliant DPA. Applies whenever the vendor processes personal data of EU/UK residents on mWell\u2019s behalf.',
    jurisdictions: ['EU', 'UK'],
    riskTiers: [],
    personalDataOnly: true,
    body: [
      'This Data Processing Agreement is entered into pursuant to Article 28 of the EU General Data Protection Regulation (Regulation (EU) 2016/679) and the UK GDPR where applicable, by mWell Corporation ("Controller") and the vendor identified on the accreditation case ("Processor").',
      'The Processor processes personal data only on documented instructions from the Controller and for the purposes described in the underlying service agreement.',
      'The Processor implements appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including pseudonymization/encryption, resilience of processing systems, and regular testing.',
      'The Processor assists the Controller in responding to data subject rights requests, and in meeting Article 32-36 obligations (security, breach notification, DPIA).',
      'The Processor notifies the Controller without undue delay (and no later than 48 hours) after becoming aware of a personal data breach.',
      'The Processor engages no sub-processor without prior specific or general written authorization; where general authorization is granted, the Processor informs the Controller of intended changes with a reasonable opportunity to object.',
      'On termination the Processor deletes or returns all personal data (Controller\u2019s choice) and deletes existing copies unless required to retain by EU or Member State law.',
      'Transfers of personal data outside the EEA / UK require an approved mechanism (adequacy decision, Standard Contractual Clauses, Binding Corporate Rules, or an equivalent under UK GDPR).',
    ],
    fields: [
      { name: 'dpo_name', label: 'Processor\u2019s DPO name', kind: 'text', required: true },
      { name: 'dpo_email', label: 'Processor\u2019s DPO contact email', kind: 'text', required: true },
      { name: 'transfer_mechanism', label: 'Cross-border transfer mechanism (SCCs / adequacy / BCR)', kind: 'text', required: true },
    ],
  },
  {
    code: 'code_of_conduct',
    label: 'Supplier Code of Conduct acknowledgement',
    version: '2026.07.01',
    group: 'ethics',
    summary:
      'Vendor confirms it has read the mWell Supplier Code of Conduct and will comply with it.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'The Vendor acknowledges receipt of the mWell Supplier Code of Conduct, and confirms it will conduct its dealings with mWell in accordance with it, including but not limited to:',
      '\u2022 Fair labour practices, no child or forced labour, freedom of association where legally permitted.',
      '\u2022 Health, safety and environmental compliance in all facilities used for mWell.',
      '\u2022 Zero tolerance for discrimination, harassment, or retaliation.',
      '\u2022 Compliance with applicable competition, anti-money-laundering, sanctions and data-protection laws.',
      '\u2022 Truthful and complete disclosures during accreditation and throughout the engagement.',
      'The Vendor will require the same standards from its own personnel, agents and sub-contractors when acting on the Vendor\u2019s behalf for mWell.',
    ],
  },
  {
    code: 'abac_declaration',
    label: 'Anti-Bribery & Anti-Corruption declaration',
    version: '2026.07.01',
    group: 'declaration',
    summary:
      'Vendor declares it has not engaged in bribery, kickbacks, or facilitation payments to secure mWell business.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'The Vendor declares, under penalty of perjury and termination for cause, that:',
      '\u2022 It has not offered, promised, given, requested, agreed to receive, or accepted any financial or other advantage to influence any person in connection with securing or performing an mWell engagement.',
      '\u2022 It has not, and will not, make any facilitation payment to any public official or private counterpart to expedite an mWell engagement.',
      '\u2022 It has controls in place to detect and prevent bribery and corruption, aligned with the US Foreign Corrupt Practices Act (FCPA), the UK Bribery Act 2010, and applicable local anti-graft laws.',
      '\u2022 It will promptly notify mWell if it becomes aware of any actual, alleged or attempted breach of the above.',
      'The Vendor accepts that any breach entitles mWell to terminate all engagements immediately and to seek all remedies available at law or in equity.',
    ],
  },
  {
    code: 'coi_disclosure',
    label: 'Conflict-of-Interest declaration',
    version: '2026.07.01',
    group: 'declaration',
    summary:
      'Vendor identifies (or affirms the absence of) any relationship between the Vendor and any mWell employee, officer, director, or immediate family thereof.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'The Vendor declares that, to the best of its knowledge as of the date of signing, either:',
      '(a) No director, officer, employee or immediate family member thereof of mWell has a direct or indirect ownership, employment, consulting, or beneficial interest in the Vendor; or',
      '(b) Any such relationship is fully disclosed below and the Vendor accepts that mWell may impose additional controls (or decline the engagement) on that basis.',
      'The Vendor will update this disclosure within ten (10) business days if any relationship arises during the engagement.',
    ],
    fields: [
      {
        name: 'has_relationship',
        label: 'Do any of your owners / officers / staff have a relationship with anyone at mWell?',
        kind: 'yesno',
        required: true,
      },
      {
        name: 'relationship_details',
        label: 'If yes, describe the relationship (names, roles, nature)',
        kind: 'textarea',
      },
    ],
  },
  {
    code: 'msa_countersign',
    label: 'Master Service Agreement — countersign',
    version: '2026.07.01',
    group: 'contract',
    summary:
      'Vendor countersigns the mWell Master Service Agreement covering all future POs / SOWs.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'The Vendor countersigns the current version of the mWell Master Service Agreement ("MSA"), incorporating by reference the general terms, service levels, liability caps, indemnities, IP ownership, and change-management provisions therein.',
      'Individual purchase orders and statements of work executed under the MSA are governed by the MSA except where an SOW expressly amends specified sections.',
      'The Vendor confirms it has reviewed the MSA and has authority to bind the Vendor to the MSA in its entirety.',
      'A signed copy of the MSA will be attached to this accreditation case for the audit trail.',
    ],
  },
  {
    code: 'sanctions_pep',
    label: 'Sanctions & Politically-Exposed-Person declaration',
    version: '2026.07.01',
    group: 'declaration',
    summary:
      'Vendor declares no exposure to OFAC / EU / UN sanctions and identifies any PEP relationships.',
    jurisdictions: [],
    riskTiers: ['medium', 'high'],
    body: [
      'The Vendor declares that:',
      '\u2022 Neither the Vendor, nor any of its owners with \u226525% direct or indirect interest, nor any of its directors or key officers, is currently listed on any sanctions list maintained by the US Office of Foreign Assets Control (OFAC), the EU Consolidated Sanctions List, the UN Security Council, or the UK\u2019s HM Treasury OFSI.',
      '\u2022 The Vendor will notify mWell within five (5) business days if any such listing is imposed or credibly threatened during the engagement.',
      '\u2022 The Vendor identifies below any Politically Exposed Person (PEP) — as defined by FATF Recommendation 12 — among its owners, directors or key officers, or affirms the absence of any such PEP.',
    ],
    fields: [
      {
        name: 'has_pep',
        label: 'Do any of your owners, directors or key officers qualify as a PEP?',
        kind: 'yesno',
        required: true,
      },
      {
        name: 'pep_details',
        label: 'If yes, identify the PEP (name, role, jurisdiction, relationship)',
        kind: 'textarea',
      },
    ],
  },
  {
    code: 'no_litigation',
    label: 'Statement of no pending litigation',
    version: '2026.07.01',
    group: 'declaration',
    summary:
      'Vendor declares no material pending litigation or regulatory action that could impair performance.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'The Vendor declares that, as of the date of signing, either:',
      '(a) There is no material pending litigation, arbitration, investigation, or regulatory action against the Vendor that could reasonably be expected to impair its ability to perform an mWell engagement; or',
      '(b) Any such matter is disclosed below with sufficient particulars to allow mWell to assess the risk.',
      'The Vendor will notify mWell within ten (10) business days of any new such matter arising during the engagement.',
    ],
    fields: [
      {
        name: 'has_litigation',
        label: 'Is there any material pending litigation or regulatory action to disclose?',
        kind: 'yesno',
        required: true,
      },
      {
        name: 'litigation_details',
        label: 'If yes, describe (case caption, forum, exposure, status)',
        kind: 'textarea',
      },
    ],
  },
  {
    code: 'whistleblower_ack',
    label: 'Whistleblower / speak-up policy acknowledgement',
    version: '2026.07.01',
    group: 'ethics',
    summary:
      'Vendor confirms it has received the mWell Whistleblower Policy and will not retaliate against reports made in good faith.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'The Vendor acknowledges receipt of the mWell Whistleblower / Speak-up Policy and confirms that:',
      '\u2022 It has informed its personnel assigned to mWell of the reporting channels described in the policy.',
      '\u2022 It will not retaliate, or permit retaliation, against any person for making a good-faith report through those channels.',
      '\u2022 It will cooperate with any investigation conducted by mWell arising from a report.',
    ],
  },
];

const INSTRUMENT_BY_CODE = new Map<InstrumentCode, InstrumentTemplate>(
  INSTRUMENT_TEMPLATES.map((t) => [t.code, t]),
);

/**
 * The requirement catalog references instruments through `SIGN_*` codes while
 * the templates above carry semantic codes (`nda_mutual`, `dpa_ph`, …). This
 * alias table bridges the two so `resolveInstrument` accepts either form.
 */
export const CATALOG_INSTRUMENT_ALIAS: Readonly<Record<string, InstrumentCode>> = {
  SIGN_NDA: 'nda_mutual',
  SIGN_DPA_PH: 'dpa_ph',
  SIGN_DPA_GDPR: 'dpa_gdpr',
  SIGN_CODE_ETHICS: 'code_of_conduct',
  SIGN_ABAC_DECL: 'abac_declaration',
  SIGN_COI: 'coi_disclosure',
  SIGN_MSA: 'msa_countersign',
  SIGN_PEP_SANCTIONS: 'sanctions_pep',
  SIGN_NO_LITIGATION: 'no_litigation',
  SIGN_WHISTLEBLOWER: 'whistleblower_ack',
};

/** Strict lookup by code — throws if the template is unknown. */
export function requireInstrument(code: InstrumentCode): InstrumentTemplate {
  const t = INSTRUMENT_BY_CODE.get(code);
  if (!t) throw new Error(`Unknown instrument template: ${code}`);
  return t;
}

/** Safe lookup — returns undefined if the template is unknown. */
export function findInstrument(code: string): InstrumentTemplate | undefined {
  return INSTRUMENT_BY_CODE.get(code as InstrumentCode);
}

/**
 * Lookup that accepts a template code OR a catalog `SIGN_*` instrument code.
 * Used by the sign page route (`/cases/:id/sign/:code`) so links can carry
 * whichever code the checklist row holds.
 */
export function resolveInstrument(code: string): InstrumentTemplate | undefined {
  return (
    INSTRUMENT_BY_CODE.get(code as InstrumentCode) ??
    INSTRUMENT_BY_CODE.get(CATALOG_INSTRUMENT_ALIAS[code] ?? '')
  );
}
