-- Every email team sharing composes (lib/team.js notify): sent through SMTP, failed, or, on a demo
-- deployment without SMTP, kept here as the demo outbox. The Team panel's Outbox shows them.
CREATE TABLE IF NOT EXISTS team_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid REFERENCES assignments(id) ON DELETE CASCADE,
  scenario_id   uuid REFERENCES scenarios(id) ON DELETE CASCADE,
  to_name       text NOT NULL DEFAULT '',
  to_email      text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('sent', 'failed', 'demo')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_outbox_scenario_idx ON team_outbox (scenario_id, created_at DESC);
