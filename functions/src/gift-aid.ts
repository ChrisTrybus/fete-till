const isDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100
  && value !== '.' && value !== '..' && !value.includes('/') && !/^__.*__$/.test(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

export function readGiftAidRequest(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const { eventId, declaration } = value as Record<string, unknown>;
  if (!isDocumentId(eventId) || !declaration || typeof declaration !== 'object') return null;
  const d = declaration as Record<string, unknown>;
  const text = (field: string, max: number) => {
    const value = d[field];
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : null;
  };
  const firstName = text('firstName', 35);
  const lastName = text('lastName', 35);
  const house = text('house', 40);
  const postcode = text('postcode', 8);
  if (!isDocumentId(d.saleId) || !isTimestamp(d.at) || !firstName || !lastName || !house
    || !postcode || !/^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/.test(postcode)) return null;
  return { eventId, saleId: d.saleId, at: d.at, firstName, lastName, house, postcode };
}

export function giftAidDonation(sale: Record<string, unknown>, uid: string) {
  const { at, lines, total, tillName, deviceId } = sale;
  if (sale.createdBy !== uid || !isTimestamp(at) || typeof tillName !== 'string' || typeof deviceId !== 'string'
    || typeof total !== 'number' || !Number.isSafeInteger(total) || !Array.isArray(lines) || lines.length > 100) return null;
  let amount = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object') return null;
    const { price, qty, donation } = line;
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(qty) || qty <= 0
      || (donation !== undefined && typeof donation !== 'boolean')) return null;
    if (donation) amount += price * qty;
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > total) return null;
  return { amount, donatedAt: at, tillName, deviceId };
}
