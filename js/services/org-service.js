// Organisation structure, worked out from each employee's reportingManagerID.
// Nothing is stored: the tree is rebuilt from the employee records every time, so it can never disagree with them.
import { ORG_ROLES } from '../core/reference-data.js';

const levelOf = (role) => ORG_ROLES.find((r) => r.code === role)?.level ?? 99;

/** People at the same level are listed by role level, then department, then name. */
export function compareStaff(a, b) {
  return levelOf(a.role) - levelOf(b.role) || String(a.department).localeCompare(String(b.department)) || String(a.employeeName).localeCompare(String(b.employeeName));
}

/**
 * @returns {{ roots: object[], children: Map<string, object[]>, byId: Map<string, object> }}
 * Someone whose manager is missing from the list (or who has none) becomes a root.
 */
export function buildOrg(employees) {
  const byId = new Map(employees.map((e) => [e.employeeID, e]));
  const children = new Map();
  const roots = [];
  for (const e of employees) {
    const manager = e.reportingManagerID && e.reportingManagerID !== e.employeeID ? byId.get(e.reportingManagerID) : null;
    if (manager) children.set(manager.employeeID, [...(children.get(manager.employeeID) || []), e]);
    else roots.push(e);
  }
  roots.sort(compareStaff);
  for (const list of children.values()) list.sort(compareStaff);
  return { roots, children, byId };
}

/** Everyone below this person (not including them). Safe even if the data had a loop. */
export function descendantsOf(org, employeeID) {
  const out = [];
  const seen = new Set([employeeID]);
  const walk = (id) => {
    for (const c of org.children.get(id) || []) {
      if (seen.has(c.employeeID)) continue;
      seen.add(c.employeeID);
      out.push(c);
      walk(c.employeeID);
    }
  };
  walk(employeeID);
  return out;
}

/** Managers above this person, nearest first. */
export function ancestorsOf(org, employeeID) {
  const out = [];
  const seen = new Set([employeeID]);
  let cursor = org.byId.get(org.byId.get(employeeID)?.reportingManagerID);
  while (cursor && !seen.has(cursor.employeeID)) {
    out.push(cursor);
    seen.add(cursor.employeeID);
    cursor = org.byId.get(cursor.reportingManagerID);
  }
  return out;
}
