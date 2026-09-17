import type { AttentionItem, AttentionStatus } from './session-attention.js';
import type { SessionRow } from './session-rest.js';

const ACTIVE_STATUSES: ReadonlySet<AttentionStatus> = new Set(['working', 'waiting', 'starting']);

function sameProfile(a?: string, b?: string): boolean {
  return (a || 'default') === (b || 'default');
}

export function isActiveSessionRow(row: SessionRow, items: readonly AttentionItem[]): boolean {
  return items.some(
    (item) =>
      ACTIVE_STATUSES.has(item.status) &&
      item.storedId === row.id &&
      (!item.owner || sameProfile(item.owner.profile, row.profile)),
  );
}

export function visibleSessionRows(
  rows: readonly SessionRow[],
  items: readonly AttentionItem[],
): SessionRow[] {
  return rows.filter((row) => !isActiveSessionRow(row, items));
}
