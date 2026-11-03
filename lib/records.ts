// Field records (safety inspections, tailgate meetings, LOTO permits): one engine, per-module fields and sign-off rules.

export type Field =
  | { key: string; label: string; type: 'text' | 'date' | 'number'; placeholder?: string }
  | { key: string; label: string; type: 'textarea'; placeholder?: string }
  | { key: string; label: string; type: 'select'; options: string[] }
  | { key: string; label: string; type: 'checklist'; options: string[] };

export interface SignatureSlot {
  role: string; // stored on each signature
  label: string; // button / heading text
  multi?: boolean; // many people can sign (e.g. meeting attendees)
  after?: string; // role that must have signed first
  locks?: boolean; // signing this makes the record read-only
}

export interface RecordModule {
  table: string;
  title: string;
  singular: string;
  intro: string;
  fields: Field[];
  required: string[];
  slots: SignatureSlot[];
  status: (roles: string[]) => string;
}

export interface Signature {
  role: string;
  name: string;
  signature: string;
  signed_at: string;
}

const PPE = ['Hard hat', 'Safety glasses', 'Gloves', 'Arc-flash PPE', 'Fall protection', 'Hearing protection', 'Hi-vis', 'Respirator'];

export const RECORD_MODULES: Record<string, RecordModule> = {
  'safety-logs': {
    table: 'safety-logs',
    title: 'Safety Inspections',
    singular: 'Safety inspection',
    intro: 'Site walk-throughs: hazards found, controls in place, PPE and corrective actions, signed by the inspector.',
    fields: [
      { key: 'location', label: 'Area / location', type: 'text' },
      { key: 'inspector', label: 'Inspector', type: 'text' },
      { key: 'rating', label: 'Overall', type: 'select', options: ['Safe', 'Needs attention', 'Unsafe — work stopped'] },
      { key: 'hazards', label: 'Hazards found', type: 'textarea', placeholder: 'Exposed conductors, open trenches, housekeeping…' },
      { key: 'controls', label: 'Controls in place', type: 'textarea' },
      { key: 'ppe', label: 'PPE in use', type: 'checklist', options: PPE },
      { key: 'incidents', label: 'Incidents / near misses', type: 'textarea' },
      { key: 'actions', label: 'Corrective actions (who / by when)', type: 'textarea' },
    ],
    required: ['location'],
    slots: [{ role: 'inspector', label: 'Inspected by', locks: true }],
    status: (r) => (r.includes('inspector') ? 'Signed' : 'Open'),
  },
  'tailgate-logs': {
    table: 'tailgate-logs',
    title: 'Tailgate Meetings',
    singular: 'Tailgate meeting',
    intro: 'Pre-job safety talks: topic, hazards and controls, with every attendee signing in and the supervisor closing it off.',
    fields: [
      { key: 'topic', label: 'Topic', type: 'text', placeholder: 'Working near energized equipment' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'supervisor', label: 'Supervisor', type: 'text' },
      { key: 'tasks', label: 'Today’s tasks', type: 'textarea' },
      { key: 'hazards', label: 'Hazards discussed', type: 'textarea' },
      { key: 'controls', label: 'Controls / procedures', type: 'textarea' },
      { key: 'ppe', label: 'PPE required', type: 'checklist', options: PPE },
      { key: 'emergency', label: 'Emergency plan / muster point', type: 'text' },
    ],
    required: ['topic'],
    slots: [
      { role: 'attendee', label: 'Attendee sign-in', multi: true },
      { role: 'supervisor', label: 'Supervisor sign-off', after: 'attendee', locks: true },
    ],
    status: (r) => (r.includes('supervisor') ? 'Closed' : r.includes('attendee') ? 'Signing in' : 'Open'),
  },
  'loto-permits': {
    table: 'loto-permits',
    title: 'LOTO Permits',
    singular: 'LOTO permit',
    intro: 'Lockout/tagout: equipment, energy sources and isolation points, with lock-on, zero-energy verification and lock-off sign-offs.',
    fields: [
      { key: 'equipment', label: 'Equipment / system', type: 'text', placeholder: 'MCC-2 bucket 4B, conveyor C-12' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'reason', label: 'Work to be done', type: 'textarea' },
      { key: 'energy', label: 'Energy sources', type: 'checklist', options: ['Electrical', 'Mechanical', 'Hydraulic', 'Pneumatic', 'Thermal', 'Chemical', 'Gravity', 'Stored / capacitive'] },
      { key: 'isolation_points', label: 'Isolation points', type: 'textarea', placeholder: 'Breaker, disconnect, valve IDs…' },
      { key: 'lock_numbers', label: 'Lock numbers', type: 'text' },
      { key: 'tag_numbers', label: 'Tag numbers', type: 'text' },
      { key: 'verification', label: 'Zero-energy verification method', type: 'text', placeholder: 'Tested with meter (live-dead-live), tried start' },
      { key: 'workers', label: 'Workers under this lockout', type: 'textarea' },
    ],
    required: ['equipment'],
    slots: [
      { role: 'lock_on', label: 'Locked & tagged by' },
      { role: 'verified', label: 'Zero energy verified by', after: 'lock_on' },
      { role: 'lock_off', label: 'Locks removed / released by', after: 'verified', locks: true },
    ],
    status: (r) => (r.includes('lock_off') ? 'Released' : r.includes('verified') ? 'Locked out — verified' : r.includes('lock_on') ? 'Locked out' : 'Open'),
  },
};

export const isLocked = (m: RecordModule, sigs: Signature[]) => m.slots.some((s) => s.locks && sigs.some((g) => g.role === s.role));
