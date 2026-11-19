export function recoverOpeningFloat({
  keyId, currentKey, currentSuperseded, hasBinding, previousKey, moving, savedFloat, pendingFloat,
}: {
  keyId: string;
  currentKey: unknown;
  currentSuperseded: boolean;
  hasBinding: boolean;
  previousKey: unknown;
  moving: boolean;
  savedFloat: unknown;
  pendingFloat?: number;
}): number | null {
  if (moving && previousKey !== keyId) return null;
  // An active member can replace a lost key. A superseded member must present
  // the key that actually moved its float.
  if (currentKey && currentKey !== keyId && (hasBinding || currentSuperseded)) return null;
  return pendingFloat ?? (typeof savedFloat === 'number' && Number.isSafeInteger(savedFloat) && savedFloat > 0 ? savedFloat : 0);
}
