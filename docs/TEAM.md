# Team sharing

The SECI RTC tender tab lets the tender's team share one saved bid. Anyone on the team can assign
any data point to a team or a person. The assignee answers with a value, a note or a file, and the
tender's super admin accepts the answer into the bid or returns it.

## The team

| Team | Usually answers |
| --- | --- |
| Tender management (the super admin) | Manages the tender, assigns, accepts or returns answers, manages the team |
| Finance | Financing inputs; signed copies of the formats |
| Procurement | Costs of each item (solar, wind and battery capex and O&M) |
| Legal | Readings of tender conditions and clauses |
| Technical | Anything else technical |

**Demo deployments** (`DEMO_MODE=1`, no sign-in):

* The team starts with one seat per team, without email: the tender manager (super admin) and the
  finance, procurement, legal and technical desks.
* "View as" in the Team panel switches between the seats (a cookie), so each role can be shown on
  one screen.
* Add email addresses on the Team tab to have people notified.

**With sign-in**, each person acts as the team member linked to their account (or with their
email). An administrator who is not on the team yet is added as a super admin. Others are added by
a super admin on the Team tab.

## What can be assigned

Each data point has an **Assign** button beside it.

| Data point | Where | Default team | The answer |
| --- | --- | --- | --- |
| A particular (bidder, signatory, net worth, …) | Bid forms → Particulars | Tender management | A value |
| A blank of a format | Bid forms → a format, blanks view | Tender management | A value |
| A format to sign | Bid forms → a format, top | Finance | The signed copy (PDF or image) |
| A source's cost | Supply sources → Costs | Procurement | A figure in the field's unit |
| A financing input | Supply sources → Financing | Finance | A figure (percentages in %) |
| A tender condition | Bid conditions | Legal | A clarification, with an optional file |

## The flow

1. **Save the bid** to the library. Assignments belong to a saved bid, so the whole team works on
   the same one.
2. **Assign.** Click Assign beside a data point. Pick the team (the usual one is preselected), a
   person or anyone in the team, what is needed, and a due date. The data point then shows its
   status: assigned, answer to accept, returned or accepted.
3. **Answer.** The assignee opens the **Team** panel (a count shows what is waiting). Under *For
   you*:
   * for a value or a cost, the bid's current value is prefilled; change it and add a note;
   * for a format, download the filled letter (PDF or Word), print, sign and upload the signed copy;
   * for a condition, write the reading and attach the basis if needed.
4. **Accept or return.** The super admin sees *Answered: to accept*.
   * **Accept** writes the answer into the bid and saves it as a new version of the saved bid, with
     the note "Accepted from <person>: <data point>".
   * A cost or financing input clears the sizing, as typing it would; size again.
   * A signed copy shows on its format. A clarification shows under its condition ("Our reading").
   * **Return** sends it back with a note, and the assignee answers again.
5. Every step (created, answered, accepted, returned, reassigned, cancelled, comments, emails sent)
   is kept in the assignment's **History**.

## Email

People are emailed when work is assigned to them (or to their team), when an answer is waiting for
the super admin, and when their answer is accepted or returned. Email is off unless SMTP is set in
`.env`:

| Variable | |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD` | The mail server (Google Workspace, Amazon SES, Office 365 SMTP relay, …) |
| `SMTP_SECURE=1` | For port 465 |
| `MAIL_FROM` | The sender, for example `TenderOS <tenders@yourcompany.com>` |
| `APP_URL` | The address people open TenderOS at; each mail links to the bid and opens the Team panel |

Then rebuild or restart the web service.

* **The Outbox.** Every email is kept in the Team panel's **Outbox** tab (`team_outbox`,
  migration 009): to, subject, the full text, and whether it was sent. Each mail sent, and each
  failure with its reason, is also in the assignment's history.
* **Demo mode.** On a demo deployment without SMTP, the emails are written exactly as they would be
  sent and kept in the Outbox as "Demo outbox", not sent. The demo seats have fictional
  `@arkaja-renewables.example` addresses (`.example` is never delivered).
* **Neither.** On a signed-in deployment without SMTP, email is off and people see their work in the
  panel.

## Files

* Uploads are PDF, PNG, JPEG, Word or Excel files of up to 25 MB.
* The file's first bytes must match its type.
* They are stored on the server under `FILES_DIR`. On the VM this is the `team_files` Docker
  volume at `/data/files`.
* Each file is named by its id. The database (`team_files`) keeps its name, type, size and
  SHA-256.
* `deploy/backup.sh` archives them beside the database dump (`backups/tenderos-files-*.tar.gz`).
* Anyone on the team can download them.

## How it is built

| Part | Where |
| --- | --- |
| Tables: `team_members`, `assignments`, `assignment_events`, `team_files` | `web/db/migrations/008_team.sql` |
| Who is acting, members, assignments and their rules, emails | `web/lib/team.js`, `web/lib/mail.js` (nodemailer), `web/lib/files.js` |
| API | `GET /api/team`, `POST /api/team/members`, `PATCH /api/team/members/[id]`, `POST /api/team/act-as` (demo only), `GET/POST /api/team/assignments`, `POST /api/team/assignments/[id]` (submit, accept, return, cancel, comment, reassign; multipart with a file), `GET /api/team/files/[id]` |
| Browser | `web/src/team/` (`useTeam.js`, `AssignButton.jsx`, `TeamPanel.jsx`, `apply.js`: where each kind of data point lives in the bid and how an accepted answer is written) |

**Rules (server):**

* Only a super admin manages the team, accepts, returns, reassigns or cancels.
* Only the assignee, or anyone in the assigned team when no person is named, answers. A super
  admin can also answer.
* A data point has one live assignment at a time.
* A signed copy needs its file.
* A return needs a note.

**Tests:**

* `node tools/check_team.mjs` (in `make check-web`): applying answers of every kind.
* `tests/e2e/test_team.py` (in `make e2e`, demo mode): assign three data points to three teams,
  answer each from its seat, accept two, return one and accept it re-answered. The test checks the
  value, the signed copy and the reading in the bid, and the file downloaded byte for byte.

## Not yet

* The team is for the SECI RTC tender tab only; the other tabs have no Assign buttons yet.
* There is one team for the whole server, not one per tender.
* Assignments are per saved bid; a bid that is not saved cannot be shared.
* There are no reminders before a due date.
* No e-signature: the signed copy is a scan of the paper the signatory signed.
