-- Team sharing on a saved bid: the tender's team (a super admin and members of the finance,
-- procurement, legal and technical teams), work assigned on any data point of the bid, every step
-- of it, and the files people upload (signed copies). A member is a person on the tender, linked
-- to a sign-in account when there is one (demo deployments act as a member instead).

CREATE TABLE IF NOT EXISTS team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL DEFAULT '',
  team        text NOT NULL CHECK (team IN ('management', 'finance', 'procurement', 'legal', 'technical')),
  super_admin boolean NOT NULL DEFAULT false,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL,
  sha256       text NOT NULL,
  path         text NOT NULL,
  uploaded_by  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- target_kind: field (a particular or a format's blank), cost (a source's cost), finance (a
-- financing input), document (a format to be signed), condition (a tender condition or clause)
CREATE TABLE IF NOT EXISTS assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  target_kind  text NOT NULL CHECK (target_kind IN ('field', 'cost', 'finance', 'document', 'condition')),
  target_key   text NOT NULL,
  target_label text NOT NULL,
  context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  request      text NOT NULL DEFAULT '',
  team         text NOT NULL CHECK (team IN ('management', 'finance', 'procurement', 'legal', 'technical')),
  assignee_id  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_by   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  due_date     date,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'accepted', 'returned', 'cancelled')),
  answer       jsonb,
  file_id      uuid REFERENCES team_files(id) ON DELETE SET NULL,
  accepted_version integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignments_scenario_idx ON assignments (scenario_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS assignments_assignee_idx ON assignments (assignee_id, status);

CREATE TABLE IF NOT EXISTS assignment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  member_id     uuid REFERENCES team_members(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('created', 'submitted', 'accepted', 'returned', 'cancelled', 'reassigned', 'comment', 'emailed', 'email_failed')),
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_events_idx ON assignment_events (assignment_id, created_at);
