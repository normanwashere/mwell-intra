import assert from 'node:assert/strict';

export async function selectDoaFixtureApprovers(page, { departmentHeadId, finalApproverId }) {
  assert.match(departmentHeadId ?? '', /^[0-9a-f-]{36}$/i, 'Named department-head fixture identity is required');
  assert.match(finalApproverId ?? '', /^[0-9a-f-]{36}$/i, 'Named final-approver fixture identity is required');
  assert.notEqual(departmentHeadId, finalApproverId, 'Use distinct fixture approvers');
  assert.equal(await page.getByLabel(/Tier \d+ named approver/).count(), 2,
    'Review the fixture mapping when the default DOA tiers change');
  assert.equal(await page.getByLabel('Tier 1', { exact: true }).inputValue(), 'dept_head');
  assert.equal(await page.getByLabel('Tier 2', { exact: true }).inputValue(), 'final_approver');
  await page.getByLabel('Tier 1 named approver', { exact: true }).selectOption(departmentHeadId);
  await page.getByLabel('Tier 2 named approver', { exact: true }).selectOption(finalApproverId);
}
