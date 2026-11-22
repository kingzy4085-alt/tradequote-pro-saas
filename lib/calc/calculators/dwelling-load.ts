import { AHJ_CHECK_LINE, compact, core, fmt, free, numField, readFields, round, boolField, values, ceil } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('ground', 'Ground floor area', 'm²', 90, 10, 1000, 1, 'Inside dimensions (Rule 8-110).'),
  numField('upper', 'Upper floor area used for living', 'm²', 0, 0, 1000, 1),
  numField('basement', 'Basement area', 'm²', 90, 0, 1000, 1, 'Counted at 75% when the ceiling is higher than 1.8 m.'),
  boolField('basementHigh', 'Basement ceiling higher than 1.8 m', true),
  numField('heat', 'Electric space heating (connected)', 'kW', 0, 0, 100, 0.1, '100% of the first 10 kW and 75% of the rest (Section 62).'),
  numField('ac', 'Air conditioning', 'kW', 0, 0, 50, 0.1, 'Counted at 100%.'),
  boolField('interlock', 'Heating and air conditioning interlocked', false, 'When interlocked only the larger of the two is counted (Rule 8-106 3).'),
  numField('range', 'Electric range', 'kW', 12, 0, 40, 0.5, '0 if there is no electric range.'),
  numField('waterHeater', 'Water heater', 'kW', 3, 0, 20, 0.1),
  boolField('tankless', 'Water heater is tankless', false, 'Tankless heaters count at 100%.'),
  numField('dryer', 'Clothes dryer', 'kW', 5, 0, 15, 0.1),
  numField('evse', 'EV charger', 'kW', 0, 0, 20, 0.1, 'Counted at 100% unless an energy management system limits it (Rule 8-106 11).'),
  numField('other', 'Other fixed loads over 1.5 kW each (total)', 'kW', 0, 0, 60, 0.1, 'Welders, pumps and similar fixed loads, counted with the dryer and water heater. Do not enter hot tubs, spas or pool heating here; use the field below.'),
  numField('spa', 'Hot tub, spa and pool heating loads (total)', 'kW', 0, 0, 60, 0.1, 'Counted at 100% of the rating, added to the calculated load.'),
];
const SERVICES = [60, 100, 125, 150, 200, 300, 400, 600];

export const dwellingLoad: Calculator = {
  id: 'dwelling-load',
  name: 'Dwelling service load calculator',
  trade: 'electrical',
  category: 'Electrical design',
  summary: 'Calculated load and minimum service size for a single dwelling under CEC Rule 8-200, with the panel and meter base for the takeoff.',
  fields,
  keywords: ['service size', 'load calculation', 'rule 8-200', 'dwelling', 'house', 'panel', '100 amp', '200 amp'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const living = p.n('ground') + p.n('upper') + (p.b('basementHigh') ? 0.75 : 0) * p.n('basement');
    const basic = 5000 + (living > 90 ? 1000 * ceil((living - 90) / 90) : 0);
    const heatW = p.n('heat') * 1000;
    const heatDemand = Math.min(heatW, 10000) + 0.75 * Math.max(0, heatW - 10000);
    const acW = p.n('ac') * 1000;
    const climate = p.b('interlock') ? Math.max(heatDemand, acW) : heatDemand + acW;
    const rangeKw = p.n('range');
    const rangeW = rangeKw > 0 ? 6000 + 0.4 * Math.max(0, rangeKw - 12) * 1000 : 0;
    const tankW = p.b('tankless') ? p.n('waterHeater') * 1000 : 0;
    const evW = p.n('evse') * 1000;
    const spaW = p.n('spa') * 1000;
    const otherLoads = [p.b('tankless') ? 0 : p.n('waterHeater') * 1000, p.n('dryer') * 1000, p.n('other') * 1000].filter((w) => w > 1500);
    const otherSum = otherLoads.reduce((a, b) => a + b, 0);
    const otherDemand = rangeKw > 0 ? 0.25 * otherSum : Math.min(otherSum, 6000) + 0.25 * Math.max(0, otherSum - 6000);
    const itemA = basic + climate + rangeW + tankW + evW + spaW + otherDemand;
    const floorExcl = p.n('ground') + p.n('upper');
    const itemB = floorExcl >= 80 ? 24000 : 14400;
    const calcW = Math.max(itemA, itemB);
    const amps = calcW / 240;
    const service = SERVICES.find((s) => s >= amps - 1e-9);
    if (!service) warnings.push('The load is above 600 A; this dwelling needs an engineered service.');
    if (itemB > itemA) warnings.push(`The Rule 8-200 1) b) minimum of ${itemB} W governs, so the calculated load is that minimum.`);
    if (p.n('heat') > 0 && p.n('ac') > 0 && !p.b('interlock')) warnings.push('Heating and air conditioning are both counted. Interlock them (or use a heat pump) to count only the larger.');
    if (service && service >= 200) warnings.push('For 200 A and above, check the utility meter-base and service-entrance requirements for your supplier.');
    if (p.b('tankless') && p.n('waterHeater') <= 0) warnings.push('Tankless selected with no water heater load.');
    if (p.n('evse') > 0) warnings.push('The EV charger is counted at 100%. An approved energy management system may let you count less (Rule 8-106 11).');
    const panel = service && service <= 100 ? 'PANEL-100A' : service && service <= 200 ? 'PANEL-200A' : undefined;
    const takeoff = compact([
      // The catalog loadcentres include their main breaker, so a separate main would be billed twice
      panel ? core(panel, 1, { note: `${service} A service; main breaker is part of the loadcentre${service === 60 || service === 125 || service === 150 ? ', size the main down to ' + service + ' A' : ''}` }) : free(`Service equipment ${service ?? '600+'} A with main breaker`, 1, 'ea'),
      service && service <= 200 ? core('METER-200A', 1, { note: service <= 100 ? 'smallest catalog meter socket (200 A)' : undefined }) : free(`Meter socket ${service ?? '600+'} A`, 1, 'ea'),
    ]);
    return {
      summary: [
        { label: 'Minimum service', value: service ? `${service} A at 240 V` : 'Over 600 A', emphasis: true },
        { label: 'Calculated load', value: `${fmt(calcW, 0)} W (${fmt(amps, 1)} A)` },
        { label: 'Living area (Rule 8-110)', value: `${fmt(living, 1)} m²` },
        { label: 'Basic load', value: `${fmt(basic, 0)} W` },
        { label: 'Heating and cooling', value: `${fmt(climate, 0)} W` },
        { label: 'Range, water heater, EV', value: `${fmt(rangeW + tankW + evW, 0)} W` },
        { label: 'Hot tub, spa and pool heating (100%)', value: `${fmt(spaW, 0)} W` },
        { label: 'Other loads over 1.5 kW', value: `${fmt(otherDemand, 0)} W demand from ${fmt(otherSum, 0)} W connected` },
        { label: 'Minimum under 8-200 1) b)', value: `${itemB} W` },
      ],
      values: values({ living_area_m2: round(living, 2), basic_load_w: basic, heating_cooling_w: round(climate, 0), range_w: rangeW, tankless_w: tankW, evse_w: evW, spa_w: spaW, other_demand_w: round(otherDemand, 0), item_a_w: round(itemA, 0), item_b_w: itemB, calculated_w: round(calcW, 0), calculated_a: round(amps, 1), service_a: service ?? null }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Rule 8-200 1) (single dwelling: basic load, heating, air conditioning, range, tankless water heater, EVSE, other loads over 1500 W) and the 8-200 1) b) minimum',
        'CEC Rule 8-110 (living area from inside dimensions, basement at 75%), Rule 8-106 3) (interlocked loads), Section 62 heating demand',
        'Amperes = calculated watts / 240 V; service sizes rounded up to the next common size',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
