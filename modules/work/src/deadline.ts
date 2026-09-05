/** Business deadlines use the Philippine calendar, including date-only values. */
export function deadlineLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Due date unavailable';
  const calendar = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const exact = calendar(date);
  const days = Math.round((Date.parse(exact) - Date.parse(calendar(now))) / 86400000);
  return `${days === 0 ? 'Due today' : days > 0 ? `Due in ${days} days` : `Overdue by ${-days} days`} (${exact})`;
}
