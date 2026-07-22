import React from "react";
import Image from "next/image";
import { cx } from "@shell/lib/cx";

interface MwellIntraLogoProps {
  className?: string;
  labelClassName?: string;
  logoClassName?: string;
  showLabel?: boolean;
  variant?: "color" | "light";
}

export function MwellIntraLogo({
  className,
  labelClassName,
  logoClassName,
  showLabel = true,
  variant = "color",
}: MwellIntraLogoProps) {
  return (
    <span
      className={cx(
        "inline-flex min-w-0 select-none items-center gap-2",
        className,
      )}
      role="img"
      aria-label={showLabel ? "mWell Intra" : "mWell"}
    >
      <Image
        src="/mwell-wordmark.png"
        width={500}
        height={154}
        alt=""
        className={cx("h-7 w-auto max-w-none object-contain", logoClassName)}
      />
      {showLabel && (
        <span
          className={cx(
            "shrink-0 font-display text-sm font-bold tracking-normal",
            variant === "light" ? "text-white" : "text-ink",
            labelClassName,
          )}
        >
          Intra
        </span>
      )}
    </span>
  );
}
