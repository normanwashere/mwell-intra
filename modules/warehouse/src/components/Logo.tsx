import { clsx } from "clsx";

interface LogoProps {
  className?: string;
  /** Render a white treatment for dark backgrounds (sidebar / loading screen). */
  variant?: "color" | "light";
  title?: string;
}

export function Logo({
  className,
  variant = "color",
  title = "mWell",
}: LogoProps) {
  return (
    <span
      className={clsx("inline-flex select-none items-center", className)}
      role="img"
      aria-label={title}
      title={title}
    >
      <img
        src="/mwell-wordmark.png"
        alt=""
        className={clsx(
          "h-full w-auto max-w-none object-contain",
          variant === "light"
            ? "brightness-0 invert"
            : "dark:brightness-0 dark:invert",
        )}
      />
    </span>
  );
}
