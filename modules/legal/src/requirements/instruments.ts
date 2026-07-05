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

export const INSTRUMENT_TEMPLATES: readonly InstrumentTemplate[] = [
  {
    code: 'nda_mutual',
    label: 'Mutual Non-Disclosure Agreement',
    version: '2026.07.01',
    group: 'nda',
    summary:
      'Standard mutual NDA. Both parties treat confidential information disclosed under the accreditation as protected for five (5) years from disclosure.',
    jurisdictions: [],
    riskTiers: [],
    body: [
      'This Mutual Non-Disclosure Agreement is entered into by mWell Corporation ("mWell") and the vendor identified on the accreditation case ("Vendor").',
      'Each party may disclose to the other information that is confidential or proprietary, including but not limited to business plans, pricing, technical designs, patient data references (aggregated only), source code, and product roadmap ("Confidential Information").',
      'The receiving party shall (a) use Confidential Information solely to evaluate and perform the contemplated engagement; (b) protect it with at least the same care it applies to its own confidential information (never less than reasonable care); and (c) restrict access to personnel with a need to know who are themselves under written confidentiality obligations.',
      'Confidential Information does not include information that is or becomes public through no fault of the receiving party, was rightfully known before disclosure, is independently developed without use of the disclosed information, or is rightfully received from a third party without confidentiality obligations.',
      'The receiving party may disclose Confidential Information if compelled by law, provided it gives the disclosing party prompt notice (where legally permitted) and cooperates in seeking a protective order.',
      'The obligations in this NDA survive for five (5) years from the date of disclosure. All Confidential Information remains the property of the disclosing party.',
      'This NDA is governed by the laws of the Republic of the Philippines. Any dispute arising from this NDA is submitted to the exclusive jurisdiction of the courts of Metro Manila.',
      'By signing below, the Vendor\u2019s authorized signatory represents they have authority to bind the Vendor to this NDA.',
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
