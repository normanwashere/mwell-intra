import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModuleHero } from './primitives';

describe('ModuleHero responsive hierarchy', () => {
  it('keeps the watermark compact and behind readable content', () => {
    const markup = renderToStaticMarkup(
      <ModuleHero
        eyebrow="Warehouse dashboard"
        title="A long operational title that must remain readable"
        description="Status and next action remain visible on mobile."
        icon="grid"
      />,
    );

    expect(markup).toContain('data-module-hero-watermark="true"');
    expect(markup).toContain('h-16 w-16 sm:h-20 sm:w-20');
    expect(markup).toContain('relative z-10');
    expect(markup).not.toContain('h-36 w-36');
  });
});
