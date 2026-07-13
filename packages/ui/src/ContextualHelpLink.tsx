import { Icon } from "./Icon";

export function ContextualHelpLink({
  articleId,
  title,
  className = "",
}: {
  articleId: string;
  title: string;
  className?: string;
}) {
  const label = `Help for ${title}`;
  return (
    <a
      href={`/knowledge?article=${encodeURIComponent(articleId)}`}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}
    >
      <Icon name="info" className="h-5 w-5" />
    </a>
  );
}
