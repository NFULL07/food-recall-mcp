import {
  RawRecord,
  pick,
  parseDateRange,
  normName,
  normBarcode,
  DateRange,
} from './fields.js';

export type Origin = 'domestic' | 'imported';

export interface RecallRecord {
  id: string;
  origin: Origin;
  productName: string;
  productNameNorm: string;
  manufacturer?: string;
  manufacturerNorm: string;
  barcode?: string;
  barcodeNorm: string;
  manufactureRange: DateRange | null;
  expiryRange: DateRange | null;
  reason?: string;
  grade?: string;
  category?: string;
  method?: string;
  photoUrl?: string;
  registeredAt?: string;
  packUnit?: string;
}

let autoId = 0;

export function toRecord(raw: RawRecord, origin: Origin): RecallRecord | null {
  const productName = pick(raw, 'productName');
  if (!productName) return null; // 제품명 없는 레코드는 대조 불가

  const manufacturer = pick(raw, 'manufacturer');
  const barcode = pick(raw, 'barcode');
  const serial = pick(raw, 'serial') ?? `auto-${++autoId}`;

  return {
    id: `${origin === 'domestic' ? 'D' : 'I'}-${serial}`,
    origin,
    productName,
    productNameNorm: normName(productName),
    manufacturer,
    manufacturerNorm: normName(manufacturer),
    barcode,
    barcodeNorm: normBarcode(barcode),
    manufactureRange: parseDateRange(pick(raw, 'manufactureDate')),
    expiryRange: parseDateRange(pick(raw, 'expiryDate')),
    reason: pick(raw, 'reason'),
    grade: pick(raw, 'grade'),
    category: pick(raw, 'category'),
    method: pick(raw, 'method'),
    photoUrl: pick(raw, 'photoUrl')?.split(',')[0].trim(),
    registeredAt: pick(raw, 'registeredAt'),
    packUnit: pick(raw, 'packUnit'),
  };
}
