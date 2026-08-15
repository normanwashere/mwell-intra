import { describe, expect, it } from 'vitest';

import { CATALOG_BY_CODE, REQUIREMENT_CATALOG } from './catalog';
import { isPolicyBackedRequirement, tailorRequirements } from './policy';

const baseProfile = {
  jurisdiction: 'PH',
  entityType: 'corporation',
  category: 'consulting',
  riskTier: 'medium',
  contractType: 'spot_po',
  spendBand: '100k_1m',
  handlesPersonalData: false,
  technologyServiceProvider: false,
} as const;

describe('vendor requirement catalogue source authority', () => {
  it('does not make ISO 27001 a universal accreditation blocker by inference', () => {
    expect(CATALOG_BY_CODE.ISO_27001?.required).toBe(false);
    expect(isPolicyBackedRequirement(CATALOG_BY_CODE.ISO_27001!)).toBe(false);
  });

  it('allows a requirement to block only when explicit source authority is recorded', () => {
    for (const requirement of REQUIREMENT_CATALOG.filter(isPolicyBackedRequirement)) {
      expect(requirement.policySource).toBeDefined();
      expect(requirement.policySource?.sourceDocument).toBeTruthy();
      expect(requirement.policySource?.section).toBeTruthy();
    }
  });

  it('keeps LGL004 privacy and cybersecurity evidence conditional', () => {
    expect(CATALOG_BY_CODE.PH_PRIVACY_IMPACT_ASSESSMENT).toMatchObject({
      requiresPersonalData: true,
      policySource: expect.objectContaining({ id: 'vendor-accreditation-v2025' }),
    });
    expect(CATALOG_BY_CODE.CYBERSECURITY_POLICIES).toMatchObject({
      requiresTechnologyService: true,
      policySource: expect.objectContaining({ id: 'vendor-accreditation-v2025' }),
    });
  });

  it('assigns the technology MNDA only to technology service providers', () => {
    const nonTechnology = tailorRequirements(baseProfile);
    const technology = tailorRequirements({
      ...baseProfile,
      technologyServiceProvider: true,
    });

    expect(nonTechnology.map((row) => row.code)).toContain('SIGN_NDA_STANDARD');
    expect(nonTechnology.map((row) => row.code)).not.toContain('SIGN_MNDA_TECH');
    expect(technology.map((row) => row.code)).toContain('SIGN_MNDA_TECH');
    expect(technology.map((row) => row.code)).not.toContain('SIGN_NDA_STANDARD');
    expect(CATALOG_BY_CODE.SIGN_MNDA_TECH?.instrumentCode).toBe('nda_mutual');
    expect(CATALOG_BY_CODE.SIGN_NDA_STANDARD?.instrumentCode).toBe('nda_one_way');
  });

  it('does not infer technology controls from a broad consulting category', () => {
    const nonTechnology = tailorRequirements(baseProfile).map((row) => row.code);
    const technology = tailorRequirements({
      ...baseProfile,
      technologyServiceProvider: true,
    }).map((row) => row.code);

    expect(nonTechnology).not.toContain('CYBERSECURITY_POLICIES');
    expect(technology).toContain('CYBERSECURITY_POLICIES');
  });
});
