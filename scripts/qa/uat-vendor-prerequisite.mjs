import { auditPersonas } from './uat-audit-identities.mjs';

// Route audits start after invitation acceptance. The separate invitation journey
// must still prove actual delivery and acceptance; this fixture cannot do that.
export async function reconcileCiVendorPrerequisite({ appEnv, identityScope, persona, userId, vendorId, request }) {
  const expected = identityScope && auditPersonas(identityScope).find(candidate => candidate.role === 'vendor_representative');
  if (appEnv !== 'uat' || !expected || persona.kind !== 'vendor' ||
      persona.role !== expected.role || persona.email !== expected.email || !userId || !vendorId) {
    throw new Error('Invitation prerequisites are restricted to an isolated UAT vendor.');
  }
  const id = `ci-route-vendor-${identityScope}-${userId}`;
  const headers = { 'Accept-Profile': 'legal', 'Content-Profile': 'legal' };
  const endpoint = `/rest/v1/vendor_invites?id=eq.${encodeURIComponent(id)}&select=*`;
  const [existing] = await request(endpoint, { headers });
  if (existing && (existing.auth_user_id !== userId || existing.vendor_id !== vendorId ||
      existing.profile?.synthetic !== true || existing.profile?.identity_scope !== identityScope)) {
    throw new Error('CI vendor prerequisite ownership does not match.');
  }
  const valid = row => row?.auth_user_id === userId && row.vendor_id === vendorId &&
    row.status === 'accepted' && row.link_generation === 1 && row.accepted_generation === 1 &&
    row.profile?.synthetic === true && row.profile?.email_delivery_certified === false;
  if (!valid(existing)) {
    await request('/rest/v1/vendor_invites?on_conflict=id', {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id, auth_user_id: userId, vendor_id: vendorId, email: persona.email,
        company_name: `CI ${identityScope} synthetic route prerequisite`,
        status: 'accepted', link_generation: 1, accepted_generation: 1,
        accepted_at: new Date().toISOString(),
        profile: { synthetic: true, identity_scope: identityScope,
          purpose: 'Post-invitation route audit prerequisite only', email_delivery_certified: false },
      }),
    });
  }
  const [saved] = await request(endpoint, { headers });
  if (!valid(saved)) throw new Error('CI vendor prerequisite readback failed.');
}
