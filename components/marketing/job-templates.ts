// The jobs the quote builder and the demo start from. A template names a calculator when one exists
// (and the input field the job size drives), and always carries a typical list of takeoff lines built
// from the shared catalog codes, so it works whatever the calculators and prices are today.
import type { CalcInput } from '@/lib/calc/types';
import type { LabourClass } from '@/lib/costbook';

export interface ScaledLine {
  /** A catalog code from CORE_ITEMS. */
  code: string;
  /** Quantity = fixed + per x job size, rounded up. */
  fixed?: number;
  per?: number;
}

export interface TemplatePart {
  label: string;
  /** Used instead of `lines` when the calculator exists and has the `scaleKey` field. */
  calc?: { id: string; input: CalcInput; scaleKey: string };
  lines: ScaledLine[];
}

export interface JobTemplate {
  id: string;
  name: string;
  blurb: string;
  icon: 'plug' | 'battery' | 'home' | 'bulb' | 'panel' | 'roof';
  labourClass: LabourClass;
  defaultRegion: string;
  defaultMarkup: number;
  scale: { label: string; unit: string; min: number; max: number; step: number; default: number };
  parts: TemplatePart[];
}

export const JOB_TEMPLATES: readonly JobTemplate[] = [
  {
    id: 'service-200a',
    name: '200 A service upgrade',
    blurb: 'New 200 A loadcentre, meter socket, grounding and feeder.',
    icon: 'plug',
    labourClass: 'electrician',
    defaultRegion: 'ON',
    defaultMarkup: 15,
    scale: { label: 'Feeder run', unit: 'm', min: 4, max: 40, step: 1, default: 12 },
    parts: [
      {
        label: 'Service equipment and feeder',
        lines: [
          { code: 'PANEL-200A', fixed: 1 },
          { code: 'METER-200A', fixed: 1 },
          { code: 'CU-RW90-2/0', per: 3 },
          { code: 'CU-BARE-6', fixed: 6 },
          { code: 'EMT-2', per: 1 },
          { code: 'EMT-CONN-2', fixed: 4 },
          { code: 'GROUND-ROD', fixed: 2 },
          { code: 'BKR-2P-60A', fixed: 1 },
          { code: 'BKR-2P-30A', fixed: 1 },
          { code: 'BKR-1P-15A', fixed: 8 },
          { code: 'BKR-1P-20A', fixed: 6 },
        ],
      },
    ],
  },
  {
    id: 'ev-charger',
    name: 'EV charger install',
    blurb: 'Level 2 charger on its own 60 A circuit from the panel.',
    icon: 'battery',
    labourClass: 'electrician',
    defaultRegion: 'ON',
    defaultMarkup: 20,
    scale: { label: 'Run from the panel', unit: 'm', min: 3, max: 45, step: 1, default: 15 },
    parts: [
      {
        label: 'Charger circuit',
        lines: [
          { code: 'EVSE-L2-48A', fixed: 1 },
          { code: 'BKR-2P-60A', fixed: 1 },
          { code: 'NMD90-6-3', per: 1 },
          { code: 'EMT-1', per: 0.4 },
          { code: 'EMT-CONN-1', fixed: 2 },
          { code: 'BOX-4SQ', fixed: 1 },
        ],
      },
    ],
  },
  {
    id: 'basement-finish',
    name: 'Basement finish',
    blurb: 'Framing, insulation, wiring, drywall, paint and flooring.',
    icon: 'home',
    labourClass: 'carpenter',
    defaultRegion: 'ON',
    defaultMarkup: 18,
    scale: { label: 'Floor area', unit: 'sq ft', min: 400, max: 1800, step: 50, default: 800 },
    parts: [
      {
        label: 'Framing and insulation',
        lines: [
          { code: 'LUMBER-2X4-8', per: 0.4 },
          { code: 'NAILS-FRAMING', fixed: 1 },
          { code: 'INSUL-BATT-R20', per: 1.1 },
          { code: 'POLY-6MIL', per: 1.1 },
        ],
      },
      {
        label: 'Electrical',
        calc: { id: 'residential-wiring-takeoff', input: {}, scaleKey: 'area' },
        lines: [
          { code: 'NMD90-14-2', per: 0.3 },
          { code: 'BOX-DEVICE', per: 0.03 },
          { code: 'REC-15A-TR', per: 0.02 },
          { code: 'SW-SP', per: 0.004 },
          { code: 'POT-4IN', per: 0.012 },
          { code: 'PLATE', per: 0.025 },
        ],
      },
      {
        label: 'Drywall',
        lines: [
          { code: 'DRYWALL-1/2-4X8', per: 0.07 },
          { code: 'MUD-17L', per: 0.006 },
          { code: 'TAPE-PAPER', per: 0.002 },
          { code: 'CORNER-BEAD', per: 0.012 },
          { code: 'SCREWS-DRYWALL', per: 0.003 },
        ],
      },
      {
        label: 'Paint and flooring',
        lines: [
          { code: 'PRIMER', per: 0.004 },
          { code: 'PAINT-INT', per: 0.006 },
          { code: 'FLOOR-LVP', per: 1.05 },
          { code: 'UNDERLAY-FOAM', per: 1.05 },
        ],
      },
    ],
  },
  {
    id: 'pot-light-retrofit',
    name: 'Pot-light retrofit',
    blurb: 'LED pot lights cut into finished ceilings, with a dimmer.',
    icon: 'bulb',
    labourClass: 'electrician',
    defaultRegion: 'ON',
    defaultMarkup: 20,
    scale: { label: 'Lights', unit: 'lights', min: 4, max: 40, step: 1, default: 10 },
    parts: [
      {
        label: 'Lighting',
        lines: [
          { code: 'POT-4IN', per: 1 },
          { code: 'NMD90-14-2', per: 4.5 },
          { code: 'SW-DIMMER', fixed: 1, per: 0.1 },
          { code: 'PLATE', fixed: 1 },
          { code: 'MUD-17L', fixed: 1 },
          { code: 'PAINT-CEILING', fixed: 1 },
        ],
      },
    ],
  },
  {
    id: 'panel-change',
    name: 'Panel change',
    blurb: 'Swap an old panel for a new 200 A loadcentre, circuit by circuit.',
    icon: 'panel',
    labourClass: 'electrician',
    defaultRegion: 'ON',
    defaultMarkup: 15,
    scale: { label: 'Circuits', unit: 'circuits', min: 10, max: 40, step: 1, default: 24 },
    parts: [
      {
        label: 'Panel and breakers',
        lines: [
          { code: 'PANEL-200A', fixed: 1 },
          { code: 'BKR-1P-15A', per: 0.45 },
          { code: 'BKR-1P-20A', per: 0.2 },
          { code: 'BKR-AFCI-15A', per: 0.15 },
          { code: 'BKR-2P-30A', fixed: 1 },
          { code: 'BKR-2P-40A', fixed: 1 },
          { code: 'CU-RW90-6', fixed: 4 },
          { code: 'CU-BARE-6', fixed: 3 },
          { code: 'EMT-CONN-3/4', per: 0.25 },
        ],
      },
    ],
  },
  {
    id: 'roof-replacement',
    name: 'Roof replacement',
    blurb: 'Tear-off, underlay, shingles, flashing and vents.',
    icon: 'roof',
    labourClass: 'roofer',
    defaultRegion: 'ON',
    defaultMarkup: 20,
    scale: { label: 'Roof area', unit: 'sq ft', min: 800, max: 4500, step: 100, default: 2000 },
    parts: [
      {
        label: 'Roofing',
        calc: { id: 'roofing', input: {}, scaleKey: 'area' },
        lines: [
          { code: 'SHINGLE-ARCH', per: 0.036 },
          { code: 'UNDERLAY-SYN', per: 0.001 },
          { code: 'ICE-WATER', fixed: 1, per: 0.0005 },
          { code: 'DRIP-EDGE', per: 0.011 },
          { code: 'STARTER-STRIP', fixed: 1, per: 0.0004 },
          { code: 'RIDGE-CAP', fixed: 1, per: 0.0004 },
          { code: 'ROOF-NAILS', fixed: 1, per: 0.0004 },
          { code: 'ROOF-VENT', per: 0.003 },
          { code: 'BIN-20YD', fixed: 1 },
        ],
      },
    ],
  },
];

export function getTemplate(id: string): JobTemplate {
  return JOB_TEMPLATES.find((t) => t.id === id) ?? JOB_TEMPLATES[0];
}
