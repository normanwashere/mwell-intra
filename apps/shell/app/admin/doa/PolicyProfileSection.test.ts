import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { PolicyProfileSection } from './PolicyProfileSection';

it('keeps procurement policy controls separate from DOA and hides live actions from unauthorized users', () => {
  const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(PolicyProfileSection, { canManage: false, mode: 'memory', client: null })));
  expect(html).toContain('Procurement policy profiles');
  expect(html).toContain('Separate from DOA');
  expect(html).toContain('MPIC Procurement Policy February2025.docx');
  expect(html).toContain('Maker-checker');
  expect(html).toContain('disabled');
});
