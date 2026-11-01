-- ============================================================================
-- TRADEQUOTE PRO - MULTI-TENANT ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures data isolation between contractor organizations
-- ============================================================================

-- Enable RLS on core tables
ALTER TABLE crm ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_costing ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE timecards ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's organization_id from auth.users metadata
CREATE OR REPLACE FUNCTION auth.user_org_id() 
RETURNS UUID AS $$
BEGIN
  SELECT (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create generic isolation policy template for tenant tables
CREATE POLICY tenant_isolation_crm ON crm 
    FOR ALL USING (organization_id = auth.user_org_id());

CREATE POLICY tenant_isolation_estimates ON estimates 
    FOR ALL USING (organization_id = auth.user_org_id());

CREATE POLICY tenant_isolation_proposals ON proposals 
    FOR ALL USING (organization_id = auth.user_org_id());

CREATE POLICY tenant_isolation_job_costing ON job_costing 
    FOR ALL USING (organization_id = auth.user_org_id());

CREATE POLICY tenant_isolation_safety_logs ON safety_logs 
    FOR ALL USING (organization_id = auth.user_org_id());

CREATE POLICY tenant_isolation_timecards ON timecards 
    FOR ALL USING (organization_id = auth.user_org_id());