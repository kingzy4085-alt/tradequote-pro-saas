import { compact, core, fmt, free, numField, readFields, round, selField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** NBC 2020 Appendix C Table C-2 January 2.5% design temperature, degrees C, with heating degree-days below 18 C. */
export const CITIES: Record<string, { label: string; t: number; hdd: number }> = {
  vancouver: { label: 'Vancouver, BC', t: -7, hdd: 2825 },
  victoria: { label: 'Victoria, BC', t: -4, hdd: 2650 },
  kelowna: { label: 'Kelowna, BC', t: -17, hdd: 3400 },
  calgary: { label: 'Calgary, AB', t: -30, hdd: 5000 },
  edmonton: { label: 'Edmonton, AB', t: -30, hdd: 5120 },
  saskatoon: { label: 'Saskatoon, SK', t: -35, hdd: 5700 },
  regina: { label: 'Regina, SK', t: -34, hdd: 5600 },
  winnipeg: { label: 'Winnipeg, MB', t: -33, hdd: 5670 },
  toronto: { label: 'Toronto, ON', t: -18, hdd: 3520 },
  ottawa: { label: 'Ottawa, ON', t: -25, hdd: 4440 },
  hamilton: { label: 'Hamilton, ON', t: -17, hdd: 3460 },
  london: { label: 'London, ON', t: -18, hdd: 3900 },
  montreal: { label: 'Montréal, QC', t: -23, hdd: 4200 },
  quebec: { label: 'Québec City, QC', t: -26, hdd: 5100 },
  halifax: { label: 'Halifax, NS', t: -16, hdd: 4000 },
  moncton: { label: 'Moncton, NB', t: -23, hdd: 4680 },
  saintjohn: { label: 'Saint John, NB', t: -22, hdd: 4570 },
  stjohns: { label: "St. John's, NL", t: -15, hdd: 4800 },
  charlottetown: { label: 'Charlottetown, PE', t: -20, hdd: 4460 },
  whitehorse: { label: 'Whitehorse, YT', t: -41, hdd: 6580 },
  yellowknife: { label: 'Yellowknife, NT', t: -41, hdd: 8170 },
  iqaluit: { label: 'Iqaluit, NU', t: -40, hdd: 9980 },
};
/** Assembly U-values in BTU/h per sq ft per degree F and natural air changes per hour, by envelope quality. */
export const ENVELOPES: Record<string, { label: string; wall: number; ceiling: number; window: number; ach: number }> = {
  older: { label: 'Older (pre-1980): R-12 walls, R-20 attic, early double glazing', wall: 0.08, ceiling: 0.05, window: 0.55, ach: 0.7 },
  average: { label: 'Average (1990 to 2012): R-20 walls, R-40 attic, double glazing', wall: 0.05, ceiling: 0.025, window: 0.35, ach: 0.35 },
  good: { label: 'Good (recent code): R-25 walls, R-55 attic, low-e double or triple', wall: 0.04, ceiling: 0.018, window: 0.25, ach: 0.15 },
  high: { label: 'High performance: R-40 walls, R-70 attic, triple glazing, tight', wall: 0.025, ceiling: 0.014, window: 0.17, ach: 0.075 },
};
const INDOOR_C = 22;
const FURNACES = [{ input: 60000, code: 'FURNACE-60K' }, { input: 80000, code: 'FURNACE-80K' }, { input: 100000, code: 'FURNACE-100K' }];

const fields: CalcField[] = [
  selField('city', 'City', 'toronto', Object.entries(CITIES).map(([k, v]) => [k, `${v.label} (${v.t} °C)`] as [string, string]), 'January 2.5% design temperature from NBC 2020 Appendix C.'),
  numField('area', 'Heated floor area above grade, all floors', 'sq ft', 1800, 300, 20000, 50),
  numField('storeys', 'Storeys', undefined, 2, 1, 3, 1),
  numField('height', 'Ceiling height', 'ft', 8, 7, 14, 0.5),
  selField('envelope', 'Envelope quality', 'average', Object.entries(ENVELOPES).map(([k, v]) => [k, v.label] as [string, string])),
  numField('windows', 'Window area', 'sq ft', 250, 0, 3000, 10),
  numField('doors', 'Exterior doors', undefined, 2, 0, 10, 1),
  selField('foundation', 'Foundation', 'basement', [['basement', 'Heated basement'], ['slab', 'Slab on grade'], ['crawl', 'Crawl space']]),
  numField('afue', 'Furnace efficiency (AFUE)', '%', 96, 60, 99, 1),
];

export const heatLoss: Calculator = {
  id: 'heat-loss',
  name: 'Heat loss estimator',
  trade: 'hvac',
  category: 'Mechanical design',
  summary: 'A quick estimate of a house heat loss in BTU/h from the local design temperature and envelope quality, with a furnace size and heat pump tonnage. An estimate, not a CSA F280 calculation.',
  fields,
  keywords: ['heat loss', 'furnace size', 'heat pump', 'btu', 'design temperature', 'f280', 'tonnage', 'heating load'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const city = CITIES[p.s('city')];
    const env = ENVELOPES[p.s('envelope')];
    const dtC = INDOOR_C - city.t;
    const dtF = dtC * 1.8;
    const storeys = Math.round(p.n('storeys'));
    const footprint = p.n('area') / storeys;
    const perimeter = 2 * (Math.sqrt(1.5 * footprint) + Math.sqrt(footprint / 1.5));
    const doorArea = p.n('doors') * 20;
    const grossWall = perimeter * p.n('height') * storeys;
    const wallArea = Math.max(0, grossWall - p.n('windows') - doorArea);
    const wallLoss = wallArea * env.wall * dtF;
    const ceilingLoss = footprint * env.ceiling * dtF;
    const windowLoss = p.n('windows') * env.window * dtF;
    const doorLoss = doorArea * 0.35 * dtF;
    const volume = p.n('area') * p.n('height');
    const cfm = (env.ach * volume) / 60;
    const infilLoss = 1.08 * cfm * dtF;
    // Foundation: below-grade losses are driven by the ground temperature (about 4 C), not the outdoor air
    const dtGroundF = (INDOOR_C - 4) * 1.8;
    const f = p.s('foundation');
    const foundationLoss = f === 'basement' ? perimeter * 8 * 0.07 * dtGroundF + footprint * 0.025 * dtGroundF : f === 'slab' ? perimeter * 0.35 * dtF : footprint * 0.05 * dtF * 0.8;
    const total = wallLoss + ceilingLoss + windowLoss + doorLoss + infilLoss + foundationLoss;
    const kw = total / 3412;
    const tons = total / 12000;
    const outputNeeded = total;
    const afue = p.n('afue') / 100;
    const furnace = FURNACES.find((fu) => fu.input * afue >= outputNeeded - 1e-9);
    if (!furnace) warnings.push('The load is above a 100,000 BTU/h furnace; use two stages, a larger unit or a second system.');
    const hp = tons <= 2.1 ? 'HP-2T' : tons <= 3.15 ? 'HP-3T' : undefined;
    if (tons > 3.15) warnings.push('The heat pump needed is above 3 tons at the design load; use a larger unit or add backup heat.');
    if (city.t <= -25) warnings.push(`At ${city.t} °C many heat pumps lose capacity. Size a cold-climate model from the manufacturer's capacity at the design temperature, and plan backup heat.`);
    if (furnace && furnace.input * afue > outputNeeded * 1.4) warnings.push('The smallest furnace is more than 140% of the load; the house may short-cycle. Consider a modulating unit.');
    warnings.push('This is a rough estimate from typical assemblies, not a CSA F280 heat loss calculation. A permit or a final equipment selection needs F280.');
    warnings.push(`Design temperature ${city.t} °C is the NBC 2020 Appendix C January 2.5% value; your authority may publish its own. Indoor design temperature is ${INDOOR_C} °C.`);
    const takeoff = compact([
      furnace ? core(furnace.code, 1) : free('Gas furnace, two units or larger than 100,000 BTU/h', 1, 'ea'),
      hp ? core(hp, 1, { note: 'cold-climate ducted heat pump; confirm capacity at the design temperature' }) : free(`Heat pump, ${round(Math.ceil(tons * 2) / 2, 1)} tons`, 1, 'ea'),
    ]);
    return {
      summary: [
        { label: 'Design heat loss', value: `${fmt(total, 0)} BTU/h (${fmt(kw, 1)} kW)`, emphasis: true },
        { label: 'Furnace', value: furnace ? `${furnace.input.toLocaleString('en-CA')} BTU/h input (${fmt(furnace.input * afue, 0)} output)` : 'above 100,000 BTU/h' },
        { label: 'Heat pump', value: `${fmt(tons, 1)} tons of heating; nearest ${hp === 'HP-2T' ? '2' : hp === 'HP-3T' ? '3' : fmt(Math.ceil(tons * 2) / 2, 1)} ton` },
        { label: 'Design temperature', value: `${city.t} °C outdoors, ${INDOOR_C} °C indoors (${fmt(dtC, 0)} °C difference)` },
        { label: 'Walls and windows', value: `${fmt(wallLoss, 0)} walls, ${fmt(windowLoss + doorLoss, 0)} windows and doors` },
        { label: 'Ceiling and foundation', value: `${fmt(ceilingLoss, 0)} ceiling, ${fmt(foundationLoss, 0)} foundation` },
        { label: 'Air leakage', value: `${fmt(infilLoss, 0)} BTU/h at ${env.ach} air changes per hour` },
      ],
      values: values({ design_temp_c: city.t, delta_t_c: dtC, total_btuh: round(total, 0), total_kw: round(kw, 2), tons: round(tons, 2), walls_btuh: round(wallLoss, 0), ceiling_btuh: round(ceilingLoss, 0), windows_btuh: round(windowLoss + doorLoss, 0), infiltration_btuh: round(infilLoss, 0), foundation_btuh: round(foundationLoss, 0), furnace_input_btuh: furnace ? furnace.input : null, hdd18: city.hdd }),
      takeoff,
      warnings,
      references: [
        'NBC 2020 Appendix C Table C-2: January 2.5% design temperature and degree-days below 18 °C by location',
        'Method: sum of U x area x temperature difference for walls, ceiling, windows, doors and foundation, plus infiltration at 1.08 x CFM x temperature difference',
        'Estimate only, not CSA F280-12; assembly U-values and air changes are typical by envelope quality',
      ],
    };
  },
};
