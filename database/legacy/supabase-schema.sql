-- ============================================================================
-- TRADEQUOTE PRO - MASTER SUPABASE DDL SCHEMA
-- Covers all 30 industrial modules with UUID primary keys and timestamps
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CRM Module
CREATE TABLE IF NOT EXISTS crm (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'Active Client',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Vendors Module
CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_name TEXT NOT NULL,
    category TEXT,
    contact_email TEXT,
    phone TEXT,
    rating TEXT DEFAULT 'Preferred Vendor',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Estimates Module
CREATE TABLE IF NOT EXISTS estimates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    client_name TEXT,
    total_amount NUMERIC(12,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Draft',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Proposals Module
CREATE TABLE IF NOT EXISTS proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_title TEXT NOT NULL,
    client_name TEXT,
    total_amount NUMERIC(12,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Job Costing Module
CREATE TABLE IF NOT EXISTS job_costing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name TEXT NOT NULL,
    budget NUMERIC(12,2) DEFAULT 0.00,
    actual_cost NUMERIC(12,2) DEFAULT 0.00,
    status TEXT DEFAULT 'On Track',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Daily Logs Module
CREATE TABLE IF NOT EXISTS daily_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    date DATE DEFAULT CURRENT_DATE,
    crew_lead TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Submitted',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Cable Testing Module
CREATE TABLE IF NOT EXISTS cable_testing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    cable_tag TEXT,
    test_voltage TEXT,
    result TEXT DEFAULT 'Pass',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Change Orders Module
CREATE TABLE IF NOT EXISTS change_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    project_name TEXT,
    cost_impact NUMERIC(12,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Pending Approval',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Commissioning Module
CREATE TABLE IF NOT EXISTS commissioning (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    equipment_tag TEXT,
    system_type TEXT,
    status TEXT DEFAULT 'In Progress',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Crew Schedule Module
CREATE TABLE IF NOT EXISTS crew_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    shift TEXT,
    location TEXT,
    status TEXT DEFAULT 'Scheduled',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Defect Liability Module
CREATE TABLE IF NOT EXISTS defect_liability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    facility TEXT,
    severity TEXT DEFAULT 'Minor',
    status TEXT DEFAULT 'Open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Documents Module
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    category TEXT,
    version TEXT DEFAULT '1.0',
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Drawings Module
CREATE TABLE IF NOT EXISTS drawings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    drawing_number TEXT,
    revision TEXT DEFAULT 'A',
    status_field TEXT DEFAULT Approved',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Equipment Rentals Module
CREATE TABLE IF NOT EXISTS equipment_rentals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    supplier TEXT,
    daily_rate NUMERIC(10,2) DEFAULT 0.00,
    status TEXT DEFAULT 'On Rent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Field Logs Module
CREATE TABLE IF NOT EXISTS field_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    location TEXT,
    author TEXT,
    status TEXT DEFAULT 'Logged',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Fleet Module
CREATE TABLE IF NOT EXISTS fleet (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    unit_number TEXT,
    mileage INTEGER DEFAULT 0,
    status TEXT DEFAULT 'Operational',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. LOTO Permits Module
CREATE TABLE IF NOT EXISTS loto_permits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    equipment_isolated TEXT,
    authorized_person TEXT,
    status TEXT DEFAULT 'Locked Out',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. Progress Billing Module
CREATE TABLE IF NOT EXISTS progress_billing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    billing_period TEXT,
    amount_billed NUMERIC(12,2) DEFAULT 0.00,
    status TEXT DEFAULT 'Invoiced',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. RFIs Module
CREATE TABLE IF NOT EXISTS rfis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    rfi_number TEXT,
    assignee TEXT,
    status TEXT DEFAULT 'Open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 20. RFQ Module
CREATE TABLE IF NOT EXISTS rfq (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    vendor TEXT,
    deadline DATE,
    status TEXT DEFAULT 'Sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. Safety Logs Module
CREATE TABLE IF NOT EXISTS safety_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    incident_type TEXT,
    severity TEXT DEFAULT 'Low',
    status TEXT DEFAULT 'Resolved',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. Site Vault Module
CREATE TABLE IF NOT EXISTS site_vault (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    document_type TEXT,
    confidentiality TEXT DEFAULT 'Restricted',
    status TEXT DEFAULT 'Secure',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 23. Submittals Module
CREATE TABLE IF NOT EXISTS submittals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    submittal_number TEXT,
    spec_section TEXT,
    status TEXT DEFAULT 'Pending Review',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 24. Tailgate Logs Module
CREATE TABLE IF NOT EXISTS tailgate_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    topic TEXT,
    attendees_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'Completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 25. Timecards Module
CREATE TABLE IF NOT EXISTS timecards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    employee_name TEXT,
    regular_hours NUMERIC(5,2) DEFAULT 8.0,
    overtime_hours NUMERIC(5,2) DEFAULT 0.0,
    status TEXT DEFAULT 'Submitted',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 26. Tool Crib Module
CREATE TABLE IF NOT EXISTS tool_crib (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    tool_number TEXT,
    assigned_to TEXT,
    status TEXT DEFAULT 'Checked Out',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 27. Warehouse Inventory Module
CREATE TABLE IF NOT EXISTS warehouse_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    sku TEXT,
    quantity INTEGER DEFAULT 0,
    status TEXT DEFAULT 'In Stock',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 28. Warranty Module
CREATE TABLE IF NOT EXISTS warranty (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    equipment_tag TEXT,
    expiry_date DATE,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);