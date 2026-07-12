import { Icon } from '@intra/ui';

export function ProcurementAccessDenied({
  title = 'Access denied',
  message = "This procurement workspace isn't part of your role.",
}: {
  readonly title?: string;
  readonly message?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="grid min-h-[50vh] place-items-center p-6 text-center"
    >
      <div className="max-w-sm space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-inset text-faint">
          <Icon name="lock" className="h-5 w-5" />
        </span>
        <h1 className="text-base font-semibold text-ink">{title}</h1>
        <p className="text-sm text-muted">{message}</p>
        <a href="/procurement" className="btn-primary inline-flex">
          Back to procurement
        </a>
      </div>
    </div>
  );
}
