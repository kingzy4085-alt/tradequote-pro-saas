// Pricing areas: every province and territory, then the researched metros inside them.
// materialFactor is material cost relative to the national baseline (1.00), from the research file
// (Altus 2026 Canadian Cost Guide hard-cost index, dampened by half because about half of inter-city cost
// differences are materials; the territories carry the northern freight premium found in the sources).
// The territories sit above 1.8 or close to it because freight to the north is real: Nunavut is 2.00.
import type { Region } from './types';

type Row = [code: string, name: string, province: string, materialFactor: number, note?: string];

const ROWS: Row[] = [
  ['AB', 'Alberta', 'AB', 1.02],
  ['BC', 'British Columbia', 'BC', 1.06],
  ['SK', 'Saskatchewan', 'SK', 1.02],
  ['MB', 'Manitoba', 'MB', 1.01],
  ['ON', 'Ontario', 'ON', 1.01],
  ['QC', 'Quebec', 'QC', 0.96],
  ['NB', 'New Brunswick', 'NB', 0.96],
  ['NS', 'Nova Scotia', 'NS', 0.95],
  ['PE', 'Prince Edward Island', 'PE', 0.97],
  ['NL', 'Newfoundland and Labrador', 'NL', 1.01],
  ['YT', 'Yukon', 'YT', 1.22],
  ['NT', 'Northwest Territories', 'NT', 1.4],
  ['NU', 'Nunavut', 'NU', 2.0],
  ['BC-VANCOUVER', 'Vancouver', 'BC', 1.07],
  ['BC-VICTORIA', 'Victoria', 'BC', 1.07],
  ['BC-KELOWNA', 'Kelowna', 'BC', 1.05],
  ['AB-CALGARY', 'Calgary', 'AB', 1.02],
  ['AB-EDMONTON', 'Edmonton', 'AB', 1.02],
  ['SK-SASKATOON', 'Saskatoon', 'SK', 1.02],
  ['SK-REGINA', 'Regina', 'SK', 1.02],
  ['MB-WINNIPEG', 'Winnipeg', 'MB', 1.01],
  ['ON-TORONTO', 'Toronto', 'ON', 1.02],
  ['ON-OTTAWA', 'Ottawa', 'ON', 0.98],
  ['ON-HAMILTON', 'Hamilton', 'ON', 1.0],
  ['ON-LONDON', 'London', 'ON', 1.0],
  ['QC-MONTREAL', 'Montreal', 'QC', 0.96],
  ['QC-QUEBEC', 'Quebec City', 'QC', 0.96],
  ['NB-MONCTON', 'Moncton', 'NB', 0.96],
  ['NB-SAINTJOHN', 'Saint John', 'NB', 0.96],
  ['NS-HALIFAX', 'Halifax', 'NS', 0.95],
  ['PE-CHARLOTTETOWN', 'Charlottetown', 'PE', 0.97],
  ['NL-STJOHNS', "St. John's", 'NL', 1.0],
  ['YT-WHITEHORSE', 'Whitehorse', 'YT', 1.2],
  ['NT-YELLOWKNIFE', 'Yellowknife', 'NT', 1.35],
  ['NU-IQALUIT', 'Iqaluit', 'NU', 1.9],
];

export const REGIONS: readonly Region[] = ROWS.map(([code, name, province, materialFactor]) => ({ code, name, province, materialFactor }));
