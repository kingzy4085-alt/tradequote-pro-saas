// The catalog items calculators are allowed to name. The reference catalog must price every one of
// them in exactly this unit (tests/costbook-contract.test.ts checks), so a calculator's quantity and
// the catalog's price always agree. The catalog may hold many more items than these.
import type { LabourClass, Trade } from './types';

export interface CoreItem {
  code: string;
  trade: Trade;
  /** The unit the calculator counts in and the catalog prices in. */
  unit: string;
  labourClass: LabourClass;
  /** How it is bought, which calculators use to round up to whole packs. */
  pack: string;
  description: string;
}

type Row = [code: string, trade: Trade, unit: string, labourClass: LabourClass, pack: string, description: string];

const E = 'electrical' as const;
const ROWS: Row[] = [
  // Building wire, copper RW90/T90, priced per metre
  ...(['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250', '350', '500'].map(
    (s): Row => [`CU-RW90-${s}`, E, 'm', 'electrician', 'spool or reel, cut to length', `RW90 stranded copper building wire ${/^\d{3}$/.test(s) ? `${s} kcmil` : `${s} AWG`}`]
  )),
  // Aluminum feeder conductors
  ...(['1/0', '2/0', '3/0', '4/0', '250', '350', '500'].map(
    (s): Row => [`AL-RW90-${s}`, E, 'm', 'electrician', 'reel, cut to length', `RW90 aluminum conductor ${/^\d{3}$/.test(s) ? `${s} kcmil` : `${s} AWG`}`]
  )),
  ['CU-BARE-6', E, 'm', 'electrician', 'spool', 'Bare copper ground wire 6 AWG'],
  ['CU-BARE-4', E, 'm', 'electrician', 'spool', 'Bare copper ground wire 4 AWG'],
  // NMD90 cable
  ...(['14-2', '14-3', '12-2', '12-3', '10-2', '10-3', '8-3', '6-3'].map(
    (s): Row => [`NMD90-${s}`, E, 'm', 'electrician', '75 m coil', `NMD90 copper cable ${s.replace('-', '/')}`]
  )),
  // Teck90 armoured cable
  ...(['12-3', '10-3', '8-3', '6-3', '4-3', '2-3'].map(
    (s): Row => [`TECK90-${s}`, E, 'm', 'electrician', 'cut to length', `Teck90 copper armoured cable ${s.replace('-', '/')} with ground`]
  )),
  // EMT and fittings, by trade size
  ...(['1/2', '3/4', '1', '1-1/4', '1-1/2', '2'].flatMap((s): Row[] => [
    [`EMT-${s}`, E, 'm', 'electrician', '3 m (10 ft) length', `EMT conduit ${s} in`],
    [`EMT-CONN-${s}`, E, 'ea', 'electrician', 'each', `EMT set-screw connector ${s} in`],
    [`EMT-COUP-${s}`, E, 'ea', 'electrician', 'each', `EMT set-screw coupling ${s} in`],
  ])),
  ...(['1/2', '3/4', '1', '1-1/2', '2'].map((s): Row => [`PVC-${s}`, E, 'm', 'electrician', '3 m length', `Rigid PVC conduit ${s} in`])),
  ['BOX-DEVICE', E, 'ea', 'electrician', 'each', 'Steel device box 3 x 2 in'],
  ['BOX-OCTAGON', E, 'ea', 'electrician', 'each', 'Octagon box 4 in'],
  ['BOX-4SQ', E, 'ea', 'electrician', 'each', 'Square box 4 in, 2-1/8 in deep'],
  ['BOX-4SQ-RING', E, 'ea', 'electrician', 'each', 'Device ring for 4 in square box'],
  ['BOX-PLASTIC-1G', E, 'ea', 'electrician', 'each', 'Plastic new-work box, single gang'],
  ['BOX-PLASTIC-2G', E, 'ea', 'electrician', 'each', 'Plastic new-work box, two gang'],
  ['REC-15A-TR', E, 'ea', 'electrician', 'each', 'Receptacle 15 A tamper-resistant'],
  ['REC-20A-TR', E, 'ea', 'electrician', 'each', 'Receptacle 20 A T-slot tamper-resistant'],
  ['REC-GFCI', E, 'ea', 'electrician', 'each', 'GFCI receptacle 15 A'],
  ['REC-AFCI-GFCI', E, 'ea', 'electrician', 'each', 'Dual-function AFCI/GFCI receptacle'],
  ['REC-WP-COVER', E, 'ea', 'electrician', 'each', 'Weatherproof in-use cover'],
  ['SW-SP', E, 'ea', 'electrician', 'each', 'Switch, single pole'],
  ['SW-3W', E, 'ea', 'electrician', 'each', 'Switch, 3-way'],
  ['SW-DIMMER', E, 'ea', 'electrician', 'each', 'LED dimmer switch'],
  ['PLATE', E, 'ea', 'electrician', 'each', 'Cover plate'],
  ['BKR-1P-15A', E, 'ea', 'electrician', 'each', 'Breaker 15 A 1-pole'],
  ['BKR-1P-20A', E, 'ea', 'electrician', 'each', 'Breaker 20 A 1-pole'],
  ['BKR-AFCI-15A', E, 'ea', 'electrician', 'each', 'Breaker 15 A combination AFCI'],
  ['BKR-DF-15A', E, 'ea', 'electrician', 'each', 'Breaker 15 A dual-function AFCI/GFCI'],
  ...(['15', '20', '30', '40', '50', '60', '100'].map((a): Row => [`BKR-2P-${a}A`, E, 'ea', 'electrician', 'each', `Breaker ${a} A 2-pole`])),
  ['PANEL-100A', E, 'ea', 'electrician', 'each', 'Loadcentre 100 A, 24/48 circuit, main breaker'],
  ['PANEL-200A', E, 'ea', 'electrician', 'each', 'Loadcentre 200 A, 40/80 circuit, main breaker'],
  ['METER-200A', E, 'ea', 'electrician', 'each', 'Meter socket 200 A'],
  ['DISC-60A', E, 'ea', 'electrician', 'each', 'Safety switch 60 A, 2-pole, fusible'],
  ['DISC-100A', E, 'ea', 'electrician', 'each', 'Safety switch 100 A, 3-pole, 600 V'],
  ['POT-4IN', E, 'ea', 'electrician', 'each', 'LED slim pot light 4 in'],
  ['POT-6IN', E, 'ea', 'electrician', 'each', 'LED slim pot light 6 in'],
  ['LED-PANEL-2X4', E, 'ea', 'electrician', 'each', 'LED flat panel 2 x 4 ft'],
  ['LED-HIGHBAY', E, 'ea', 'electrician', 'each', 'LED high bay 150-200 W'],
  ['LED-WALLPACK', E, 'ea', 'electrician', 'each', 'LED wall pack, exterior'],
  ['SMOKE-AC', E, 'ea', 'electrician', 'each', 'Smoke alarm, hardwired with battery backup'],
  ['SMOKE-CO-AC', E, 'ea', 'electrician', 'each', 'Smoke and CO alarm, hardwired'],
  ['EXIT-EMERG', E, 'ea', 'electrician', 'each', 'LED exit sign with emergency lights'],
  ['EVSE-L2-48A', E, 'ea', 'electrician', 'each', 'Level 2 EV charger, 48 A hardwired'],
  ['GROUND-ROD', E, 'ea', 'electrician', 'each', 'Ground rod 5/8 in x 10 ft with clamp'],
  ['STARTER-NEMA1', 'electrical', 'ea', 'industrial_electrician', 'each', 'Motor starter, NEMA size 1, with overload'],
  ['VFD-5HP', 'electrical', 'ea', 'industrial_electrician', 'each', 'Variable frequency drive 5 HP'],
  ['XFMR-15KVA', 'electrical', 'ea', 'industrial_electrician', 'each', 'Dry-type transformer 15 kVA, 600-120/208 V'],
  ['XFMR-45KVA', 'electrical', 'ea', 'industrial_electrician', 'each', 'Dry-type transformer 45 kVA, 600-120/208 V'],
  ['CABLETRAY-12IN', 'electrical', 'm', 'industrial_electrician', '3 m section', 'Ladder cable tray 12 in'],

  // Plumbing
  ['PEX-1/2', 'plumbing', 'ft', 'plumber', '100 ft coil', 'PEX pipe 1/2 in'],
  ['PEX-3/4', 'plumbing', 'ft', 'plumber', '100 ft coil', 'PEX pipe 3/4 in'],
  ['CU-PIPE-1/2', 'plumbing', 'ft', 'plumber', '12 ft length', 'Copper pipe type M 1/2 in'],
  ['CU-PIPE-3/4', 'plumbing', 'ft', 'plumber', '12 ft length', 'Copper pipe type M 3/4 in'],
  ...(['1-1/2', '2', '3', '4'].map((s): Row => [`ABS-${s}`, 'plumbing', 'ft', 'plumber', '12 ft length', `ABS DWV pipe ${s} in`])),
  ['SHUTOFF-1/2', 'plumbing', 'ea', 'plumber', 'each', 'Quarter-turn shut-off valve 1/2 in'],
  ['TOILET-STD', 'plumbing', 'ea', 'plumber', 'each', 'Toilet, standard two-piece'],
  ['FAUCET-VANITY', 'plumbing', 'ea', 'plumber', 'each', 'Vanity faucet'],
  ['FAUCET-KITCHEN', 'plumbing', 'ea', 'plumber', 'each', 'Kitchen faucet'],
  ['WH-GAS-40', 'plumbing', 'ea', 'plumber', 'each', 'Water heater, gas, 40 gal'],
  ['WH-ELEC-50', 'plumbing', 'ea', 'plumber', 'each', 'Water heater, electric, 50 gal'],
  ['WH-TANKLESS', 'plumbing', 'ea', 'plumber', 'each', 'Tankless water heater, gas, 199,000 BTU'],
  ['SUMP-PUMP', 'plumbing', 'ea', 'plumber', 'each', 'Sump pump 1/3 HP'],
  ['BACKWATER-VALVE', 'plumbing', 'ea', 'plumber', 'each', 'Backwater valve 4 in'],

  // HVAC
  ['FURNACE-60K', 'hvac', 'ea', 'hvac_mechanic', 'each', 'High-efficiency gas furnace 60,000 BTU'],
  ['FURNACE-80K', 'hvac', 'ea', 'hvac_mechanic', 'each', 'High-efficiency gas furnace 80,000 BTU'],
  ['FURNACE-100K', 'hvac', 'ea', 'hvac_mechanic', 'each', 'High-efficiency gas furnace 100,000 BTU'],
  ['AC-2T', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Central air conditioner 2 ton'],
  ['AC-3T', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Central air conditioner 3 ton'],
  ['HP-2T', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Cold-climate ducted heat pump 2 ton'],
  ['HP-3T', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Cold-climate ducted heat pump 3 ton'],
  ['MINISPLIT-12K', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Ductless mini-split 12,000 BTU'],
  ['DUCT-6IN', 'hvac', 'ft', 'sheet_metal', '5 ft length', 'Galvanized round duct 6 in'],
  ['DUCT-7IN', 'hvac', 'ft', 'sheet_metal', '5 ft length', 'Galvanized round duct 7 in'],
  ['REGISTER', 'hvac', 'ea', 'sheet_metal', 'each', 'Supply register'],
  ['BATH-FAN', 'hvac', 'ea', 'electrician', 'each', 'Bathroom exhaust fan 80-110 CFM'],
  ['HRV', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Heat recovery ventilator'],
  ['THERMOSTAT', 'hvac', 'ea', 'hvac_mechanic', 'each', 'Smart thermostat'],
  ['LINESET-25FT', 'hvac', 'ea', 'hvac_mechanic', '25 ft set', 'Refrigerant line set 3/8 x 3/4 in, 25 ft'],

  // Framing
  ['LUMBER-2X4-8', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x4, 8 ft'],
  ['LUMBER-2X4-10', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x4, 10 ft'],
  ['LUMBER-2X6-8', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x6, 8 ft'],
  ['LUMBER-2X6-12', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x6, 12 ft'],
  ['LUMBER-2X8-12', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x8, 12 ft'],
  ['LUMBER-2X10-12', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x10, 12 ft'],
  ['LUMBER-2X12-12', 'carpentry', 'ea', 'carpenter', 'each', 'SPF 2x12, 12 ft'],
  ['OSB-7/16', 'carpentry', 'sheet', 'carpenter', '4 x 8 ft sheet', 'OSB sheathing 7/16 in, 4 x 8'],
  ['PLY-3/4-TG', 'carpentry', 'sheet', 'carpenter', '4 x 8 ft sheet', 'Plywood subfloor 3/4 in T&G, 4 x 8'],
  ['NAILS-FRAMING', 'carpentry', 'box', 'carpenter', 'box of about 2,000', 'Framing nails, collated, box'],
  ['HOUSEWRAP', 'carpentry', 'roll', 'carpenter', '9 x 100 ft roll (900 sq ft)', 'House wrap roll, 9 x 100 ft'],

  // Drywall
  ['DRYWALL-1/2-4X8', 'drywall', 'sheet', 'drywaller', '4 x 8 ft sheet (32 sq ft)', 'Drywall 1/2 in, 4 x 8'],
  ['DRYWALL-1/2-4X12', 'drywall', 'sheet', 'drywaller', '4 x 12 ft sheet (48 sq ft)', 'Drywall 1/2 in, 4 x 12'],
  ['DRYWALL-5/8X-4X8', 'drywall', 'sheet', 'drywaller', '4 x 8 ft sheet (32 sq ft)', 'Drywall 5/8 in Type X, 4 x 8'],
  ['DRYWALL-1/2-MR-4X8', 'drywall', 'sheet', 'drywaller', '4 x 8 ft sheet (32 sq ft)', 'Moisture-resistant drywall 1/2 in, 4 x 8'],
  ['MUD-17L', 'drywall', 'pail', 'drywaller', '17 L pail', 'All-purpose joint compound, 17 L pail'],
  ['TAPE-PAPER', 'drywall', 'roll', 'drywaller', '250 ft roll', 'Paper drywall tape, 250 ft roll'],
  ['CORNER-BEAD', 'drywall', 'ea', 'drywaller', '8 ft length', 'Metal corner bead, 8 ft'],
  ['SCREWS-DRYWALL', 'drywall', 'box', 'drywaller', 'box of about 1,000', 'Drywall screws, box'],
  ['STEEL-STUD-3-5/8', 'drywall', 'ea', 'drywaller', '10 ft length', 'Steel stud 3-5/8 in, 10 ft'],

  // Insulation, priced per square foot of coverage
  ...(['R12', 'R14', 'R20', 'R22', 'R24', 'R31'].map((r): Row => [`INSUL-BATT-${r}`, 'insulation', 'sqft', 'insulator', 'bag, priced per sq ft covered', `Insulation batts ${r.replace('R', 'R-')}`])),
  ['INSUL-BLOWN-R50', 'insulation', 'sqft', 'insulator', 'per sq ft at R-50, installed depth', 'Blown attic insulation to R-50'],
  ['POLY-6MIL', 'insulation', 'sqft', 'insulator', 'roll, priced per sq ft', '6 mil polyethylene vapour barrier'],
  ['XPS-2IN', 'insulation', 'sheet', 'insulator', '4 x 8 ft sheet (32 sq ft)', 'Extruded polystyrene rigid insulation 2 in, 4 x 8'],

  // Concrete
  ['CONC-25MPA', 'concrete', 'm3', 'concrete_finisher', 'per cubic metre delivered', 'Ready-mix concrete 25 MPa'],
  ['CONC-32MPA', 'concrete', 'm3', 'concrete_finisher', 'per cubic metre delivered', 'Ready-mix concrete 32 MPa'],
  ['CONC-BAG-30KG', 'concrete', 'bag', 'labourer', '30 kg bag (about 0.014 m3)', 'Bagged concrete mix, 30 kg'],
  ['REBAR-10M', 'concrete', 'm', 'labourer', '6 m length', 'Rebar 10M'],
  ['REBAR-15M', 'concrete', 'm', 'labourer', '6 m length', 'Rebar 15M'],
  ['GRAVEL-BASE', 'concrete', 'm3', 'labourer', 'per cubic metre delivered', 'Crushed gravel base, 3/4 in'],
  ['BLOCK-8IN', 'concrete', 'ea', 'labourer', 'each', 'Concrete block 8 in'],

  // Roofing
  ['SHINGLE-ARCH', 'roofing', 'bundle', 'roofer', 'bundle (3 per square, 33.3 sq ft)', 'Architectural asphalt shingles, bundle'],
  ['UNDERLAY-SYN', 'roofing', 'roll', 'roofer', 'roll covering 1,000 sq ft', 'Synthetic roof underlayment, 10 square roll'],
  ['ICE-WATER', 'roofing', 'roll', 'roofer', 'roll covering 200 sq ft', 'Ice and water shield, 2 square roll'],
  ['DRIP-EDGE', 'roofing', 'ea', 'roofer', '10 ft length', 'Drip edge, 10 ft'],
  ['STARTER-STRIP', 'roofing', 'bundle', 'roofer', 'bundle covering about 100 lin ft', 'Starter strip shingles, bundle'],
  ['RIDGE-CAP', 'roofing', 'bundle', 'roofer', 'bundle covering about 25 lin ft', 'Hip and ridge cap shingles, bundle'],
  ['ROOF-NAILS', 'roofing', 'box', 'roofer', 'box of 7,200 coil nails', 'Roofing coil nails, box'],
  ['ROOF-VENT', 'roofing', 'ea', 'roofer', 'each', 'Roof vent'],

  // Painting
  ['PAINT-INT', 'painting', 'can', 'painter', '3.78 L can', 'Premium interior latex paint, 3.78 L'],
  ['PAINT-CEILING', 'painting', 'can', 'painter', '3.78 L can', 'Ceiling paint, 3.78 L'],
  ['PRIMER', 'painting', 'can', 'painter', '3.78 L can', 'Primer, 3.78 L'],
  ['PAINT-EXT', 'painting', 'can', 'painter', '3.78 L can', 'Exterior acrylic paint, 3.78 L'],
  ['CAULK', 'painting', 'ea', 'painter', '300 mL tube', 'Paintable caulking, tube'],

  // Flooring, per square foot
  ['FLOOR-LVP', 'flooring', 'sqft', 'floor_installer', 'case, priced per sq ft', 'Luxury vinyl plank flooring'],
  ['FLOOR-LAMINATE', 'flooring', 'sqft', 'floor_installer', 'case, priced per sq ft', 'Laminate flooring'],
  ['FLOOR-ENG-HW', 'flooring', 'sqft', 'floor_installer', 'case, priced per sq ft', 'Engineered hardwood flooring'],
  ['FLOOR-TILE', 'flooring', 'sqft', 'floor_installer', 'box, priced per sq ft', 'Porcelain floor tile'],
  ['UNDERLAY-FOAM', 'flooring', 'sqft', 'floor_installer', 'roll, priced per sq ft', 'Flooring underlayment'],
  ['THINSET-23KG', 'flooring', 'bag', 'floor_installer', '23 kg bag', 'Thinset mortar, 23 kg'],
  ['GROUT-10KG', 'flooring', 'bag', 'floor_installer', '10 kg bag', 'Sanded grout, 10 kg'],

  // Site and rentals
  ['BIN-20YD', 'general', 'haul', 'labourer', 'per haul', 'Roll-off bin 20 yd, per haul'],
  ['TOILET-RENTAL', 'general', 'month', 'labourer', 'per month', 'Portable toilet rental, per month'],
  ['SCAFFOLD-WEEK', 'general', 'week', 'labourer', 'per week', 'Scaffold frame set rental, per week'],
  ['SCISSOR-LIFT-DAY', 'general', 'day', 'labourer', 'per day', 'Scissor lift 19 ft rental, per day'],
  ['SCISSOR-LIFT-WEEK', 'general', 'week', 'labourer', 'per week', 'Scissor lift 19 ft rental, per week'],
  ['BOOM-LIFT-DAY', 'general', 'day', 'labourer', 'per day', 'Boom lift 40 ft rental, per day'],
  ['MINI-EX-DAY', 'general', 'day', 'equipment_operator', 'per day', 'Mini excavator rental, per day'],
];

export const CORE_ITEMS: Readonly<Record<string, CoreItem>> = Object.freeze(
  Object.fromEntries(ROWS.map(([code, trade, unit, labourClass, pack, description]) => [code, { code, trade, unit, labourClass, pack, description }]))
);

export const CORE_CODES: readonly string[] = Object.freeze(ROWS.map((r) => r[0]));
