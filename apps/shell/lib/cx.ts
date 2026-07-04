// Tiny classname joiner (avoids adding a runtime dep for the shell's own chrome;
// @intra/ui uses clsx internally for its primitives).
export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(' ');
}
