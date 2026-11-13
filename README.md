# Serentica Site Manpower Management System (SMMS)

A browser-based system for Serentica Renewables India Pvt Ltd to track site manpower, raise and approve deployment and recall requests, see who is available, and report on headcount.

**Status:** working prototype. Data is stored in each user's own browser, so it is for demonstration and pilot use only.

## What it does

- **Employees:** register and search staff by site and department, with a profile page for each person.
- **Organisation:** sites, projects and departments used across the system.
- **Data Management:** import employees from Excel, with checks and an import history.
- **Deployments:** a Lead raises a request to move a person to another site or project. A Project Manager reviews, approves, rejects or returns it, and then confirms it.
- **Recalls:** the same flow for bringing a deployed person back to their base site.
- **Availability:** every employee is Available, Deployed or Unavailable, shown by site, department and project.
- **Activity:** notifications for the signed-in user, plus an audit history of who changed what and when.
- **Reports:** headcount, availability, request status and delays, each exportable to CSV.

## Roles

| Role | Can do |
|---|---|
| Admin | View everything. Read-only. |
| Lead | Raise deployment and recall requests for their site or department. |
| PM (Project Manager) | Review, approve, reject, return and confirm requests for their sites. |

Each person sees only the sites and records in their scope.

## Request workflow

Submitted → Under Review → Approved, Rejected or Returned → Confirmed

Approved is not the same as Confirmed: a person's site and project change only when the request is confirmed.

## Demo logins

| Role | Username | Password |
|---|---|---|
| Lead | lead.demo | Lead@123 |
| Project Manager | pm.demo | Manager@123 |
| Admin | admin.demo | Admin@123 |

These are demo accounts only. Do not reuse these passwords anywhere else.

## Build status

| Stage | Module | Status |
|---|---|---|
| 2 | Welcome and sign-in | Built |
| 4 | Employees | Built |
| 5 | Organisation | Built |
| 6 | Data Management (Excel import) | Built |
| 7 | Deployments | Built |
| 8 | Recalls | Built |
| 9 | Availability, Activity (notifications and audit history), Reports | Built |
| 10 | Performance | Not built |

## How it is built

- Plain HTML, CSS and JavaScript (ES modules). There is no build step and no framework.
- Data is stored in the browser with IndexedDB.
- Folder layout:
  - `*.html` in the root: one page per screen.
  - `js/core/`: store, access control, workflow rules, shared constants.
  - `js/services/`: business logic (employees, deployments, recalls, availability, reports, activity, audit).
  - `js/pages/`: the code behind each page.
  - `js/ui/`: small helpers for building page elements.
  - `css/`: design tokens and shared styles.
- Every change is checked against the user's role and site scope, and each change is written to the audit history.

## Running it

Open the GitHub Pages link for this repository, or run it locally. The pages use ES modules, so they must be served over http rather than opened as files:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Self-tests

Serve the folder as above and open a test page in the browser:
`svc2-test.html` (deployments and recalls), `svc3-test.html` (availability, reports, activity), `employee-test.html`, `seed-test.html`, `store-test.html`.
Each page prints "All good" when every check passes and removes the records it created.

## Known limits (prototype)

- Data lives in each browser, so two people do not see each other's changes.
- Sign-in is checked in the browser, so it is not production-secure.
- Notifications are simulated and appear only inside the app. No e-mail or SMS is sent.
- A production version would need a shared database and server-side sign-in.

## Roadmap

- Stage 10: Performance module.
- Shared database and proper authentication for multi-user use.
- Real e-mail notifications.

## Owner

Nandaja J N, Serentica Renewables India Pvt Ltd.
