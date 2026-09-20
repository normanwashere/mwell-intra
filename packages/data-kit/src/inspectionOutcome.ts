/** Rejection proves only this attempt did not commit, never an earlier uncertain attempt. */
export class InspectionRejectedError extends Error {
  readonly outcome = 'rejected';
  constructor(message: string, readonly code: string, readonly stage: 'not-sent' | 'rolled-back' = 'rolled-back') {
    super(message);
    this.name = 'InspectionRejectedError';
  }
}

export type InspectionOutcome =
  | { status: 'committed' }
  | { status: 'rejected'; code: string; message: string; stage: 'not-sent' | 'rolled-back' }
  | { status: 'uncertain'; message: string };
