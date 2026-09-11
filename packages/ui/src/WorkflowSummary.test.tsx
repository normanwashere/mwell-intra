import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowSummary } from './WorkflowSummary';

describe('WorkflowSummary', () => {
  it('keeps status, next responsibility, and next step ahead of supplementary links', () => {
    const html = renderToStaticMarkup(createElement(WorkflowSummary, {
      status: 'Awaiting review', owner: 'Procurement / Finance', nextStep: 'Confirm the current evidence.',
      children: createElement('a', { href: '#policy' }, 'Policy evidence'),
    }));
    const labels = ['Current status', 'Next responsibility', 'Next step', 'Policy evidence'];
    const positions = labels.map(label => html.indexOf(label));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('minmax(0,2fr)');
    expect(html).toContain('flex-wrap');
    expect(html).not.toContain('<button');
  });
  it('uses the same responsibility labels without implying a named assignment', () => {
    const html = renderToStaticMarkup(createElement(WorkflowSummary, { status: 'Awaiting approval', owner: 'Department approver', nextStep: 'Review the request and record a decision.' }));
    for (const label of ['Current status', 'Next responsibility', 'Next step', 'Department approver']) expect(html).toContain(label);
    expect(html).not.toContain('Assigned to you');
    expect(html).not.toContain('<button');
  });
  it('does not present unknown values as ready or completed', () => {
    const html = renderToStaticMarkup(createElement(WorkflowSummary, { status: ' ', owner: '', nextStep: '' }));
    expect(html).toContain('Status not confirmed');
    expect(html).toContain('Not confirmed');
    expect(html).not.toContain('text-emerald');
  });
  it('gives a blocker priority over success styling and escapes server text', () => {
    const html = renderToStaticMarkup(createElement(WorkflowSummary, { status: 'Approved', owner: 'Warehouse', nextStep: 'Resolve the hold.', tone: 'success', blocker: '<script>bad</script>' }));
    expect(html).toContain('Needs attention:');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('text-emerald');
  });
  it('renders only explicitly supplied navigation and retains long-text wrapping', () => {
    const html = renderToStaticMarkup(createElement(WorkflowSummary, { status: 'Review', owner: 'Legal', nextStep: 'Review evidence.', children: createElement('a', { href: '#evidence' }, 'Review evidence') }));
    expect(html).toContain('href="#evidence"');
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).toContain('lg:col-span-1');
  });
});
