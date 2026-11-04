// One definition of "available", used by every page so the numbers can never disagree.
// An employee is available only if they are Active, marked Available, and have no active assignment.

export function availabilityOf(emp) {
  if (emp.status !== 'Active') return { available: false, reason: `Employee status is ${emp.status}.` };
  if (emp.activeAssignmentID) return { available: false, reason: 'Currently assigned to a deployment.' };
  if (emp.deploymentStatus !== 'Available') return { available: false, reason: `Deployment status is ${emp.deploymentStatus}.` };
  return { available: true, reason: '' };
}
