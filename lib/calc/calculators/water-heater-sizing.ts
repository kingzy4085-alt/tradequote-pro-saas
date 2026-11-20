import { ceil, compact, core, fmt, free, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

/** Typical coldest-season incoming water temperature, degrees C. Municipal and well supplies vary by several degrees; use the override for a measured value. */
export const INCOMING_C: Record<string, { label: string; c: number }> = {
  vancouver: { label: 'Vancouver, BC', c: 8 }, victoria: { label: 'Victoria, BC', c: 9 }, kelowna: { label: 'Kelowna, BC', c: 6 },
  calgary: { label: 'Calgary, AB', c: 4 }, edmonton: { label: 'Edmonton, AB', c: 3 }, saskatoon: { label: 'Saskatoon, SK', c: 3 }, regina: { label: 'Regina, SK', c: 3 },
  winnipeg: { label: 'Winnipeg, MB', c: 3 }, toronto: { label: 'Toronto, ON', c: 5 }, ottawa: { label: 'Ottawa, ON', c: 4 }, hamilton: { label: 'Hamilton, ON', c: 5 },
  london: { label: 'London, ON', c: 6 }, montreal: { label: 'Montréal, QC', c: 4 }, quebec: { label: 'Québec City, QC', c: 3 }, halifax: { label: 'Halifax, NS', c: 5 },
  moncton: { label: 'Moncton, NB', c: 4 }, saintjohn: { label: 'Saint John, NB', c: 5 }, stjohns: { label: "St. John's, NL", c: 4 }, charlottetown: { label: 'Charlottetown, PE', c: 5 },
  whitehorse: { label: 'Whitehorse, YT', c: 2 }, yellowknife: { label: 'Yellowknife, NT', c: 2 }, iqaluit: { label: 'Iqaluit, NU', c: 1 },
};
const DELIVERED_C = 49; // 120 F at the tap
const TANKS = [30, 40, 50, 60, 75, 80];
const TANKLESS_BTU = 199000;

const fields: CalcField[] = [
  selField('type', 'Heater type for the quote', 'tank', [['tank', 'Storage tank'], ['tankless', 'Tankless']]),
  numField('occupants', 'Occupants', undefined, 4, 1, 20, 1),
  numField('bathrooms', 'Bathrooms', undefined, 2, 1, 10, 1),
  boolField('tub', 'Large soaker tub', false),
  boolField('dishwasher', 'Dishwasher', true),
  boolField('washer', 'Clothes washer on hot', false),
  selField('fuel', 'Fuel', 'gas', [['gas', 'Natural gas'], ['electric', 'Electric']]),
  selField('city', 'Location (incoming water)', 'toronto', Object.entries(INCOMING_C).map(([k, v]) => [k, `${v.label} (${v.c} °C)`] as [string, string])),
  numField('incoming', 'Measured incoming water temperature (0 = use the city)', '°C', 0, 0, 25, 1),
  numField('showers', 'Showers running at once (tankless)', undefined, 2, 0, 6, 1),
  boolField('kitchen', 'Kitchen sink at the same time (tankless)', true),
];

export const waterHeaterSizing: Calculator = {
  id: 'water-heater-sizing',
  name: 'Water heater sizing calculator',
  trade: 'plumbing',
  category: 'Mechanical design',
  summary: 'First-hour rating and tank size from occupants and fixtures, or the tankless flow in GPM at the local incoming water temperature.',
  fields,
  keywords: ['water heater', 'first hour rating', 'tank size', 'tankless', 'gpm', 'temperature rise', 'hot water'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const city = INCOMING_C[p.s('city')];
    const inC = p.n('incoming') > 0 ? p.n('incoming') : city.c;
    const riseC = DELIVERED_C - inC;
    const riseF = riseC * 1.8;
    // Peak-hour demand in US gallons of hot water delivered at 120 F
    const peak = p.n('occupants') * 11 + (p.b('tub') ? 12 : 0) + (p.b('dishwasher') ? 6 : 0) + (p.b('washer') ? 7 : 0);
    const gas = p.s('fuel') === 'gas';
    // Recovery in gal/h at the actual rise: input BTU/h x efficiency / (8.34 x rise F)
    const recovery = gas ? (40000 * 0.62) / (8.34 * riseF) : (4500 * 3.412 * 0.98) / (8.34 * riseF);
    const fhr = (tank: number) => 0.7 * tank + recovery;
    const tank = TANKS.find((t) => fhr(t) >= peak - 1e-9);
    const fhrTank = tank ? fhr(tank) : fhr(TANKS[TANKS.length - 1]);
    if (!tank) warnings.push('No single tank in the list meets the peak hour; use a larger or high-input heater, two tanks, or a tankless unit.');
    if (p.n('occupants') > p.n('bathrooms') * 4) warnings.push('Many occupants per bathroom: a tankless unit or larger tank may still run short at peak.');
    // Tankless: Canadian low-flow shower about 2.0 GPM, kitchen sink 1.5 GPM
    const gpm = p.n('showers') * 2 + (p.b('kitchen') ? 1.5 : 0) + (p.b('washer') ? 1.5 : 0);
    const gpmAvail = (TANKLESS_BTU * 0.95) / (500 * riseF);
    const unitsNeeded = Math.max(1, ceil(gpm / gpmAvail));
    if (gpm > gpmAvail) warnings.push(`A 199,000 BTU/h tankless gives ${fmt(gpmAvail, 1)} GPM at this temperature rise, less than the ${fmt(gpm, 1)} GPM needed. Fit ${unitsNeeded} units, or reduce what runs at once.`);
    warnings.push('Tankless gas units often need a larger gas line (3/4 in or more) and venting; add that to the quote.');
    warnings.push(`Rise is ${fmt(riseC, 0)} °C: ${DELIVERED_C} °C at the tap less ${fmt(inC, 0)} °C incoming. Store tanks at 60 °C or above and temper the outlet where required by the plumbing code.`);
    const wanted = tank ?? 80;
    const tankCode = gas ? (wanted <= 40 ? 'WH-GAS-40' : undefined) : wanted <= 50 ? 'WH-ELEC-50' : undefined;
    const takeoff = p.s('type') === 'tankless' ? compact([core('WH-TANKLESS', unitsNeeded)]) : compact([
      tankCode ? core(tankCode, 1, { note: wanted < (gas ? 40 : 50) ? `${wanted} gal needed; the catalog tank is larger` : undefined }) : free(`Water heater, ${gas ? 'gas' : 'electric'}, ${wanted} gal`, 1, 'ea'),
    ]);
    return {
      summary: [
        { label: 'Tank size', value: tank ? `${tank} gal ${gas ? 'gas' : 'electric'} (first-hour rating ${fmt(fhrTank, 0)} gal)` : 'larger than 80 gal', emphasis: true },
        { label: 'Peak-hour demand', value: `${fmt(peak, 0)} gal (${fmt(peak * 3.785, 0)} L)` },
        { label: 'Tankless flow needed', value: `${fmt(gpm, 1)} GPM (${fmt(gpm * 3.785, 1)} L/min)` },
        { label: 'Tankless flow available', value: `${fmt(gpmAvail, 1)} GPM from a 199,000 BTU/h unit` },
        { label: 'Temperature rise', value: `${fmt(riseC, 0)} °C (${fmt(riseF, 0)} °F) from ${fmt(inC, 0)} °C incoming` },
        { label: 'Tank recovery', value: `${fmt(recovery, 0)} gal per hour` },
      ],
      values: values({ peak_hour_gal: round(peak, 1), tank_gal: tank ?? null, first_hour_rating_gal: round(fhrTank, 1), recovery_gph: round(recovery, 1), rise_c: round(riseC, 1), incoming_c: inC, tankless_gpm_needed: round(gpm, 2), tankless_gpm_available: round(gpmAvail, 2), tankless_units: unitsNeeded }),
      takeoff,
      warnings,
      references: [
        'First-hour rating = 0.7 x tank volume + recovery per hour; peak-hour demand from occupants and fixtures (rule of thumb of the ASHRAE and DOE method)',
        'Tankless capacity: GPM = BTU/h x efficiency / (500 x rise in °F); 500 = 8.34 lb/gal x 60 min',
        'Incoming water temperatures are typical coldest-season values; National Plumbing Code of Canada governs temperature controls',
      ],
    };
  },
};
