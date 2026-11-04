// The single source of truth for every TradeQuote PRO module: its table, its
// fields, its statuses and who may read, write and delete it. The API, the
// shared module page and the database migration (checked by tests) all follow it.

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'boolean' | 'email' | 'tel' | 'project' | 'client' | 'uuid';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /** Owned by the system (a trigger or RPC): parseRecord strips it and forms show it read-only. */
  computed?: boolean;
  /** Left out of the generic form and list. The API still accepts it unless it is also computed. */
  hidden?: boolean;
  /** For a 'uuid' field: the table it points to. 'project' and 'client' fields imply theirs. */
  references?: string;
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
  /** Statuses only the system sets. Stay in `statuses` so lists can filter by them; users cannot pick them by hand. */
  systemStatuses?: string[];
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

// Real links to the record they name. The free-text client_name and project_name
// fields stay so older records and the print pages keep their wording.
const projectField = field('project_id', 'Project', 'project');
const clientField = field('client_id', 'Client', 'client');

export const MODULES: ModuleDef[] = [
  // Field
  {
    slug: 'daily-logs', table: 'daily_logs', label: 'Daily Logs', group: 'Field',
    description: 'End-of-shift site reports: crew, weather, work done and delays.',
    titleLabel: 'Log Title', titlePlaceholder: 'e.g. Unit 3 MCC tie-in, day 2', recordLabel: 'Daily Log',
    statuses: ['Draft', 'Submitted', 'Reviewed'],
    fields: [
      projectField,
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
    titleLabel: 'Entry', titlePlaceholder: 'e.g. Cable tray blocked at grid C-4',
    statuses: ['Logged', 'Actioned', 'Closed'],
    fields: [projectField, field('location', 'Location'), field('author', 'Author')],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'timecards', table: 'timecards', label: 'Timecards', group: 'Field',
    description: 'Hours by worker and job, with regular and overtime split.',
    titleLabel: 'Job / Cost Code', titlePlaceholder: 'e.g. 24-118 Canola Plant — Labour', recordLabel: 'Timecard',
    statuses: ['Submitted', 'Approved', 'Rejected', 'Exported'],
    fields: [
      projectField,
      field('employee_name', 'Employee', 'text', { required: true }),
      field('work_date', 'Date', 'date'),
      field('regular_hours', 'Regular Hours', 'number'),
      field('overtime_hours', 'Overtime Hours', 'number'),
    ],
    read: CREW, write: CREW, remove: PM, ownRowsBelow: PM,
    aliases: { name: 'title' },
  },
  {
    slug: 'crew-schedule', table: 'crew_schedule', label: 'Crew Schedule', group: 'Field',
    description: 'Who is on which site, which shift.',
    titleLabel: 'Crew / Worker', titlePlaceholder: 'e.g. Crew A — Mike, Raj, Tessa', recordLabel: 'Schedule Entry',
    statuses: ['Scheduled', 'On Site', 'Complete', 'Cancelled'],
    fields: [projectField, field('shift', 'Shift', 'select', { options: ['Days', 'Nights', 'Swing'] }), field('location', 'Site'), field('start_date', 'Start', 'date'), field('end_date', 'End', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'tailgate-logs', table: 'tailgate_logs', label: 'Tailgate Meetings', group: 'Field',
    description: 'Toolbox talks and FLHAs with topic and attendance.',
    titleLabel: 'Meeting', titlePlaceholder: 'e.g. Morning FLHA — energized work near MCC',
    statuses: ['Completed', 'Needs Sign-off'],
    fields: [projectField, field('topic', 'Topic'), field('attendees_count', 'Attendees', 'number'), field('meeting_date', 'Date', 'date')],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'safety-logs', table: 'safety_logs', label: 'Safety Logs', group: 'Field',
    description: 'Incidents, near misses and hazards, with severity and follow-up.',
    titleLabel: 'Incident', titlePlaceholder: 'e.g. Near miss — dropped conduit from lift',
    statuses: ['Open', 'Under Investigation', 'Resolved'],
    fields: [
      projectField,
      field('incident_type', 'Type', 'select', { options: ['Near Miss', 'First Aid', 'Medical Aid', 'Lost Time', 'Property Damage', 'Hazard'] }),
      field('severity', 'Severity', 'select', { options: ['Low', 'Medium', 'High', 'Critical'] }),
      field('incident_date', 'Date', 'date'),
    ],
    read: CREW, write: CREW, remove: ADMIN,
  },
  {
    slug: 'loto-permits', table: 'loto_permits', label: 'LOTO Permits', group: 'Field',
    description: 'Lockout/tagout permits: equipment isolated, by whom, and when released.',
    titleLabel: 'Permit', titlePlaceholder: 'e.g. LOTO-0412 Conveyor 7 drive',
    statuses: ['Locked Out', 'Verified Zero Energy', 'Released'],
    fields: [projectField, field('equipment_isolated', 'Equipment Isolated', 'text', { required: true }), field('authorized_person', 'Authorized Person', 'text', { required: true }), field('lock_number', 'Lock #')],
    read: CREW, write: CREW, remove: ADMIN,
  },
  {
    slug: 'inspections', table: 'inspections', label: 'Inspections', group: 'Field',
    description: 'Electrical, safety and authority inspections with outcome.',
    titleLabel: 'Inspection', titlePlaceholder: 'e.g. Rough-in inspection — Level 2',
    statuses: ['Scheduled', 'Passed', 'Failed', 'Re-inspect'],
    fields: [projectField, field('inspector', 'Inspector'), field('inspection_date', 'Date', 'date'), field('permit_number', 'Permit #')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'punch-list', table: 'punch_list', label: 'Punch List', group: 'Field',
    description: 'Deficiencies to close out before turnover.',
    titleLabel: 'Item', titlePlaceholder: 'e.g. Missing cover plate, room 204',
    statuses: ['Open', 'In Progress', 'Ready for Review', 'Closed'],
    fields: [
      projectField,
      field('project_name', 'Project Name (if not listed)'),
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
      projectField,
      clientField,
      field('client_name', 'Client Name (if not listed)'),
      field('client_address', 'Client / Site Address'),
      field('bid_due', 'Bid Due', 'date'),
      field('labour_rate', 'Labour Rate ($/hr)', 'money'),
      field('markup_percentage', 'Markup %', 'number'),
      field('tax_percentage', 'Tax %', 'number'),
      field('total_amount', 'Total', 'money'),
      field('scope', 'Scope of Work', 'textarea'),
      field('terms', 'Terms', 'textarea'),
    ],
    read: PM, write: PM, remove: PM,
    aliases: { projectName: 'title', project_name: 'title' },
  },
  {
    slug: 'proposals', table: 'proposals', label: 'Proposals', group: 'Estimating & Sales',
    description: 'Client-facing proposals with scope, terms and price.',
    titleLabel: 'Proposal', titlePlaceholder: 'e.g. Unit 3 MCC Replacement — Proposal',
    statuses: ['Draft', 'Sent', 'Accepted', 'Declined'],
    fields: [
      projectField,
      clientField,
      field('client_name', 'Client Name (if not listed)'),
      field('total_amount', 'Total', 'money'),
      field('valid_until', 'Prices Valid Until', 'date'),
      field('scope_of_work', 'Scope of Work', 'textarea'),
      field('terms', 'Terms', 'textarea'),
    ],
    read: PM, write: PM, remove: PM,
    aliases: { proposalTitle: 'title', proposal_title: 'title' },
  },
  {
    slug: 'rfq', table: 'rfq', label: 'RFQs to Suppliers', group: 'Estimating & Sales',
    description: 'Material and equipment quote requests sent to suppliers.',
    titleLabel: 'Request', titlePlaceholder: 'e.g. 2000A switchboard pricing',
    statuses: ['Draft', 'Sent', 'Quoted', 'Awarded', 'Closed'],
    fields: [field('vendor', 'Supplier'), field('deadline', 'Quote Due', 'date'), field('quoted_amount', 'Quoted Amount', 'money')],
    read: FOREMAN, write: PM, remove: PM,
  },
  {
    slug: 'rfp', table: 'rfp', label: 'Bid Opportunities', group: 'Estimating & Sales',
    description: 'RFPs and tenders you are tracking or bidding.',
    titleLabel: 'Opportunity', titlePlaceholder: 'e.g. City of Regina substation upgrade',
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
    fields: [clientField, field('client_name', 'Client Name (if not listed)'), field('site', 'Site'), field('start_date', 'Start', 'date'), field('end_date', 'End', 'date'), field('contract_value', 'Contract Value', 'money')],
    read: CREW, write: PM, remove: ADMIN,
  },
  {
    slug: 'rfis', table: 'rfis', label: 'RFIs', group: 'Project Controls',
    description: 'Questions to the engineer or owner, and their answers.',
    titleLabel: 'Question', titlePlaceholder: 'e.g. Confirm feeder size to MCC-3', recordLabel: 'RFI',
    statuses: ['Open', 'Answered', 'Closed'],
    fields: [projectField, field('rfi_number', 'RFI #'), field('assignee', 'Directed To'), field('due_date', 'Response Due', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'change-orders', table: 'change_orders', label: 'Change Orders', group: 'Project Controls',
    description: 'Scope changes with cost impact and approval status.',
    titleLabel: 'Change', titlePlaceholder: 'e.g. Add 2 VFDs to conveyor line', recordLabel: 'Change Order',
    statuses: ['Pending Approval', 'Approved', 'Rejected', 'Invoiced'],
    fields: [projectField, field('project_name', 'Project Name (if not listed)'), field('cost_impact', 'Cost Impact', 'money'), field('days_impact', 'Schedule Impact (days)', 'number')],
    read: FOREMAN, write: PM, remove: PM,
  },
  {
    slug: 'submittals', table: 'submittals', label: 'Submittals', group: 'Project Controls',
    description: 'Shop drawings and product data sent for review.',
    titleLabel: 'Submittal', titlePlaceholder: 'e.g. Lighting fixture schedule',
    statuses: ['Pending Review', 'Approved', 'Approved as Noted', 'Revise & Resubmit'],
    fields: [projectField, field('submittal_number', 'Submittal #'), field('spec_section', 'Spec Section')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'drawings', table: 'drawings', label: 'Drawings', group: 'Project Controls',
    description: 'Drawing register with the current revision of each sheet.',
    titleLabel: 'Sheet Title', titlePlaceholder: 'e.g. Single Line Diagram', recordLabel: 'Drawing',
    statuses: ['Issued for Construction', 'Superseded', 'For Review'],
    fields: [projectField, field('drawing_number', 'Drawing #'), field('revision', 'Revision'), field('issued_date', 'Issued', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'documents', table: 'documents', label: 'Documents', group: 'Project Controls',
    description: 'Specs, manuals and procedures with version.',
    titleLabel: 'Document', titlePlaceholder: 'e.g. Site safety plan',
    statuses: ['Active', 'Draft', 'Archived'],
    fields: [projectField, field('category', 'Category'), field('version', 'Version')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'site-vault', table: 'site_vault', label: 'Site Vault', group: 'Project Controls',
    description: 'Restricted documents: contracts, access lists, client confidential.',
    titleLabel: 'Item', titlePlaceholder: 'e.g. Plant access card list',
    statuses: ['Secure', 'Expired'],
    fields: [field('document_type', 'Type'), field('confidentiality', 'Confidentiality', 'select', { options: ['Restricted', 'Confidential', 'Internal'] }), field('expiry_date', 'Expiry', 'date')],
    read: PM, write: PM, remove: ADMIN,
  },
  {
    slug: 'commissioning', table: 'commissioning', label: 'Commissioning', group: 'Project Controls',
    description: 'Pre-functional and functional checks by system and tag.',
    titleLabel: 'Check', titlePlaceholder: 'e.g. MCC-3 functional test',
    statuses: ['Not Started', 'In Progress', 'Passed', 'Failed'],
    fields: [projectField, field('equipment_tag', 'Equipment Tag'), field('system_type', 'System')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'cable-testing', table: 'cable_testing', label: 'Cable Testing', group: 'Project Controls',
    description: 'Megger and continuity results by cable tag.',
    titleLabel: 'Test', titlePlaceholder: 'e.g. Feeder F-12 IR test',
    statuses: ['Pass', 'Fail', 'Retest'],
    fields: [projectField, field('cable_tag', 'Cable Tag'), field('test_voltage', 'Test Voltage'), field('reading', 'Reading (MΩ)')],
    read: CREW, write: CREW, remove: PM,
  },
  {
    slug: 'quality-control', table: 'quality_control', label: 'Quality Control', group: 'Project Controls',
    description: 'QC checklists and hold points.',
    titleLabel: 'Check', titlePlaceholder: 'e.g. Termination torque check — panel LP-2',
    statuses: ['Open', 'Passed', 'Failed'],
    fields: [projectField, field('checked_by', 'Checked By'), field('check_date', 'Date', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'non-conformance', table: 'non_conformance', label: 'Non-Conformance', group: 'Project Controls',
    description: 'Work or material that does not meet spec, and its disposition.',
    titleLabel: 'Issue', titlePlaceholder: 'e.g. Wrong cable type pulled to MCC-2',
    statuses: ['Open', 'Disposition Pending', 'Closed'],
    fields: [projectField, field('disposition', 'Disposition', 'select', { options: ['Rework', 'Repair', 'Use As Is', 'Reject'] }), field('raised_by', 'Raised By')],
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
    titleLabel: 'Item', titlePlaceholder: 'e.g. MCC-4 breaker warranty',
    statuses: ['Active', 'Expiring', 'Expired', 'Claimed'],
    fields: [field('equipment_tag', 'Equipment Tag'), field('expiry_date', 'Expiry', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'tasks', table: 'tasks', label: 'Tasks', group: 'Project Controls',
    description: 'To-dos assigned to people, with due dates.',
    titleLabel: 'Task', titlePlaceholder: 'e.g. Order breakers for panel LP-3',
    statuses: ['To Do', 'In Progress', 'Done'],
    fields: [projectField, field('assigned_to', 'Assigned To'), field('due_date', 'Due', 'date')],
    read: CREW, write: CREW, remove: FOREMAN,
  },

  // Finance
  {
    slug: 'job-costing', table: 'job_costing', label: 'Job Costing', group: 'Finance',
    description: 'Budget against actual cost by job.',
    titleLabel: 'Job', titlePlaceholder: 'e.g. 24-118 Canola Plant Shutdown',
    statuses: ['On Track', 'At Risk', 'Over Budget', 'Closed'],
    fields: [projectField, field('budget', 'Budget', 'money'), field('actual_cost', 'Actual Cost', 'money')],
    read: PM, write: PM, remove: ADMIN,
  },
  {
    slug: 'progress-billing', table: 'progress_billing', label: 'Progress Billing', group: 'Finance',
    description: 'Monthly progress draws with holdback.',
    titleLabel: 'Draw', titlePlaceholder: 'e.g. Draw #4 — October',
    statuses: ['Draft', 'Invoiced', 'Paid'],
    fields: [projectField, field('billing_period', 'Period'), field('amount_billed', 'Amount Billed', 'money'), field('holdback_percent', 'Holdback %', 'number'), field('holdback_release_date', 'Holdback Release Date', 'date')],
    read: PM, write: PM, remove: ADMIN,
  },
  {
    slug: 'invoices', table: 'invoices', label: 'Invoices', group: 'Finance',
    description: 'Invoices issued to clients.',
    titleLabel: 'Invoice', titlePlaceholder: 'e.g. INV-2026-0412',
    statuses: ['Draft', 'Sent', 'Paid', 'Overdue', 'Void'],
    fields: [projectField, clientField, field('client_name', 'Client Name (if not listed)'), field('amount', 'Amount', 'money'), field('gst', 'GST', 'money'), field('due_date', 'Due', 'date')],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'receivables', table: 'receivables', label: 'Receivables', group: 'Finance',
    description: 'Money owed to you, by client and age.',
    titleLabel: 'Receivable', titlePlaceholder: 'e.g. Cargill — Draw #3',
    statuses: ['Current', '30 Days', '60 Days', '90+ Days', 'Collected'],
    fields: [projectField, field('client_name', 'Client'), field('amount', 'Amount', 'money'), field('due_date', 'Due', 'date')],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'payables', table: 'payables', label: 'Payables', group: 'Finance',
    description: 'Supplier and subcontractor bills to pay.',
    titleLabel: 'Bill', titlePlaceholder: 'e.g. Westburne invoice 88123',
    statuses: ['To Approve', 'Approved', 'Paid'],
    fields: [projectField, field('vendor', 'Vendor'), field('amount', 'Amount', 'money'), field('due_date', 'Due', 'date'), field('purchase_order_id', 'Purchase Order', 'uuid', { hidden: true, references: 'purchase_orders' })],
    read: ADMIN, write: ADMIN, remove: ADMIN,
  },
  {
    slug: 'purchase-orders', table: 'purchase_orders', label: 'Purchase Orders', group: 'Finance',
    description: 'POs to suppliers by job.',
    titleLabel: 'PO', titlePlaceholder: 'e.g. PO-1043 — 600 m 4/0 Teck',
    statuses: ['Draft', 'Issued', 'Partially Received', 'Received', 'Closed'],
    fields: [projectField, field('vendor', 'Supplier'), field('project_name', 'Project Name (if not listed)'), field('amount', 'Amount', 'money'), field('required_date', 'Required On Site', 'date')],
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
      field('safety_cert_verified', 'COR / Safety Cert Verified', 'boolean'),
      field('contact_person', 'Contact'),
      field('wcb_clearance_expiry', 'WCB Clearance Expiry', 'date'),
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
      field('hourly_cost', 'Hourly Cost ($/hr)', 'money'),
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
    fields: [projectField, field('supplier', 'Supplier'), field('daily_rate', 'Daily Rate', 'money'), field('off_rent_date', 'Off-Rent Date', 'date')],
    read: CREW, write: FOREMAN, remove: PM,
  },
  {
    slug: 'fleet', table: 'fleet', label: 'Fleet', group: 'Resources',
    description: 'Trucks and trailers with mileage and service status.',
    titleLabel: 'Vehicle', titlePlaceholder: 'e.g. 2023 F-350 service truck',
    statuses: ['Operational', 'Service Due', 'Out of Service'],
    fields: [field('unit_number', 'Unit #'), field('plate', 'Plate'), field('mileage', 'Odometer (km)', 'number'), field('next_service_date', 'Next Service Date', 'date'), field('next_service_km', 'Next Service (km)', 'number')],
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
    titleLabel: 'Item', titlePlaceholder: 'e.g. 3/4" EMT connector',
    statuses: ['In Stock', 'Low', 'Out of Stock'],
    fields: [field('sku', 'SKU'), field('quantity', 'Quantity', 'number'), field('bin', 'Bin'), field('reorder_point', 'Reorder Point', 'number')],
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

/** The table a field links to, or undefined for a plain field. */
export function referenceTable(def: FieldDef): string | undefined {
  if (def.type === 'project') return 'projects';
  if (def.type === 'client') return 'crm';
  return def.references;
}

/** Statuses a person can choose. System statuses are set by triggers and RPCs. */
export function manualStatuses(mod: ModuleDef): string[] {
  return mod.statuses.filter((s) => !mod.systemStatuses?.includes(s));
}

/** Fields a person fills in on the generic form. */
export function editableFields(mod: ModuleDef): FieldDef[] {
  return mod.fields.filter((f) => !f.computed && !f.hidden);
}

export interface TableColumn {
  key: string;
  label: string;
  type: FieldType;
  /** Reads the cell. Linked names win over the older typed text. */
  value: (row: Record<string, unknown>) => unknown;
}

const linkedTitle = (row: Record<string, unknown>, link: string) => (row[link] as { title?: string } | null | undefined)?.title;

/** Columns of the generic list: up to three plain fields, plus the project when the module links to one. */
export function tableColumns(mod: ModuleDef): TableColumn[] {
  const hasProject = mod.fields.some((f) => f.type === 'project');
  const hasClient = mod.fields.some((f) => f.type === 'client');
  const plain = mod.fields
    .filter((f) => f.type !== 'textarea' && !f.hidden && !referenceTable(f) && !(hasProject && f.key === 'project_name'))
    .slice(0, 3)
    .map((f): TableColumn =>
      hasClient && f.key === 'client_name'
        ? { key: f.key, label: 'Client', type: 'text', value: (row) => linkedTitle(row, 'client') ?? row.client_name }
        : { key: f.key, label: f.label, type: f.type, value: (row) => row[f.key] }
    );
  if (!hasProject) return plain;
  return [{ key: 'project_id', label: 'Project', type: 'text', value: (row) => linkedTitle(row, 'project') ?? row.project_name }, ...plain];
}
