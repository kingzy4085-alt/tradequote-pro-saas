import { AHJ_CHECK_LINE, ceil, compact, core, fmt, numField, readFields, round, selField, boolField, values } from '../common';
import type { CalcField, CalcInput, CalcResult, Calculator } from '../types';

const fields: CalcField[] = [
  numField('area', 'Finished living area, all floors', 'm²', 150, 30, 1000, 5),
  numField('storeys', 'Storeys above grade', undefined, 2, 1, 4, 1),
  numField('bedrooms', 'Bedrooms', undefined, 3, 0, 12, 1),
  numField('bathrooms', 'Bathrooms', undefined, 2, 0, 10, 1),
  numField('rooms', 'Other rooms (living, dining, family, office)', undefined, 3, 0, 15, 1),
  numField('counter', 'Kitchen counter length along the walls', 'm', 6, 0, 30, 0.5),
  boolField('laundry', 'Laundry area', true),
  boolField('garage', 'Attached garage', true),
  numField('exterior', 'Exterior receptacles', undefined, 2, 0, 10, 1),
  numField('pots', 'Pot lights', undefined, 12, 0, 120, 1),
  boolField('basement', 'Finished basement', false, 'Adds a smoke alarm on that level.'),
  boolField('fuel', 'Fuel-fired appliance or attached garage', true, 'Requires a carbon monoxide alarm.'),
  boolField('ev', 'EV charger circuit', false),
  selField('afci', 'AFCI protection', 'living', [['bedrooms', 'Bedroom circuits only (older editions)'], ['living', 'All general receptacle circuits (bedrooms and living areas)'], ['all', 'General receptacle circuits plus lighting and other 15 A and 20 A circuits']], 'Current editions require AFCI protection on most 125 V, 15 A and 20 A receptacle branch circuits in dwelling units. Provincial amendments vary; confirm the scope with the authority having jurisdiction.'),
];

export const residentialWiringTakeoff: Calculator = {
  id: 'residential-wiring-takeoff',
  name: 'Residential wiring takeoff',
  trade: 'electrical',
  category: 'Electrical takeoff',
  summary: 'Receptacles, switches, GFCI and AFCI devices, smoke and CO alarms, circuits, breakers, NMD90 cable and boxes for a house, from its area and room counts.',
  fields,
  keywords: ['house wiring', 'rough-in', 'receptacles', 'switches', 'afci', 'gfci', 'circuits', 'nmd90', 'smoke alarm', 'new home'],
  run(input: CalcInput): CalcResult {
    const warnings: string[] = [];
    const p = readFields(input, fields, warnings);
    const area = p.n('area'), storeys = Math.round(p.n('storeys')), beds = Math.round(p.n('bedrooms')), baths = Math.round(p.n('bathrooms')), rooms = Math.round(p.n('rooms'));
    const general = beds + rooms;
    // General-room receptacles: the 1.8 m rule (CEC Rule 26-712) means one receptacle per 3.6 m of usable wall, minimum two per room.
    const roomArea = general > 0 ? Math.max(area - 14 - 5 * baths, 0) * 0.88 / general : 0;
    const usableWall = Math.max(4 * Math.sqrt(roomArea) - 2, 3);
    const perRoom = general > 0 ? Math.max(2, ceil(usableWall / 3.6)) : 0;
    const bedRecs = beds * perRoom;
    const roomRecs = rooms * perRoom + storeys; // one per hallway
    const counterRecs = p.n('counter') > 0 ? Math.max(2, ceil(p.n('counter') / 1.8)) : 0;
    const counterGfci = Math.min(2, counterRecs);
    const kitchenOther = 3; // refrigerator, microwave or hood, dishwasher
    const garageRecs = p.b('garage') ? 2 : 0;
    const ext = Math.round(p.n('exterior'));
    const laundry = p.b('laundry') ? 1 : 0;
    const gfci = baths + counterGfci + garageRecs + ext;
    const rec15 = bedRecs + roomRecs + kitchenOther;
    const rec20 = counterRecs - counterGfci + laundry;
    // Lighting and switching
    const lightOutlets = general + baths + 1 + storeys + (p.b('garage') ? 1 : 0) + 2;
    const pots = Math.round(p.n('pots'));
    const dimmers = pots > 0 ? ceil(pots / 8) : 0;
    const threeWay = 2 * storeys;
    const switches1 = general + baths + 1 + (p.b('garage') ? 1 : 0) + 2 - dimmers;
    const sw1 = Math.max(0, switches1);
    const devices = rec15 + rec20 + gfci + sw1 + threeWay + dimmers;
    // Circuits
    const lightCircuits = ceil((lightOutlets + pots) / 10);
    const bedCircuits = beds > 0 ? ceil(bedRecs / 12) : 0;
    const roomCircuits = rooms > 0 || storeys > 0 ? ceil(roomRecs / 12) : 0;
    const counterCircuits = counterRecs > 0 ? 2 : 0;
    const dedicated = (counterRecs > 0 ? 3 : 0) + laundry; // fridge, microwave, dishwasher + laundry (20 A)
    const wet = baths > 0 ? ceil(baths / 2) : 0;
    const gar = p.b('garage') ? 1 : 0;
    const extC = ext > 0 ? 1 : 0;
    const afciScope = p.s('afci');
    const afciCircuits = bedCircuits + (afciScope !== 'bedrooms' ? roomCircuits + lightCircuits * (afciScope === 'all' ? 1 : 0) : 0) + (afciScope === 'all' ? dedicated - laundry : 0);
    const totalCircuits = lightCircuits + bedCircuits + roomCircuits + counterCircuits + (counterRecs > 0 ? 3 : 0) + laundry + wet + gar + extC + (p.b('ev') ? 1 : 0);
    const afci = Math.min(afciCircuits, lightCircuits + bedCircuits + roomCircuits + (counterRecs > 0 ? 3 : 0));
    const bkr20 = counterCircuits + wet + gar + laundry;
    const bkr15 = totalCircuits - bkr20 - (p.b('ev') ? 1 : 0) - afci;
    // Cable: 4.5 m per outlet plus a home run per circuit
    const homeRun = 6 + 4 * (storeys - 1) + 0.3 * Math.sqrt(area);
    const outlets = rec15 + rec20 + gfci + lightOutlets + sw1 + threeWay + dimmers;
    const cable14_2 = (lightCircuits + bedCircuits + roomCircuits + extC + (counterRecs > 0 ? 2 : 0)) * homeRun + outlets * 4.5 * 0.7;
    const cable12_2 = (counterCircuits + wet + gar + laundry) * homeRun + (rec20 + counterGfci + baths + garageRecs) * 4.5;
    const cable14_3 = threeWay * 3.5 + storeys * 6;
    const smokes = storeys + (p.b('basement') ? 1 : 0) + beds;
    const co = p.b('fuel') ? 1 + (p.b('basement') ? 1 : 0) : 0;
    if (beds === 0) warnings.push('No bedrooms entered; no bedroom circuits or alarms were counted.');
    warnings.push('Counts are estimates from room counts and area. Receptacle numbers assume square rooms and the 1.8 m rule of CEC 26-712; a drawing-based takeoff will differ.');
    warnings.push('The range, dryer and water heater circuits are not included; add them from the dwelling load calculator results.');
    if (p.b('ev')) warnings.push('An EV circuit was counted as one 2-pole breaker; size it with the EV charger calculator.');
    warnings.push('Smoke alarms are counted per storey and in every bedroom; carbon monoxide alarms by sleeping area. The count assumes carbon monoxide alarms where a fuel-burning appliance is present, near the sleeping areas. Confirm the alarm requirements in the National Building Code and your provincial amendments.');
    const potLine = pots > 0 ? core('POT-4IN', pots) : null;
    const takeoff = compact([
      core('REC-15A-TR', rec15), core('REC-20A-TR', rec20), core('REC-GFCI', gfci), core('REC-WP-COVER', ext),
      core('SW-SP', sw1), core('SW-3W', threeWay), core('SW-DIMMER', dimmers), core('PLATE', devices),
      potLine,
      core('BKR-1P-15A', Math.max(0, bkr15)), core('BKR-1P-20A', bkr20), core('BKR-AFCI-15A', afci),
      p.b('ev') ? core('BKR-2P-60A', 1) : null,
      core('SMOKE-AC', smokes - co), core('SMOKE-CO-AC', co),
      core('NMD90-14-2', round(cable14_2 * 1.1, 0)), core('NMD90-12-2', round(cable12_2 * 1.1, 0)), core('NMD90-14-3', round(cable14_3 * 1.1, 0)),
      core('BOX-PLASTIC-1G', devices), core('BOX-OCTAGON', lightOutlets),
    ]);
    return {
      summary: [
        { label: 'Circuits', value: `${totalCircuits} branch circuits`, emphasis: true },
        { label: 'Receptacles', value: `${rec15 + rec20 + gfci} (${gfci} GFCI, ${rec20} 20 A)` },
        { label: 'Switches and dimmers', value: `${sw1} single-pole, ${threeWay} 3-way, ${dimmers} dimmers` },
        { label: 'Lighting outlets and pot lights', value: `${lightOutlets} outlets, ${pots} pot lights` },
        { label: 'AFCI breakers', value: `${afci}` },
        { label: 'Smoke and CO alarms', value: `${smokes - co} smoke, ${co} smoke and CO` },
        { label: 'NMD90 cable', value: `${fmt(cable14_2 * 1.1, 0)} m 14/2, ${fmt(cable12_2 * 1.1, 0)} m 12/2, ${fmt(cable14_3 * 1.1, 0)} m 14/3` },
        { label: 'Receptacles per general room', value: `${perRoom}` },
      ],
      values: values({ circuits: totalCircuits, receptacles: rec15 + rec20 + gfci, gfci, afci_breakers: afci, single_pole_switches: sw1, three_way_switches: threeWay, dimmers, lighting_outlets: lightOutlets, pot_lights: pots, smoke_alarms: smokes, co_alarms: co, cable_14_2_m: round(cable14_2 * 1.1, 0), cable_12_2_m: round(cable12_2 * 1.1, 0), cable_14_3_m: round(cable14_3 * 1.1, 0), receptacles_per_room: perRoom }),
      takeoff,
      warnings,
      references: [
        'CEC 2024 Rule 26-712 (receptacle spacing in dwellings: no point along the floor line more than 1.8 m from a receptacle; counter spacing), Rule 26-700 (GFCI). AFCI scope varies by edition and province: confirm with the authority having jurisdiction',
        'CEC Rule 8-304 (up to 12 outlets on a 15 A circuit); NBC smoke alarm and carbon monoxide alarm requirements, in words only',
        'Cable: 4.5 m per outlet plus a home run of 6 m, 4 m per extra storey and 0.3 x the square root of the area; 10% added for waste',
        AHJ_CHECK_LINE,
      ],
    };
  },
};
