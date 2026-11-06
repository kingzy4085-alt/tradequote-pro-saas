// The single source of truth for every TradeQuote PRO module: its table, its
// fields, its statuses and who may read, write and delete it. The API, the
// shared module page and the database migration (checked by tests) all follow it.

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'boolean' | 'email' | 'tel' | 'project' | 'client' | 'uuid' | 'datetime' | 'list';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /** System-owned: parseRecord strips it and the form shows it read-only. */
  computed?: boolean;
  /** Not shown on the generic form or in list columns. Still returned by the API. */
  hidden?: boolean;
  /** No signed-in user can read this column directly (the database revokes it), so no select may name it. */
  restricted?: boolean;
  /** Old free text replaced by a link. Not offered on new records; shown only on an unlinked record that still has text. */
  legacy?: boolean;
  /** Lowest number accepted. */
  min?: number;
  /** For 'uuid' fields that point at another table in the same company: that table. 'project' and 'client' imply theirs. */
  references?: string;
  /** Column whose text is matched to the linked record's title when old rows are backfilled. Default: project_name or client_name, if the module has it. */
  backfillFrom?: string;
}

export type ModuleGroup = 'Field' | 'Estimating & Sales' | 'Project Controls' | 'Finance' | 'Resources';

export interface ModuleDef {
  slug: string;
  table: string;
  label: string;
  description: string;
  group: ModuleGroup;
  /** Label for the record's name, stored in `title`. */
  titleLabel: string;
  titlePlaceholder: string;
  /** What one record is called on buttons and messages, when that differs from titleLabel (an estimate's title is its project). */
  recordLabel?: string;
  statuses: string[];
  /** Statuses only the system sets (e.g. Overdue). Users can't pick them by hand; the API refuses them. */
  systemStatuses?: string[];
  /** Created from the list, then filled in on its detail page: no inline edit form and no status picker. */
  editOnDetail?: boolean;
  fields: FieldDef[];
  /** Minimum role rank (see lib/roles.ts) to read, create/edit and delete. */
  read: number;
  write: number;
  remove: number;
  /** Below this rank a user only sees the rows they created (e.g. their own timecards). */
  ownRowsBelow?: number;
  /** Older camelCase field names the pages and integrations may still send. */
  aliases?: Record<string, string>;
}

const PM = 3;
const ADMIN = 4;
const FOREMAN = 2;
const CREW = 1;

const field = (key: string, label: string, type: FieldType = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type,
  ...extra,
});

const projectLink = (extra: Partial<FieldDef> = {}) => field('project_id', 'Project', 'project', extra);
const clientLink = field('client_id', 'Client', 'client');
// Safety records keep these as JSON lists, saved through /api/records and left out of list responses. See lib/records.ts.
const recordLists = (...checklists: string[]) => [...checklists, 'photos', 'signatures', 'reopen_log'].map((key) => field(key, key, 'list', { computed: true, hidden: true }));

export const MODULES: ModuleDef[] = [
  // Field
  {
    slug: 'daily-logs', table: 'daily_logs', label: 'Daily Logs', group: 'Field',
    description: 'End-of-shift site reports: crew, weather, work done and delays.',
    titleLabel: 'Log Title', titlePlaceholder: 'e.g. Unit 3 MCC tie-in, day 2', recordLabel: 'Daily Log',
    statuses: ['Draft', 'Submitted', 'Reviewed'],
    fields: [
      projectLink(),
      field('log_date', 'Date', 'date'),
      field('crew_lead', 'Crew Lead'),
      field('weather', 'Weather'),
      field('crew_count', 'Crew Count', 'number'),
      field('hours', 'Total Crew Hours', 'number'),
      field('work_done', 'Work Completed', 'textarea'),
      field('delays', 'Delays / Issues', 'textarea'),
      field('safety_notes', 'Safety', 'textarea'),
    ],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'field-logs', table: 'field_logs', label: 'Field Logs', group: 'Field',
    description: 'Quick notes from the field: issues, observations and photos to follow up.',
    titleLabel: 'Entry', titlePlaceholder: 'e.g. Cable tray blocked at grid C-4', recordLabel: 'Field Log',
    statuses: ['Logged', 'Actioned', 'Closed'],
    fields: [projectLink(), field('location', 'Location'), field('author', 'Author')],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'timecards', table: 'timecards', label: 'Timecards', group: 'Field',
    description: 'Hours by worker and job, with regular and overtime split.',
    titleLabel: 'Job / Cost Code', titlePlaceholder: 'e.g. 24-118 Canola Plant — Labour', recordLabel: 'Timecard',
    statuses: ['Submitted', 'Approved', 'Rejected', 'Exported'],
    systemStatuses: ['Exported'],
    fields: [
      projectLink({ backfillFrom: 'title' }),
      field('employee_name', 'Employee', 'text', { required: true }),
      field('work_date', 'Date', 'date'),
      field('regular_hours', 'Regular Hours', 'number', { min: 0 }),
      field('overtime_hours', 'Overtime Hours', 'number', { min: 0 }),
      field('employee_id', 'Employee record', 'uuid', { hidden: true, references: 'employees' }),
      field('worker_user_id', 'Worker login', 'uuid', { hidden: true }),
      field('reject_reason', 'Why it was rejected', 'text', { hidden: true }),
      // Set by the guard_timecard trigger when a card is approved. Never taken from a client.
      field('hourly_cost', 'Hourly Cost', 'money', { computed: true, hidden: true, restricted: true }),
      field('labour_cost', 'Labour Cost', 'money', { computed: true, hidden: true, restricted: true }),
      field('approved_by', 'Approved By', 'uuid', { computed: true, hidden: true }),
      field('approved_by_name', 'Approved By', 'text', { computed: true, hidden: true }),
      field('approved_at', 'Approved', 'datetime', { computed: true, hidden: true }),
      field('exported_at', 'Exported', 'datetime', { computed: true, hidden: true }),
    ],
    read: CREW, write: CREW, remove: CREW, ownRowsBelow: FOREMAN,
    aliases: { name: 'title' },
  },
  {
    slug: 'crew-schedule', table: 'crew_schedule', label: 'Crew Schedule', group: 'Field',
    description: 'Who is on which site, which shift.',
    titleLabel: 'Crew / Worker', titlePlaceholder: 'e.g. Crew A — Mike, Raj, Tessa', recordLabel: 'Crew Booking',
    statuses: ['Scheduled', 'On Site', 'Complete', 'Cancelled'],
    fields: [projectLink(), field('shift', 'Shift', 'select', { options: ['Days', 'Nights', 'Swing'] }), field('location', 'Site'), field('start_date', 'Start', 'date'), field('end_date', 'End', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'tailgate-logs', table: 'tailgate_logs', label: 'Tailgate Meetings', group: 'Field',
    description: 'Toolbox talks and FLHAs: hazards, who attended and supervisor sign-off.',
    titleLabel: 'Meeting', titlePlaceholder: 'e.g. Morning FLHA — energized work near MCC', recordLabel: 'Tailgate Meeting',
    // Worked out from the signatures by the database
    statuses: ['Needs Sign-off', 'Completed'],
    systemStatuses: ['Completed'],
    editOnDetail: true,
    fields: [
      projectLink(),
      field('topic', 'Topic'),
      field('attendees_count', 'Attendees', 'number', { computed: true }),
      field('meeting_date', 'Date', 'date'),
      field('location', 'Location', 'text', { hidden: true, placeholder: 'e.g. Unit 3 laydown yard' }),
      field('hazards', 'Hazards Discussed', 'textarea', { hidden: true, placeholder: 'Energized gear, overhead lifts, other trades in the area…' }),
      field('controls', 'Controls / Procedures', 'textarea', { hidden: true, placeholder: 'LOTO in place, spotter on lifts, barricades up…' }),
      ...recordLists('ppe'),
    ],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'safety-inspections', table: 'safety_inspections', label: 'Safety Inspections', group: 'Field',
    description: 'Site and equipment safety walks with findings, photos and inspector sign-off.',
    titleLabel: 'Inspection', titlePlaceholder: 'e.g. Weekly site walk — Unit 3',
    // Worked out from the signatures by the database
    statuses: ['Draft', 'Signed Off'],
    systemStatuses: ['Signed Off'],
    editOnDetail: true,
    fields: [
      projectLink(),
      field('inspection_type', 'Type', 'select', { options: ['Site Walk', 'Equipment', 'Vehicle', 'Scaffold / Ladder', 'Fire Safety', 'Other'] }),
      field('record_date', 'Date', 'date'),
      field('location', 'Area / Location'),
      field('result', 'Overall Result', 'select', { hidden: true, options: ['Satisfactory', 'Corrective Action Needed', 'Unsafe: Work Stopped'] }),
      field('findings', 'Findings', 'textarea', { hidden: true, placeholder: 'What you checked and what you found…' }),
      field('corrective_actions', 'Corrective Actions', 'textarea', { hidden: true, placeholder: 'What has to be fixed, by whom and by when…' }),
      ...recordLists('inspection_items', 'ppe'),
    ],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'safety-logs', table: 'safety_logs', label: 'Safety Logs', group: 'Field',
    description: 'Incidents, near misses and hazards, with severity and follow-up.',
    titleLabel: 'Incident', titlePlaceholder: 'e.g. Near miss — dropped conduit from lift',
    statuses: ['Open', 'Under Investigation', 'Resolved'],
    fields: [
      projectLink(),
      field('incident_type', 'Type', 'select', { options: ['Near Miss', 'First Aid', 'Medical Aid', 'Lost Time', 'Property Damage', 'Hazard'] }),
      field('severity', 'Severity', 'select', { options: ['Low', 'Medium', 'High', 'Critical'] }),
      field('incident_date', 'Date', 'date'),
    ],
    read: CREW, write: CREW, remove: ADMIN,
  },
  {
    slug: 'loto-permits', table: 'loto_permits', label: 'LOTO Permits', group: 'Field',
    description: 'Lockout/tagout permits: lock-on, zero energy verification and lock-off, signed in order.',
    titleLabel: 'Permit', titlePlaceholder: 'e.g. LOTO-0412 Conveyor 7 drive', recordLabel: 'LOTO Permit',
    // Worked out from the signatures by the database
    statuses: ['Draft', 'Locked Out', 'Verified Zero Energy', 'Released'],
    systemStatuses: ['Locked Out', 'Verified Zero Energy', 'Released'],
    editOnDetail: true,
    fields: [
      projectLink(),
      field('equipment_isolated', 'Equipment Isolated', 'text', { required: true }),
      field('authorized_person', 'Authorized Person', 'text', { required: true }),
      field('lock_number', 'Lock #'),
      field('record_date', 'Date', 'date'),
      field('isolation_points', 'Isolation Points', 'textarea', { hidden: true, placeholder: 'Breakers, disconnects and valves locked, with their tags…' }),
      field('verification_method', 'How Zero Energy Was Verified', 'textarea', { hidden: true, placeholder: 'Meter used, points tested, try-start result…' }),
      field('release_notes', 'Release Notes', 'textarea', { hidden: true, placeholder: 'Work complete, guards back on, crew clear, equipment returned to…' }),
      ...recordLists('energy_sources', 'ppe'),
    ],
    read: CREW, write: CREW, remove: ADMIN,
  },
  {
    slug: 'inspections', table: 'inspections', label: 'Inspections', group: 'Field',
    description: 'Electrical, safety and authority inspections with outcome.',
    titleLabel: 'Inspection', titlePlaceholder: 'e.g. Rough-in inspection — Level 2',
    statuses: ['Scheduled', 'Passed', 'Failed', 'Re-inspect'],
    fields: [projectLink(), field('inspector', 'Inspector'), field('inspection_date', 'Date', 'date'), field('permit_number', 'Permit #')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'punch-list', table: 'punch_list', label: 'Punch List', group: 'Field',
    description: 'Deficiencies to close out before turnover.',
    titleLabel: 'Item', titlePlaceholder: 'e.g. Missing cover plate, room 204', recordLabel: 'Punch Item',
    statuses: ['Open', 'In Progress', 'Ready for Review', 'Closed'],
    fields: [
      projectLink(),
      field('project_name', 'Project (old text)', 'text', { legacy: true }),
      field('assigned_trade', 'Assigned Trade'),
      field('priority', 'Priority', 'select', { options: ['Normal', 'High', 'Critical / Inspection Blocker'] }),
      field('location', 'Location'),
      field('due_date', 'Due', 'date'),
    ],
    read: CREW, write: CREW, remove: PM,
    aliases: { itemTitle: 'title' },
  },
  {
    slug: 'tool-crib', table: 'tool_crib', label: 'Tool Crib', group: 'Field',
    description: 'Tool check-out and check-in by worker.',
    titleLabel: 'Tool', titlePlaceholder: 'e.g. Fluke 1587 insulation tester',
    statuses: ['Available', 'Checked Out', 'Out for Calibration', 'Lost'],
    fields: [field('tool_number', 'Tool #'), field('assigned_to', 'Assigned To'), field('due_back', 'Due Back', 'date')],
    read: CREW, write: CREW, remove: PM,
  },

  // Estimating & Sales
  {
    slug: 'crm', table: 'crm', label: 'Clients', group: 'Estimating & Sales',
    description: 'Facility owners, plants and GCs you bid for.',
    titleLabel: 'Client', titlePlaceholder: 'e.g. Cargill Ltd.',
    statuses: ['Lead', 'Active Client', 'Inactive'],
    fields: [field('contact_person', 'Contact'), field('email', 'Email', 'email'), field('phone', 'Phone', 'tel'), field('project_site', 'Site / Facility')],
    read: PM, write: PM, remove: PM,
    aliases: { clientName: 'title', client_name: 'title' },
  },
  {
    slug: 'estimates', table: 'estimates', label: 'Estimates', group: 'Estimating & Sales',
    description: 'Bids for shutdowns, electrical projects and service work.',
    titleLabel: 'Project', titlePlaceholder: 'e.g. Canola Plant Shutdown Maintenance', recordLabel: 'Estimate',
    statuses: ['Draft', 'Submitted', 'Won', 'Lost'],
    fields: [
      clientLink,
      field('client_name', 'Client Name'),
      field('client_address', 'Client / Site Address'),
      field('bid_due', 'Bid Due', 'date'),
      field('labour_rate', 'Labour Rate ($/hr)', 'money'),
      field('markup_percentage', 'Markup %', 'number'),
      field('tax_percentage', 'Tax %', 'number'),
      // Worked out by the database from the lines and rates: see 20261104000200_job_costing.sql
      field('total_amount', 'Total', 'money', { computed: true }),
      field('scope', 'Scope of Work', 'textarea'),
      field('terms', 'Terms', 'textarea'),
      projectLink({ backfillFrom: 'title', label: 'Linked Project' }),
    ],
    read: PM, write: PM, remove: PM,
    aliases: { projectName: 'title', project_name: 'title' },
  },
  {
    slug: 'proposals', table: 'proposals', label: 'Proposals', group: 'Estimating & Sales',
    description: 'Client-facing proposals with scope, terms and price.',
    titleLabel: 'Proposal', titlePlaceholder: 'e.g. Unit 3 MCC Replacement — Proposal',
    statuses: ['Draft', 'Sent', 'Accepted', 'Declined'],
    editOnDetail: true,
    fields: [
      clientLink,
      field('client_name', 'Client Name'),
      field('total_amount', 'Total', 'money'),
      field('valid_until', 'Prices Valid Until', 'date'),
      field('scope_of_work', 'Scope of Work', 'textarea'),
      field('terms', 'Terms', 'textarea'),
      projectLink(),
      // Set by "Create proposal" on an estimate. While set, the total follows that estimate.
      field('estimate_id', 'Estimate', 'uuid', { computed: true, hidden: true, references: 'estimates' }),
    ],
    read: PM, write: PM, remove: PM,
    aliases: { proposalTitle: 'title', proposal_title: 'title' },
  },
  {
    slug: 'rfq', table: 'rfq', label: 'RFQs to Suppliers', group: 'Estimating & Sales',
    description: 'Material and equipment quote requests sent to suppliers.',
    titleLabel: 'Request', titlePlaceholder: 'e.g. 2000A switchboard pricing', recordLabel: 'RFQ',
    statuses: ['Draft', 'Sent', 'Quoted', 'Awarded', 'Closed'],
    fields: [field('vendor', 'Supplier'), field('deadline', 'Quote Due', 'date'), field('quoted_amount', 'Quoted Amount', 'money')],
    read: FOREMAN, write: PM, remove: PM,
  },
  {
    slug: 'rfp', table: 'rfp', label: 'Bid Opportunities', group: 'Estimating & Sales',
    description: 'RFPs and tenders you are tracking or bidding.',
    titleLabel: 'Opportunity', titlePlaceholder: 'e.g. City of Regina substation upgrade', recordLabel: 'Bid Opportunity',
    statuses: ['Reviewing', 'Bidding', 'Submitted', 'Won', 'Lost', 'No Bid'],
    fields: [field('owner_name', 'Owner'), field('closing_date', 'Closing', 'date'), field('estimated_value', 'Est. Value', 'money')],
    read: PM, write: PM, remove: PM,
  },

  // Project Controls
  {
    slug: 'projects', table: 'projects', label: 'Projects', group: 'Project Controls',
    description: 'Active jobs with client, site, dates and contract value.',
    titleLabel: 'Project', titlePlaceholder: 'e.g. 24-118 Canola Plant Shutdown',
    statuses: ['Planning', 'Active', 'On Hold', 'Complete'],
    fields: [
      clientLink,
      field('client_name', 'Client Name'),
      field('site', 'Site'),
      field('start_date', 'Start', 'date'),
      field('end_date', 'End', 'date'),
      field('contract_value', 'Contract Value', 'money', { restricted: true }),
      // Kept up to date from approved change orders
      field('approved_changes', 'Approved Changes', 'money', { computed: true, restricted: true }),
      field('revised_contract', 'Revised Contract', 'money', { computed: true, restricted: true }),
      field('approved_days', 'Approved Schedule Change (days)', 'number', { computed: true, hidden: true }),
      field('revised_end_date', 'Revised End', 'date', { computed: true }),
      // Set by "Create project" on an accepted proposal
      field('estimate_id', 'Estimate', 'uuid', { computed: true, hidden: true, references: 'estimates' }),
      field('proposal_id', 'Proposal', 'uuid', { computed: true, hidden: true, references: 'proposals' }),
    ],
    read: CREW, write: PM, remove: ADMIN,
  },
  {
    slug: 'rfis', table: 'rfis', label: 'RFIs', group: 'Project Controls',
    description: 'Questions to the engineer or owner, and their answers.',
    titleLabel: 'Question', titlePlaceholder: 'e.g. Confirm feeder size to MCC-3', recordLabel: 'RFI',
    statuses: ['Open', 'Answered', 'Closed'],
    fields: [projectLink(), field('rfi_number', 'RFI #'), field('assignee', 'Directed To'), field('due_date', 'Response Due', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'change-orders', table: 'change_orders', label: 'Change Orders', group: 'Project Controls',
    description: 'Priced scope changes with client sign-off. Approved prices update the contract.',
    titleLabel: 'Change', titlePlaceholder: 'e.g. Add 2 VFDs to conveyor line', recordLabel: 'Change Order',
    statuses: ['Draft', 'Sent', 'Approved', 'Rejected'],
    // Approved takes a name, a drawn signature and a price: see /api/change-orders/[id]
    systemStatuses: ['Approved'],
    editOnDetail: true,
    fields: [
      field('co_number', 'CO #', 'text', { computed: true }),
      projectLink(),
      // These money columns are hidden from everyone signed in and served by change_order_money: see 20261104000320_review_fixes.sql
      field('total', 'Total', 'money', { computed: true, restricted: true }),
      field('project_name', 'Project (old text)', 'text', { legacy: true }),
      field('reason', 'Reason', 'text', { placeholder: 'Client request, site condition, design change' }),
      field('scope', 'Scope of Added or Changed Work', 'textarea'),
      field('material_cost', 'Material Cost', 'money', { restricted: true }),
      field('labour_hours', 'Labour Hours', 'number', { min: 0 }),
      field('labour_rate', 'Labour Rate ($/hr)', 'money', { min: 0, restricted: true }),
      field('markup_pct', 'Markup %', 'number', { min: 0, restricted: true }),
      field('tax_pct', 'Tax %', 'number', { min: 0 }),
      field('days_impact', 'Schedule Impact (days)', 'number'),
      field('price', 'Price', 'money', { computed: true, restricted: true }),
      field('tax', 'Tax', 'money', { computed: true, restricted: true }),
      field('cost_impact', 'Cost Impact', 'money', { computed: true, hidden: true, restricted: true }),
      field('budget_cost', 'Budget Cost', 'money', { computed: true, hidden: true, restricted: true }),
      field('approved_by', 'Approved By', 'text', { computed: true }),
      field('approved_at', 'Approved', 'datetime', { computed: true, hidden: true }),
      field('invoice_id', 'Invoice', 'uuid', { computed: true, hidden: true, references: 'invoices' }),
    ],
    read: FOREMAN, write: PM, remove: PM,
  },
  {
    slug: 'submittals', table: 'submittals', label: 'Submittals', group: 'Project Controls',
    description: 'Shop drawings and product data sent for review.',
    titleLabel: 'Submittal', titlePlaceholder: 'e.g. Lighting fixture schedule',
    statuses: ['Pending Review', 'Approved', 'Approved as Noted', 'Revise & Resubmit'],
    fields: [projectLink(), field('submittal_number', 'Submittal #'), field('spec_section', 'Spec Section')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'drawings', table: 'drawings', label: 'Drawings', group: 'Project Controls',
    description: 'Drawing register with the current revision of each sheet.',
    titleLabel: 'Sheet Title', titlePlaceholder: 'e.g. Single Line Diagram', recordLabel: 'Drawing',
    statuses: ['Issued for Construction', 'Superseded', 'For Review'],
    fields: [projectLink(), field('drawing_number', 'Drawing #'), field('revision', 'Revision'), field('issued_date', 'Issued', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'documents', table: 'documents', label: 'Documents', group: 'Project Controls',
    description: 'Specs, manuals and procedures with version.',
    titleLabel: 'Document', titlePlaceholder: 'e.g. Site safety plan',
    statuses: ['Active', 'Draft', 'Archived'],
    fields: [projectLink(), field('category', 'Category'), field('version', 'Version')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'site-vault', table: 'site_vault', label: 'Site Vault', group: 'Project Controls',
    description: 'Restricted documents: contracts, access lists, client confidential.',
    titleLabel: 'Item', titlePlaceholder: 'e.g. Plant access card list', recordLabel: 'Vault Item',
    statuses: ['Secure', 'Expired'],
    fields: [field('document_type', 'Type'), field('confidentiality', 'Confidentiality', 'select', { options: ['Restricted', 'Confidential', 'Internal'] }), field('expiry_date', 'Expiry', 'date')],
    read: PM, write: PM, remove: ADMIN,
  },
  {
    slug: 'commissioning', table: 'commissioning', label: 'Commissioning', group: 'Project Controls',
    description: 'Pre-functional and functional checks by system and tag.',
    titleLabel: 'Check', titlePlaceholder: 'e.g. MCC-3 functional test', recordLabel: 'Commissioning Check',
    statuses: ['Not Started', 'In Progress', 'Passed', 'Failed'],
    fields: [projectLink(), field('equipment_tag', 'Equipment Tag'), field('system_type', 'System')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'cable-testing', table: 'cable_testing', label: 'Cable Testing', group: 'Project Controls',
    description: 'Megger and continuity results by cable tag.',
    titleLabel: 'Test', titlePlaceholder: 'e.g. Feeder F-12 IR test', recordLabel: 'Cable Test',
    statuses: ['Pass', 'Fail', 'Retest'],
    fields: [projectLink(), field('cable_tag', 'Cable Tag'), field('test_voltage', 'Test Voltage'), field('reading', 'Reading (MΩ)')],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'quality-control', table: 'quality_control', label: 'Quality Control', group: 'Project Controls',
    description: 'QC checklists and hold points.',
    titleLabel: 'Check', titlePlaceholder: 'e.g. Termination torque check — panel LP-2', recordLabel: 'QC Check',
    statuses: ['Open', 'Passed', 'Failed'],
    fields: [projectLink(), field('checked_by', 'Checked By'), field('check_date', 'Date', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'non-conformance', table: 'non_conformance', label: 'Non-Conformance', group: 'Project Controls',
    description: 'Work or material that does not meet spec, and its disposition.',
    titleLabel: 'Issue', titlePlaceholder: 'e.g. Wrong cable type pulled to MCC-2', recordLabel: 'Non-Conformance',
    statuses: ['Open', 'Disposition Pending', 'Closed'],
    fields: [projectLink(), field('disposition', 'Disposition', 'select', { options: ['Rework', 'Repair', 'Use As Is', 'Reject'] }), field('raised_by', 'Raised By')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'defect-liability', table: 'defect_liability', label: 'Deficiencies', group: 'Project Controls',
    description: 'Warranty-period defects reported after turnover.',
    titleLabel: 'Defect', titlePlaceholder: 'e.g. GFCI tripping in washroom 2',
    statuses: ['Open', 'Scheduled', 'Closed'],
    fields: [field('facility', 'Facility'), field('severity', 'Severity', 'select', { options: ['Minor', 'Major', 'Critical'] })],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'warranty', table: 'warranty', label: 'Warranty', group: 'Project Controls',
    description: 'Equipment warranties and their expiry dates.',
    titleLabel: 'Item', titlePlaceholder: 'e.g. MCC-4 breaker warranty', recordLabel: 'Warranty Item',
    statuses: ['Active', 'Expiring', 'Expired', 'Claimed'],
    fields: [field('equipment_tag', 'Equipment Tag'), field('expiry_date', 'Expiry', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'tasks', table: 'tasks', label: 'Tasks', group: 'Project Controls',
    description: 'To-dos assigned to people, with due dates.',
    titleLabel: 'Task', titlePlaceholder: 'e.g. Order breakers for panel LP-3',
    statuses: ['To Do', 'In Progress', 'Done'],
    fields: [projectLink(), field('assigned_to', 'Assigned To'), field('due_date', 'Due', 'date')],
    read: CREW, write: CREW, remove: FOREMAN,
  },

  // Finance
  {
    slug: 'job-costing', table: 'job_costing', label: 'Job Costing', group: 'Finance',
    description: 'Budget, actual cost, billing and margin by job. Kept current from timecards, bills, POs, change orders and invoices.',
    titleLabel: 'Job', titlePlaceholder: 'e.g. 24-118 Canola Plant Shutdown',
    statuses: ['On Track', 'At Risk', 'Over Budget', 'Closed'],
    // Worked out from actual against budget. Only closing or reopening a job is a person's call, through set_job_closed.
    systemStatuses: ['On Track', 'At Risk', 'Over Budget'],
    editOnDetail: true,
    // Everything here is kept by recalc_job_cost, or set through set_job_budget: see 20261104000200_job_costing.sql.
    // Signed-in users have no insert or update on this table, so the /job-costing page is the only way in.
    fields: [
      projectLink({ backfillFrom: 'title' }),
      field('budget', 'Budget', 'money', { computed: true }),
      field('actual_cost', 'Actual Cost', 'money', { computed: true }),
      field('budget_labour_hours', 'Budget Labour Hours', 'number', { computed: true, hidden: true }),
      field('budget_labour', 'Budget Labour', 'money', { computed: true, hidden: true }),
      field('budget_material', 'Budget Material', 'money', { computed: true, hidden: true }),
      field('budget_other', 'Budget Other', 'money', { computed: true, hidden: true }),
      field('co_revenue', 'Approved Change Order Revenue', 'money', { computed: true, hidden: true }),
      field('co_cost', 'Approved Change Order Cost', 'money', { computed: true, hidden: true }),
      field('co_labour_hours', 'Approved Change Order Hours', 'number', { computed: true, hidden: true }),
      field('actual_labour_hours', 'Actual Labour Hours', 'number', { computed: true, hidden: true }),
      field('actual_labour', 'Actual Labour', 'money', { computed: true, hidden: true }),
      field('actual_material', 'Actual Material', 'money', { computed: true, hidden: true }),
      field('actual_other', 'Actual Other', 'money', { computed: true, hidden: true }),
      field('committed', 'Committed', 'money', { computed: true, hidden: true }),
      field('billed_amount', 'Billed', 'money', { computed: true, hidden: true }),
      field('paid_amount', 'Paid', 'money', { computed: true, hidden: true }),
      field('margin', 'Margin', 'money', { computed: true, hidden: true }),
      field('margin_pct', 'Margin %', 'number', { computed: true, hidden: true }),
      field('cost_used_pct', 'Cost Used %', 'number', { computed: true, hidden: true }),
      field('rolled_up_at', 'Last Changed', 'datetime', { computed: true, hidden: true }),
    ],
    read: PM, write: PM, remove: ADMIN,
  },
  {
    slug: 'progress-billing', table: 'progress_billing', label: 'Progress Billing', group: 'Finance',
    description: 'Monthly progress draws with holdback.',
    titleLabel: 'Draw', titlePlaceholder: 'e.g. Draw #4 — October',
    statuses: ['Draft', 'Invoiced', 'Paid'],
    // Follows the invoice the draw creates
    systemStatuses: ['Invoiced', 'Paid'],
    fields: [
      projectLink(),
      field('billing_period', 'Period'),
      field('amount_billed', 'Amount Billed', 'money', { min: 0 }),
      field('holdback_percent', 'Holdback %', 'number', { min: 0 }),
      field('holdback_release_date', 'Holdback Release', 'date'),
      field('invoice_id', 'Invoice', 'uuid', { computed: true, hidden: true, references: 'invoices' }),
    ],
    read: PM, write: PM, remove: ADMIN,
  },
  {
    slug: 'invoices', table: 'invoices', label: 'Invoices', group: 'Finance',
    description: 'Invoices issued to clients.',
    titleLabel: 'Invoice', titlePlaceholder: 'e.g. Draw #4, October',
    statuses: ['Draft', 'Sent', 'Paid', 'Overdue', 'Void'],
    systemStatuses: ['Overdue'],
    editOnDetail: true,
    fields: [
      field('invoice_number', 'Invoice #', 'text', { computed: true }),
      field('client_name', 'Client'),
      field('total', 'Total Due', 'money', { computed: true }),
      projectLink(),
      clientLink,
      field('client_address', 'Client Address'),
      field('issue_date', 'Issue Date', 'date'),
      field('due_date', 'Due', 'date'),
      field('tax_pct', 'Tax %', 'number', { min: 0 }),
      field('holdback_pct', 'Holdback %', 'number', { min: 0 }),
      field('holdback_release_date', 'Holdback Release', 'date'),
      field('amount', 'Subtotal', 'money', { computed: true }),
      field('gst', 'Tax', 'money', { computed: true }),
      field('holdback_amount', 'Holdback Withheld', 'money', { computed: true }),
      field('paid_at', 'Paid On', 'date', { computed: true }),
      // Priced by the database when saved: see 20261104000110_billing.sql
      field('lines', 'Lines', 'list', { computed: true, hidden: true }),
    ],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'receivables', table: 'receivables', label: 'Receivables', group: 'Finance',
    description: 'Money owed to you, by client and age.',
    titleLabel: 'Receivable', titlePlaceholder: 'e.g. Cargill — Draw #3',
    statuses: ['Current', '30 Days', '60 Days', '90+ Days', 'Collected'],
    // Age is worked out from the due date. A receivable from an invoice follows that invoice: the database refuses any hand edit.
    systemStatuses: ['30 Days', '60 Days', '90+ Days'],
    fields: [
      projectLink(),
      field('client_name', 'Client'),
      field('amount', 'Amount', 'money'),
      field('due_date', 'Due', 'date'),
      field('invoice_id', 'Invoice', 'uuid', { computed: true, hidden: true, references: 'invoices' }),
    ],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'payables', table: 'payables', label: 'Payables', group: 'Finance',
    description: 'Supplier and subcontractor bills to pay.',
    titleLabel: 'Bill', titlePlaceholder: 'e.g. Westburne invoice 88123',
    statuses: ['To Approve', 'Approved', 'Paid'],
    fields: [projectLink(), field('vendor', 'Vendor'), field('amount', 'Amount', 'money'), field('due_date', 'Due', 'date'), field('purchase_order_id', 'Purchase Order', 'uuid', { references: 'purchase_orders' })],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'purchase-orders', table: 'purchase_orders', label: 'Purchase Orders', group: 'Finance',
    description: 'POs to suppliers by job.',
    titleLabel: 'PO', titlePlaceholder: 'e.g. PO-1043 — 600 m 4/0 Teck',
    statuses: ['Draft', 'Issued', 'Partially Received', 'Received', 'Closed'],
    fields: [projectLink(), field('vendor', 'Supplier'), field('project_name', 'Job (old text)', 'text', { legacy: true }), field('amount', 'Amount', 'money'), field('required_date', 'Required On Site', 'date')],
    read: FOREMAN, write: PM, remove: PM,
  },

  // Resources
  {
    slug: 'vendors', table: 'vendors', label: 'Vendors', group: 'Resources',
    description: 'Suppliers and their WCB and insurance status.',
    titleLabel: 'Vendor', titlePlaceholder: 'e.g. Westburne — Regina',
    statuses: ['Preferred', 'Approved', 'On Hold'],
    fields: [
      field('trade_category', 'Category'),
      field('contact_person', 'Contact'),
      field('phone', 'Phone', 'tel'),
      field('email', 'Email', 'email'),
      field('insurance_expiry', 'Insurance Expiry', 'date'),
      field('wcb_clearance_expiry', 'WCB Clearance Expiry', 'date'),
    ],
    read: FOREMAN, write: PM, remove: PM,
    aliases: { vendorName: 'title', vendor_name: 'title' },
  },
  {
    slug: 'sub-compliance', table: 'sub_compliance', label: 'Sub Compliance', group: 'Resources',
    description: 'Subcontractor WCB clearance, liability insurance and safety certification.',
    titleLabel: 'Subcontractor', titlePlaceholder: 'e.g. Apex Industrial Insulation',
    statuses: ['Compliant', 'Expiring', 'Non-Compliant'],
    fields: [
      field('trade_type', 'Trade'),
      field('wcb_account_number', 'WCB Account #'),
      field('liability_expiry', 'Liability Insurance Expiry', 'date'),
      field('wcb_clearance_expiry', 'WCB Clearance Expiry', 'date'),
      field('safety_cert_verified', 'COR / Safety Cert Verified', 'boolean'),
      field('contact_person', 'Contact'),
    ],
    read: FOREMAN, write: PM, remove: PM,
    aliases: { companyName: 'title' },
  },
  {
    slug: 'employees', table: 'employees', label: 'Employees', group: 'Resources',
    description: 'Staff with trade, ticket and contact details.',
    titleLabel: 'Name', titlePlaceholder: 'e.g. Tessa Nguyen', recordLabel: 'Employee',
    statuses: ['Active', 'On Leave', 'Terminated'],
    fields: [
      field('trade', 'Trade', 'select', { options: ['Journeyperson Electrician', 'Apprentice', 'Instrumentation', 'Foreman', 'Labourer', 'Office'] }),
      field('phone', 'Phone', 'tel'),
      field('email', 'Email', 'email'),
      field('ticket_expiry', 'Tickets Expire', 'date'),
      field('hourly_cost', 'Hourly Cost ($/hr)', 'money', { min: 0 }),
    ],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'hiring', table: 'hiring', label: 'Hiring', group: 'Resources',
    description: 'Open positions and candidates.',
    titleLabel: 'Candidate / Position', titlePlaceholder: 'e.g. 4th-year apprentice — Saskatoon', recordLabel: 'Candidate',
    statuses: ['Applied', 'Interview', 'Offer', 'Hired', 'Declined'],
    fields: [field('position', 'Position'), field('phone', 'Phone', 'tel'), field('email', 'Email', 'email')],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'equipment', table: 'equipment', label: 'Owned Equipment', group: 'Resources',
    description: 'Company-owned equipment and where it is.',
    titleLabel: 'Equipment', titlePlaceholder: 'e.g. Cable puller #2',
    statuses: ['In Yard', 'On Site', 'In Repair', 'Retired'],
    fields: [field('asset_tag', 'Asset Tag'), field('location', 'Location'), field('serial_number', 'Serial #')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'equipment-rentals', table: 'equipment_rentals', label: 'Equipment Rentals', group: 'Resources',
    description: 'Rented lifts and machinery with rates and off-rent dates.',
    titleLabel: 'Rental', titlePlaceholder: 'e.g. 60 ft boom lift',
    statuses: ['On Rent', 'Called Off', 'Returned'],
    fields: [projectLink(), field('supplier', 'Supplier'), field('daily_rate', 'Daily Rate', 'money'), field('off_rent_date', 'Off-Rent Date', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'fleet', table: 'fleet', label: 'Fleet', group: 'Resources',
    description: 'Trucks and trailers with mileage and service status.',
    titleLabel: 'Vehicle', titlePlaceholder: 'e.g. 2023 F-350 service truck',
    statuses: ['Operational', 'Service Due', 'Out of Service'],
    fields: [field('unit_number', 'Unit #'), field('plate', 'Plate'), field('mileage', 'Odometer (km)', 'number'), field('next_service_date', 'Next Service Date', 'date'), field('next_service_km', 'Next Service (km)', 'number', { min: 0 })],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'maintenance', table: 'maintenance', label: 'Maintenance', group: 'Resources',
    description: 'Service work on vehicles, tools and equipment.',
    titleLabel: 'Work Order', titlePlaceholder: 'e.g. Oil change — unit 14',
    statuses: ['Scheduled', 'In Progress', 'Complete'],
    fields: [field('asset', 'Asset'), field('due_date', 'Due', 'date'), field('cost', 'Cost', 'money')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'warehouse-inventory', table: 'warehouse_inventory', label: 'Warehouse', group: 'Resources',
    description: 'Stock on hand by SKU.',
    titleLabel: 'Item', titlePlaceholder: 'e.g. 3/4" EMT connector', recordLabel: 'Stock Item',
    statuses: ['In Stock', 'Low', 'Out of Stock'],
    // Worked out from the quantity when it's saved. See warehouse_stock_status.
    systemStatuses: ['Low', 'Out of Stock'],
    fields: [field('sku', 'SKU'), field('quantity', 'Quantity', 'number'), field('bin', 'Bin'), field('reorder_point', 'Reorder Point', 'number', { min: 0 })],
    read: CREW, write: FOREMAN, remove: PM,
  },
];

/** Old page URLs kept working by redirecting to the module that replaced them. */
export const MODULE_REDIRECTS: Record<string, string> = {
  customers: 'crm',
  rfi: 'rfis',
  purchasing: 'purchase-orders',
  inventory: 'warehouse-inventory',
  vehicles: 'fleet',
  'asset-tracking': 'equipment',
};

export const MODULE_GROUPS: ModuleGroup[] = ['Field', 'Estimating & Sales', 'Project Controls', 'Finance', 'Resources'];

const bySlug = new Map(MODULES.map((m) => [m.slug, m]));

export function getModule(slug: string): ModuleDef | undefined {
  return bySlug.get(slug);
}

/** Statuses a person can choose. The first one is what a new record starts as. */
export function pickableStatuses(mod: ModuleDef): string[] {
  return mod.statuses.filter((s) => !mod.systemStatuses?.includes(s));
}

/** The table a field links to, or null if it isn't a link. */
export function linkTarget(def: FieldDef): string | null {
  if (def.type === 'project') return 'projects';
  if (def.type === 'client') return 'crm';
  return def.references ?? null;
}
