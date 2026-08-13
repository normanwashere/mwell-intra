export interface AccessDeniedProps {
  readonly module: string;
  readonly message: string;
  readonly recoveryOwner?: string;
  readonly recoveryAction?: string;
  readonly returnHref?: string;
  readonly returnLabel?: string;
}

export function AccessDenied({
  module,
  message,
  recoveryOwner = "Platform Administrator",
  recoveryAction =
    "Ask the recovery owner to verify your current role and active certification, then sign in again.",
  returnHref = "/",
  returnLabel = "Back to home",
}: AccessDeniedProps) {
  return (
    <section className="grid min-h-[60vh] place-items-center px-4 py-10 text-center">
      <div
        role="alert"
        aria-live="polite"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-e1"
      >
        <h1 className="font-display text-xl font-bold text-ink">
          {module} access required
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
        <div className="mt-4 rounded-lg bg-inset p-3 text-left text-sm leading-6">
          <p className="font-semibold text-ink">
            Recovery owner: {recoveryOwner}
          </p>
          <p className="mt-1 text-muted">{recoveryAction}</p>
        </div>
        <a
          href={returnHref}
          className="btn-primary mt-5 min-h-11 w-full justify-center"
        >
          {returnLabel}
        </a>
      </div>
    </section>
  );
}
