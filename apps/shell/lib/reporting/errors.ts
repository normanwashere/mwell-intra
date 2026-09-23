const errors = {
  invalid_data: [400, 'Invalid reporting data.'],
  invalid_request: [400, 'Invalid reporting request.'],
  unauthorized: [401, 'Reporting authentication failed.'],
  forbidden: [403, 'Reporting access is not available.'],
  not_found: [404, 'The reporting resource is not available.'],
  method_not_allowed: [405, 'This reporting method is not supported.'],
  conflict: [409, 'The reporting state does not match this request.'],
  expired: [410, 'This reporting snapshot or checkpoint has expired.'],
  too_large: [413, 'Reporting input exceeds the allowed size.'],
  unsupported_media: [415, 'Use UTF-8 JSON for reporting requests.'],
  rate_limited: [429, 'Reporting requests are temporarily limited.'],
  unavailable: [503, 'Reporting is temporarily unavailable.'],
  invalid_response: [502, 'The reporting response could not be verified.'],
} as const;

export class ReportingError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code][1]);
    this.name = 'ReportingError';
    this.status = errors[code][0];
  }
}

export class ReportingHttpError extends ReportingError {
  readonly retryAfterSeconds: number | null;
  constructor(code: keyof typeof errors, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'ReportingHttpError';
    this.retryAfterSeconds = (this.status === 429 || this.status === 503) && retryAfterSeconds !== null && Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 0 && retryAfterSeconds <= 86400 ? retryAfterSeconds : null;
  }
}

const httpErrorCodes: Partial<Record<number, keyof typeof errors>> = {
  400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  409: 'conflict', 410: 'expired', 429: 'rate_limited', 503: 'unavailable',
};

export function reportingHttpFailure(status: number, retryAfter: string | null): ReportingHttpError | null {
  const code = httpErrorCodes[status];
  if (!code) return null;
  let seconds: number | null = null;
  if (retryAfter !== null) {
    if (/^\d{1,5}$/.test(retryAfter)) seconds = Number(retryAfter);
    else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)) {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) seconds = Math.max(0, Math.ceil((date - Date.now()) / 1000));
    }
  }
  return new ReportingHttpError(code, seconds);
}

export function reportingErrorResponse(error: unknown): Response {
  const code = error instanceof ReportingError && Object.hasOwn(errors, error.code) ? error.code : 'unavailable';
  const safe = new ReportingError(code);
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (error instanceof ReportingHttpError) {
    const retry = new ReportingHttpError(code, error.retryAfterSeconds).retryAfterSeconds;
    if (retry !== null) headers['Retry-After'] = String(retry);
  }
  return Response.json({ error: { code: safe.code, message: safe.message } }, {
    status: safe.status,
    headers,
  });
}
