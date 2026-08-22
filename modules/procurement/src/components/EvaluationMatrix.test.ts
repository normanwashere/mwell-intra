import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EvaluationMatrix } from './EvaluationMatrix';

describe('EvaluationMatrix', () => {
  it('presents profile-driven thresholds and never exposes an approval checkbox', () => {
    const html = renderToStaticMarkup(createElement(EvaluationMatrix, {
      value: { intendedResponses: 3, vendorsInvited: 3, responsesReceived: 2 },
    }));

    expect(html).toContain('Competitive sourcing normally targets 3-4 accredited vendors');
    expect(html).toContain('Three usable responses are required before sealed-bid opening.');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('governed sourcing workspace');
  });
});
