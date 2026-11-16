import type { Sale, SaleLine } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isLine = (value: unknown): value is SaleLine =>
  isRecord(value) && typeof value.itemId === 'string' && typeof value.name === 'string'
  && isPence(value.price) && isPence(value.qty) && value.qty > 0
  && Number.isSafeInteger(value.price * value.qty)
  && (value.donation === undefined || typeof value.donation === 'boolean');

export function isSaleRecord(value: unknown): value is Sale {
  return isRecord(value)
    && typeof value.id === 'string' && value.id.length > 0
    && !Object.hasOwn(Object.prototype, value.id)
    && isPence(value.at) && value.at <= 8_640_000_000_000_000
    && isPence(value.total) && isPence(value.tendered)
    && (value.method === 'cash' || value.method === 'card')
    && typeof value.tillName === 'string' && typeof value.deviceId === 'string'
    && typeof value.voided === 'boolean'
    && Array.isArray(value.lines) && value.lines.every(isLine)
    && (value.createdBy === undefined || typeof value.createdBy === 'string')
    && (value.cardRef === undefined || typeof value.cardRef === 'string')
    && (value.cardUnconfirmed === undefined || typeof value.cardUnconfirmed === 'boolean');
}
