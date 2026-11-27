export interface RuleRecord {
  kind: string;
  frame: number;
  [key: string]: unknown;
}

export interface RuleDifference {
  frame: number;
  object: string;
  field: string;
  reference: unknown;
  candidate: unknown;
}

const identityGroups: Record<string, string> = { units: 'unit', bullets: 'bullet', buffs: 'buff' };
const identityFields = ['uid', 'object', 'type'];

function fields(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function identity(value: unknown, group: string, fallback: string): string {
  const entry = fields(value);
  if (typeof entry?.['object'] === 'string') return entry['object'];
  if (typeof entry?.['uid'] === 'number' && identityGroups[group]) return `${identityGroups[group]}:${entry['uid']}`;
  return fallback;
}

function compare(
  reference: unknown, candidate: unknown, frame: number, field: string, object: string,
): RuleDifference | null {
  if (Object.is(reference, candidate)) return null;
  if (Array.isArray(reference) && Array.isArray(candidate)) {
    const group = field.split('.').at(-1) ?? '';
    for (let index = 0; index < Math.max(reference.length, candidate.length); index++) {
      const label = identity(reference[index] ?? candidate[index], group, object);
      const difference = compare(reference[index], candidate[index], frame, `${field}[${index}]`, label);
      if (difference) return difference;
    }
    return null;
  }
  const referenceFields = fields(reference), candidateFields = fields(candidate);
  if (referenceFields && candidateFields) {
    const remaining = [...new Set([...Object.keys(referenceFields), ...Object.keys(candidateFields)])]
      .filter(key => !identityFields.includes(key)).sort();
    const keys = [...identityFields, ...remaining];
    for (const key of keys) {
      const child = field ? `${field}.${key}` : key;
      const difference = compare(referenceFields[key], candidateFields[key], frame, child, object);
      if (difference) return difference;
    }
    return null;
  }
  return { frame, object, field, reference: reference ?? null, candidate: candidate ?? null };
}

export function compareRuleRecord(reference?: RuleRecord, candidate?: RuleRecord): RuleDifference | null {
  if (!reference || !candidate) {
    if (!reference && !candidate) return null;
    return compare(reference, candidate, reference?.frame ?? candidate!.frame, 'record', 'trace');
  }
  const frame = Math.min(reference.frame, candidate.frame);
  return compare(reference.frame, candidate.frame, frame, 'frame', 'trace')
    ?? compare(reference.kind, candidate.kind, frame, 'kind', 'trace')
    ?? compare(reference, candidate, frame, '', reference.kind);
}

export function firstRuleDifference(reference: readonly RuleRecord[], candidate: readonly RuleRecord[]): RuleDifference | null {
  for (let index = 0; index < Math.max(reference.length, candidate.length); index++) {
    const difference = compareRuleRecord(reference[index], candidate[index]);
    if (difference) return difference;
  }
  return null;
}
