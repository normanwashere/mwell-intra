/** PWC01 proves the fresh command and all its writes rolled back, including on retry. */
export class CycleCountRejectedError extends Error {
  readonly code = 'PWC01';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CycleCountRejectedError';
  }
}

export type CycleCountOutcome =
  | { status: 'committed' }
  | { status: 'rejected'; code: 'PWC01'; message: string }
  | { status: 'unknown'; message: string };
