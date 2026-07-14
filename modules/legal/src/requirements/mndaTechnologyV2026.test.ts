import { describe, expect, it } from 'vitest';
import {
  generateTechnologyMnda,
  technologyMndaExpiresAt,
  technologyMndaReturnOrDestroyDueAt,
} from './instruments';

const fields = {
  executionDate: '2026-07-10',
  serviceProviderName: 'Policy Test Technology Corporation',
  serviceProviderAddress: 'Pasig City, Philippines',
  potentialTransaction: 'software development and systems integration',
  serviceProviderNoticeName: 'A. Signatory',
  serviceProviderNoticeAddress: 'Pasig City, Philippines',
  serviceProviderNoticeFax: 'N/A',
  serviceProviderNoticeEmail: 'legal@example.com',
  serviceProviderSignatoryName: 'A. Signatory',
  serviceProviderSignatoryDesignation: 'President',
  mphtcSignatoryName: 'Gerb Reign Inajada',
  mphtcSignatoryDesignation: 'Chief Technology Officer',
};

describe('technology-service MNDA clean master', () => {
  it('generates the supplied substantive terms and a SHA-256 hash', async () => {
    const generated = await generateTechnologyMnda(fields);
    expect(generated.templateVersion).toBe('mnda-tech-service-provider-2026.06.10-clean-v1');
    expect(generated.canonicalText).toContain('Policy Test Technology Corporation');
    expect(generated.canonicalText).toContain('earlier of');
    expect(generated.canonicalText).toContain('two (2) years');
    expect(generated.canonicalText).toContain('five (5) business days');
    expect(generated.canonicalText).toContain('Republic Act No. 10173');
    expect(generated.canonicalText).toMatch(/need[- ]to[- ]know/i);
    expect(generated.canonicalText).toMatch(/definitive agreement/i);
    expect(generated.canonicalText).toMatch(/return or destroy/i);
    expect(generated.canonicalText).toContain('Philippine Dispute Resolution Center Inc.');
    expect(generated.canonicalText).toContain('three (3) arbitrators');
    expect(generated.canonicalText).toContain('Makati, Philippines');
    expect(generated.canonicalText).toContain('English');
    expect(generated.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not reproduce the source-template defects or incompatible app terms', async () => {
    const text = (await generateTechnologyMnda(fields)).canonicalText;
    expect(text).not.toContain('NCS PHILIPPINES');
    expect(text).not.toContain('MPHTC and NCS');
    expect(text).not.toContain('five (5) years');
    expect(text).not.toContain('exclusive jurisdiction of the courts');
  });

  it('calculates the return/destruction obligation in business days', () => {
    expect(technologyMndaReturnOrDestroyDueAt('2026-07-10T09:00:00.000Z')).toBe(
      '2026-07-17T09:00:00.000Z',
    );
  });

  it('expires at the earlier of two years or the definitive agreement', () => {
    expect(technologyMndaExpiresAt('2026-07-10T09:00:00.000Z')).toBe(
      '2028-07-10T09:00:00.000Z',
    );
    expect(technologyMndaExpiresAt(
      '2026-07-10T09:00:00.000Z',
      '2027-01-15T03:00:00.000Z',
    )).toBe('2027-01-15T03:00:00.000Z');
  });
});
