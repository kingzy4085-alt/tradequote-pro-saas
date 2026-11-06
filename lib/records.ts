// The safety record engine: LOTO permits, tailgate meetings and safety inspections.
// One editor, one API route and one print page, driven by this file. The database
// enforces the same rules (public.safety_record_rules); a test keeps the two in step.
import { z } from 'zod';
import { SignatureImage, SignerName } from './signature';

export const MAX_RECORD_PHOTOS = 50;

export interface RecordRequirement {
  key: string;
  label: string;
  /** Not needed when this other field has this value. */
  unless?: { key: string; value: string };
}

export interface RecordSlot {
  key: string;
  label: string;
  /** Status the record takes once this slot is signed. */
  status: string;
  /** Many people can sign this slot, such as meeting attendees. */
  multiple: boolean;
  /** Lowest rank that may sign this slot. Anyone who can write the record if left out. */
  minRank?: number;
  required: RecordRequirement[];
  /** What the person signing is agreeing to. Shown on screen and on the printout. */
  attest: string;
}

export interface RecordChecklist {
  key: string;
  label: string;
  options: string[];
}

export interface RecordConfig {
  slug: string;
  /** What one record is called in sentences. */
  noun: string;
  /** Status before anything is signed. */
  start: string;
  dateKey: string;
  checklists: RecordChecklist[];
  slots: RecordSlot[];
}

const PPE: RecordChecklist = {
  key: 'ppe',
  label: 'PPE',
  options: ['Hard hat', 'Safety glasses', 'Gloves', 'Arc-flash PPE', 'Fall protection', 'Hearing protection', 'Hi-vis', 'Safety boots', 'Respirator'],
};

export const RECORD_MODULES: Record<string, RecordConfig> = {
  'loto-permits': {
    slug: 'loto-permits',
    noun: 'permit',
    start: 'Draft',
    dateKey: 'record_date',
    checklists: [
      { key: 'energy_sources', label: 'Energy sources', options: ['Electrical', 'Mechanical', 'Hydraulic', 'Pneumatic', 'Thermal', 'Chemical', 'Gravity', 'Stored / capacitive'] },
      PPE,
    ],
    slots: [
      {
        key: 'lock_on',
        label: 'Lock-on',
        status: 'Locked Out',
        multiple: false,
        attest: 'I isolated the energy sources listed here and applied my lock and tag.',
        required: [
          { key: 'equipment_isolated', label: 'Equipment isolated' },
          { key: 'authorized_person', label: 'Authorized person' },
          { key: 'lock_number', label: 'Lock #' },
          { key: 'record_date', label: 'Date' },
          { key: 'isolation_points', label: 'Isolation points' },
          { key: 'energy_sources', label: 'Energy sources' },
        ],
      },
      {
        key: 'verified',
        label: 'Zero energy verification',
        status: 'Verified Zero Energy',
        multiple: false,
        attest: 'I tested this equipment and confirmed zero energy before work started.',
        required: [{ key: 'verification_method', label: 'How zero energy was verified' }],
      },
      {
        key: 'lock_off',
        label: 'Lock-off',
        status: 'Released',
        multiple: false,
        attest: 'The work is done, everyone is clear, and the locks and tags have been removed.',
        required: [{ key: 'release_notes', label: 'Release notes' }],
      },
    ],
  },
  'tailgate-logs': {
    slug: 'tailgate-logs',
    noun: 'meeting',
    start: 'Needs Sign-off',
    dateKey: 'meeting_date',
    checklists: [PPE],
    slots: [
      {
        key: 'attendee',
        label: 'Attendee sign-in',
        status: 'Needs Sign-off',
        multiple: true,
        attest: 'I attended this meeting and understand the hazards and controls discussed.',
        required: [
          { key: 'topic', label: 'Topic' },
          { key: 'meeting_date', label: 'Date' },
          { key: 'hazards', label: 'Hazards discussed' },
          { key: 'controls', label: 'Controls / procedures' },
        ],
      },
      {
        key: 'supervisor',
        label: 'Supervisor sign-off',
        status: 'Completed',
        multiple: false,
        minRank: 2,
        attest: 'I led or reviewed this meeting and everyone listed attended.',
        required: [],
      },
    ],
  },
  'safety-inspections': {
    slug: 'safety-inspections',
    noun: 'inspection',
    start: 'Draft',
    dateKey: 'record_date',
    checklists: [
      {
        key: 'inspection_items',
        label: 'Checked and OK',
        options: ['Housekeeping', 'Access and exits clear', 'Fire extinguishers', 'First aid kit', 'Electrical panels accessible', 'GFCI and cords', 'Ladders and scaffold', 'Fall protection', 'Barricades and signage', 'Tools and guards', 'Emergency plan posted'],
      },
      PPE,
    ],
    slots: [
      {
        key: 'inspector',
        label: 'Inspector sign-off',
        status: 'Signed Off',
        multiple: false,
        attest: 'I inspected this area and this record is accurate.',
        required: [
          { key: 'inspection_type', label: 'Type' },
          { key: 'record_date', label: 'Date' },
          { key: 'location', label: 'Area / location' },
          { key: 'result', label: 'Overall result' },
          { key: 'findings', label: 'Findings' },
          { key: 'corrective_actions', label: 'Corrective actions', unless: { key: 'result', value: 'Satisfactory' } },
        ],
      },
    ],
  },
};

export function recordConfig(slug: string): RecordConfig | undefined {
  return Object.prototype.hasOwnProperty.call(RECORD_MODULES, slug) ? RECORD_MODULES[slug] : undefined;
}

export interface RecordSignature {
  slot: string;
  name: string;
  signature: string;
  signed_at: string;
  user_id?: string | null;
}

export interface RecordReopen {
  at: string;
  by_name?: string | null;
  reason: string;
  removed: { slot: string; name: string; signed_at?: string }[];
}

/** A row of a record table: its fixed columns, plus the module's own fields. */
export type RecordRow = Record<string, unknown> & {
  id: string;
  company_id: string;
  title: string;
  status: string;
  notes: string | null;
  photos: string[];
  signatures: RecordSignature[];
  reopen_log: RecordReopen[];
};

/** Rank needed to reopen a signed record. The database trigger checks the same number. */
export const REOPEN_RANK = 3;

const slotIndex = (config: RecordConfig, key: string | undefined) => config.slots.findIndex((s) => s.key === key);

/** True once the last slot has been signed. Nothing changes after that until someone reopens it. */
export function isLocked(config: RecordConfig, signatures: RecordSignature[]): boolean {
  return slotIndex(config, signatures[signatures.length - 1]?.slot) === config.slots.length - 1;
}

/** The slots that can be signed right now: more of the current one if it takes many signers, then the next. */
export function nextSlots(config: RecordConfig, signatures: RecordSignature[]): RecordSlot[] {
  const last = slotIndex(config, signatures[signatures.length - 1]?.slot);
  const current = config.slots[last];
  const next = config.slots[last + 1];
  return [...(current?.multiple ? [current] : []), ...(next ? [next] : [])];
}

/** Fields someone has signed for. They stay as signed until that sign-off is reopened. */
export function attestedKeys(config: RecordConfig, signatures: RecordSignature[]): Set<string> {
  const last = slotIndex(config, signatures[signatures.length - 1]?.slot);
  return new Set(config.slots.slice(0, last + 1).flatMap((s) => s.required.map((r) => r.key)));
}

/**
 * Text as a person reads it: characters that print as nothing are removed and whitespace is
 * collapsed. The same rule as public.safety_clean_text, and tests/safety.test.ts compares them.
 */
export function cleanText(text: string): string {
  return text
    .replace(/[\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯⠀ㅤ︀-️﻿ﾠ￹-￻\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu, '')
    .replace(/[\s\u0085]+/g, ' ')
    .trim();
}

function isBlank(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || cleanText(String(value)) === '';
}

/** Labels of what still has to be filled in before this slot can be signed. */
export function missingFor(config: RecordConfig, slot: RecordSlot, values: Record<string, unknown>): string[] {
  const upTo = slotIndex(config, slot.key);
  return config.slots
    .slice(0, upTo + 1)
    .flatMap((s) => s.required)
    .filter((r) => !(r.unless && values[r.unless.key] === r.unless.value) && isBlank(values[r.key]))
    .map((r) => r.label);
}

/** Why a record can't be deleted, or null if it can. A record that was ever signed stays on file. */
export function deleteBlock(row: { signatures?: unknown; reopen_log?: unknown }): string | null {
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return count(row.signatures) > 0 || count(row.reopen_log) > 0 ? 'This record has been signed, so it stays on file and cannot be deleted.' : null;
}

/** When someone signed, with the time zone shown: print pages render on a server in another zone. */
export function formatSignedAt(iso: string | undefined): string {
  const when = new Date(iso ?? '');
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/** Storage folder for one record's photos. The database only accepts photo paths inside it. */
export const recordPhotoFolder = (companyId: string, slug: string, id: string) => `${companyId}/${slug}/${id}/`;

/** True when a path names a file directly inside this folder, which is all storage will hold. */
export function isRecordPhotoPath(folder: string, path: string): boolean {
  if (!path.startsWith(folder) || path.includes('..')) return false;
  const file = path.slice(folder.length);
  return file !== '' && !file.includes('/');
}

/** What a checklist shows: its options, plus any item a record holds that has since left the list. */
export function checklistChoices(list: RecordChecklist, held: string[]): string[] {
  return [...list.options, ...held.filter((item) => !list.options.includes(item))];
}

export const RecordAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    fields: z.record(z.string(), z.unknown()).optional(),
    checklists: z.record(z.string(), z.array(z.string().max(100)).max(50)).optional(),
  }),
  z.object({
    action: z.literal('photos'),
    photos: z.array(z.string().max(300)).max(MAX_RECORD_PHOTOS, `A record can have up to ${MAX_RECORD_PHOTOS} photos`),
  }),
  z.object({
    action: z.literal('sign'),
    slot: z.string().max(40),
    name: SignerName.refine((name) => cleanText(name) !== '', 'Enter the name of the person signing'),
    signature: SignatureImage,
  }),
  z.object({
    action: z.literal('reopen'),
    reason: z.string().trim().max(1000).refine((reason) => cleanText(reason) !== '', 'Enter a reason for reopening this record'),
    /** The sign-off the person saw on screen, so a retry or second tab can't take back the one before it. */
    slot: z.string().max(40).optional(),
  }),
]);
export type RecordAction = z.infer<typeof RecordAction>;
