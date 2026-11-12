-- Add automated alert rule for proposals answered via proposal_shares in the last 7 days
INSERT INTO automation_rules (rule_key, severity, title_template, message_template, target_roles, link_template, active)
VALUES (
    'proposal_answered',
    'info',
    'Proposal Answered by Client',
    'A client has submitted an answer on proposal {proposal_title} within the last 7 days.',
    ARRAY['project_manager', 'admin', 'owner'],
    '/proposals/{proposal_id}',
    true
)
ON CONFLICT (rule_key) DO UPDATE SET
    severity = EXCLUDED.severity,
    title_template = EXCLUDED.title_template,
    message_template = EXCLUDED.message_template,
    target_roles = EXCLUDED.target_roles,
    link_template = EXCLUDED.link_template,
    active = EXCLUDED.active;
