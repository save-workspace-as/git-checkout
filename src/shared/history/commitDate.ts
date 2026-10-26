import * as l10n from '@vscode/l10n';

function monthLabel(month: number): string {
  const labels = [
    l10n.t('Jan'),
    l10n.t('Feb'),
    l10n.t('Mar'),
    l10n.t('Apr'),
    l10n.t('May'),
    l10n.t('Jun'),
    l10n.t('Jul'),
    l10n.t('Aug'),
    l10n.t('Sep'),
    l10n.t('Oct'),
    l10n.t('Nov'),
    l10n.t('Dec'),
  ];
  return labels[month] ?? '';
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** A date and time that does not depend on today, such as "22 Oct 2026 at 11:34". */
export function formatDateTime(date: Date): string {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return l10n.t('{0} {1} {2} at {3}', date.getDate(), monthLabel(date.getMonth()), date.getFullYear(), time);
}

/** A label in local time: "Today at 14:50", "Yesterday at 09:41", "7 Oct 2026 at 03:38". */
export function formatCommitDate(unixSeconds: number, now: Date = new Date()): string {
  const date = new Date(unixSeconds * 1000);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, now)) {
    return l10n.t('Today at {0}', time);
  }
  if (sameDay(date, yesterday)) {
    return l10n.t('Yesterday at {0}', time);
  }
  return formatDateTime(date);
}
