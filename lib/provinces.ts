export const PROVINCES = [
  { code: 'AB', name: 'Alberta', timeZone: 'America/Edmonton' },
  { code: 'BC', name: 'British Columbia', timeZone: 'America/Vancouver' },
  { code: 'SK', name: 'Saskatchewan', timeZone: 'America/Regina' },
  { code: 'MB', name: 'Manitoba', timeZone: 'America/Winnipeg' },
  { code: 'ON', name: 'Ontario', timeZone: 'America/Toronto' },
  { code: 'QC', name: 'Quebec', timeZone: 'America/Toronto' },
  { code: 'NB', name: 'New Brunswick', timeZone: 'America/Moncton' },
  { code: 'NS', name: 'Nova Scotia', timeZone: 'America/Halifax' },
  { code: 'PE', name: 'Prince Edward Island', timeZone: 'America/Halifax' },
  { code: 'NL', name: 'Newfoundland and Labrador', timeZone: 'America/St_Johns' },
  { code: 'YT', name: 'Yukon', timeZone: 'America/Whitehorse' },
  { code: 'NT', name: 'Northwest Territories', timeZone: 'America/Yellowknife' },
  { code: 'NU', name: 'Nunavut', timeZone: 'America/Iqaluit' },
] as const;

export type ProvinceCode = (typeof PROVINCES)[number]['code'];

export function provinceName(code: string): string {
  return PROVINCES.find((p) => p.code === code)?.name ?? code;
}

export function provinceTimeZone(code: string): string {
  return PROVINCES.find((p) => p.code === code)?.timeZone ?? 'America/Toronto';
}
