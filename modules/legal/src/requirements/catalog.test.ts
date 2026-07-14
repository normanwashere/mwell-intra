import { describe, expect, it } from 'vitest';

import { CATALOG_BY_CODE, REQUIREMENT_CATALOG } from './catalog';
import { isPolicyBackedRequirement } from './policy';

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
      policySource: expect.objectContaining({ id: 'vendor-accreditation-v2025' }),
    });
  });
});
