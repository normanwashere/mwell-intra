import { describe, expect, it } from 'vitest';
import {
  VENDOR_ACCREDITATION_V2025,
  buildV2025Checklist,
  validateV2025Application,
} from './vendorAccreditationV2025';
import type { VendorApplicationSnapshot } from '../types';
import { CATALOG_BY_CODE } from './catalog';
import { isPolicyBackedRequirement } from './policy';

function validApplication(
  over: Partial<VendorApplicationSnapshot> = {},
): VendorApplicationSnapshot {
  return {
    policyVersion: 'vendor-accreditation-v2025',
    entityType: 'corporation',
    jurisdiction: 'PH',
    company: {
      tradeName: 'Policy Test Corporation',
      contactNumber: '+63 917 000 0000',
      businessAddress: 'Pasig City',
      incorporationDate: '2020-01-01',
      incorporationPlace: 'Pasig City',
      tin: '000-000-000-000',
      email: 'vendor@example.com',
      website: 'https://example.com',
      principalName: 'A. Signatory',
      principalEmail: 'signatory@example.com',
      principalContactNumber: '+63 917 000 0001',
      correspondenceName: 'V. Contact',
      correspondenceEmail: 'contact@example.com',
      correspondenceContactNumber: '+63 917 000 0002',
      productsOrServices: 'Technology services',
      businessType: 'corporation',
    },
    manpower: {
      countAndExpertise: '12 developers, 3 QA, 2 project managers',
      qualifications: 'Cloud and security certifications',
      completedProjects: 'Three healthcare integrations',
    },
    technologyServiceProvider: true,
    technologyQualifications: [
      { pool: 'nodejs', qualified: true, remarks: 'Production references verified' },
    ],
    fieldDispositions: {},
    declaration: {
      accepted: true,
      noLegalActions: true,
      disclosureDetails: '',
      verificationAuthorized: true,
      signerName: 'A. Signatory',
      signerTitle: 'President',
      signedAt: '2026-07-10T00:00:00.000Z',
    },
    ...over,
  };
}

describe('Vendor Accreditation Form v.2025', () => {
  it('pins the supplied source and version', () => {
    expect(VENDOR_ACCREDITATION_V2025).toMatchObject({
      id: 'vendor-accreditation-v2025',
      sourceDocument: 'LGL004-Vendor Accreditation Form 2.0 (3).pdf',
      owner: 'Vendor Management Office / Legal',
    });
  });

  it('blocks only catalog requirements carrying an explicit governing source', () => {
    expect(isPolicyBackedRequirement(CATALOG_BY_CODE['PH_BIR_2303']!)).toBe(true);
    expect(isPolicyBackedRequirement(CATALOG_BY_CODE['PH_BIR_0605']!)).toBe(false);
  });

  it('builds the corporation baseline from the form', () => {
    expect(buildV2025Checklist('corporation').map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'PH_SEC_REG_ARTICLES_BYLAWS',
        'PH_BIR_2303',
        'PH_AFS_3Y',
        'PH_SECRETARY_CERT',
        'PH_GIS',
        'PH_MAYORS_PERMIT',
        'PH_COMPANY_PROFILE',
        'PH_CLIENT_PORTFOLIO',
        'PH_BANK_PROOF',
        'PH_OFFICIAL_RECEIPT',
        'SIGN_NDA',
      ]),
    );
  });

  it('uses distinct sole-proprietor and partnership evidence', () => {
    const sole = buildV2025Checklist('sole_prop').map((item) => item.code);
    const partnership = buildV2025Checklist('partnership').map((item) => item.code);
    expect(sole).toContain('PH_DTI_REG');
    expect(sole).not.toContain('PH_PARTNERSHIP_ARTICLES');
    expect(partnership).toEqual(
      expect.arrayContaining(['PH_SEC_REG', 'PH_PARTNERSHIP_ARTICLES', 'PH_PARTNERSHIP_RESOLUTION']),
    );
  });

  it('marks conditional privacy and cybersecurity evidence without forcing it universally', () => {
    const base = buildV2025Checklist('corporation');
    expect(base.find((item) => item.code === 'PH_PRIVACY_COMPLIANCE')?.required).toBe(false);
    expect(
      buildV2025Checklist('corporation', { handlesPersonalData: true })
        .find((item) => item.code === 'PH_PRIVACY_COMPLIANCE')?.required,
    ).toBe(true);
    expect(
      buildV2025Checklist('corporation', { technologyServiceProvider: true })
        .find((item) => item.code === 'PH_CYBERSECURITY_POLICIES')?.required,
    ).toBe(true);
  });

  it('allows reviewer-controlled foreign equivalents', () => {
    const rows = buildV2025Checklist('corporation', { jurisdiction: 'OTHER' });
    expect(rows.filter((row) => row.authority !== 'mWell Legal').every((row) => row.equivalentAllowed)).toBe(true);
  });

  it('requires an accepted signed declaration and complete structured fields', () => {
    expect(validateV2025Application(validApplication()).ok).toBe(true);
    const invalid = validateV2025Application(
      validApplication({ declaration: { ...validApplication().declaration, accepted: false } }),
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toContain('declaration.accepted');
  });

  it('accepts N/A only with a reason and requires technology qualification when applicable', () => {
    const missingWebsite = validApplication();
    missingWebsite.company.website = '';
    expect(validateV2025Application(missingWebsite).errors).toContain('company.website');

    const withNa = validApplication({
      fieldDispositions: { 'company.website': { status: 'not_applicable', reason: 'No public website' } },
    });
    withNa.company.website = '';
    expect(validateV2025Application(withNa).errors).not.toContain('company.website');

    expect(
      validateV2025Application(validApplication({ technologyQualifications: [] })).errors,
    ).toContain('technologyQualifications');
  });
});
