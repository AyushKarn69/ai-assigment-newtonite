import { AppContainer } from './container';
import { WorkItemPriority, WorkItemStatus, WorkItemType } from './modules/work-items/work-item.entity';
import { UpdateWorkItemCommand } from './modules/work-items/work-item.service';
import { AuthenticatedUser, GlobalRole, TeamRole } from './shared/types/auth';

/** Shared password for every demo account (demo data only — never used outside SEED_DEMO_DATA). */
export const DEMO_PASSWORD = 'demo-password-123';

interface DemoPerson {
  key: string;
  name: string;
  email: string;
  admin?: boolean;
}

const PEOPLE: DemoPerson[] = [
  { key: 'ananya', name: 'Ananya Iyer', email: 'ananya@newtonite.test', admin: true },
  { key: 'rohan', name: 'Rohan Sharma', email: 'rohan@newtonite.test' },
  { key: 'vikram', name: 'Vikram Singh', email: 'vikram@newtonite.test' },
  { key: 'meera', name: 'Meera Krishnan', email: 'meera@newtonite.test' },
  { key: 'arjun', name: 'Arjun Patel', email: 'arjun@newtonite.test' },
  { key: 'priya', name: 'Priya Nair', email: 'priya@newtonite.test' },
];

const TEAMS: Array<{ key: string; name: string; description: string; manager: string; members: string[] }> = [
  { key: 'platform', name: 'Platform Engineering', description: 'Core platform, auth and edge', manager: 'rohan', members: ['vikram', 'meera', 'priya'] },
  { key: 'data', name: 'Data Streaming', description: 'Pipelines and ingestion', manager: 'vikram', members: ['priya', 'arjun'] },
  { key: 'infra', name: 'Core Infrastructure', description: 'Clusters, DNS, storage', manager: 'arjun', members: ['rohan'] },
  { key: 'billing', name: 'Logistics & Billing', description: 'Payments and invoicing', manager: 'meera', members: ['priya'] },
];

interface DemoItem {
  team: string;
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  by: string;
  assignee?: string;
  /** Statuses to walk through, in order. */
  path?: WorkItemStatus[];
  comments?: Array<[string, string]>;
}

const { OPEN, IN_PROGRESS, BLOCKED, IN_REVIEW, RESOLVED, CLOSED } = WorkItemStatus;
const { CRITICAL, HIGH, MEDIUM, LOW } = WorkItemPriority;

const ITEMS: DemoItem[] = [
  { team: 'platform', title: 'Authentication token vault out of sync', description: 'Vault node 02 reports stale leases; token refresh failing intermittently for the EU region.', type: WorkItemType.PRODUCTION_INCIDENT, priority: CRITICAL, by: 'vikram' },
  { team: 'platform', title: 'SSL wildcard auto-renewal webhook failed', description: 'The cert-manager webhook returned 500 during the last renewal window.', type: WorkItemType.ENGINEERING_PROBLEM, priority: HIGH, by: 'meera' },
  { team: 'platform', title: 'Postgres connection pool exhaustion on replica #4', description: 'Pool saturates at ~98% during batch jobs; checkout latency spikes.', type: WorkItemType.PRODUCTION_INCIDENT, priority: HIGH, by: 'priya', assignee: 'vikram', path: [IN_PROGRESS], comments: [['vikram', 'Raised max connections as a stop-gap; investigating the batch job fan-out.']] },
  { team: 'platform', title: 'Rotate TLS root ingress certs on edge proxy clusters', description: 'Automated cert-manager cron renewal validation for the edge gateway.', type: WorkItemType.APPROVAL_TASK, priority: LOW, by: 'rohan', assignee: 'meera' },
  { team: 'platform', title: 'Customer export times out for large tenants', description: 'Exports above 2M rows hit the 60s gateway timeout.', type: WorkItemType.CUSTOMER_ISSUE, priority: MEDIUM, by: 'meera', assignee: 'priya', path: [IN_PROGRESS, IN_REVIEW], comments: [['priya', 'Streaming the export in chunks; PR is up for review.'], ['rohan', 'Reviewed — one question on the retry behaviour.']] },
  { team: 'data', title: 'Kafka consumer lag spike above 450k msgs on analytics-pipeline', description: 'Partition 14 rebalance storm is causing high backpressure on the analytics consumers.', type: WorkItemType.ENGINEERING_PROBLEM, priority: CRITICAL, by: 'priya', assignee: 'vikram', path: [IN_PROGRESS, BLOCKED], comments: [['vikram', 'Upstream broker kafka-04 is out of disk space on partition 12. Paged SRE on-call for volume expansion.'], ['priya', 'Pausing the consumers until the disk is expanded.']] },
  { team: 'data', title: 'Re-index partitioned audit logging tables for Q3 compliance', description: 'Vacuum analyze on hypertable chunks older than 90 days.', type: WorkItemType.COMPLIANCE_REQUEST, priority: MEDIUM, by: 'vikram', assignee: 'arjun', path: [IN_PROGRESS] },
  { team: 'data', title: 'Schema registry compatibility check failing in CI', description: 'Backward-compatibility check rejects the new order-event schema.', type: WorkItemType.ENGINEERING_PROBLEM, priority: HIGH, by: 'arjun' },
  { team: 'infra', title: 'Redis cluster memory eviction policy upgrade', description: 'Switch cache nodes from volatile-lru to allkeys-lfu and double the sharded memory.', type: WorkItemType.ENGINEERING_PROBLEM, priority: MEDIUM, by: 'arjun', assignee: 'rohan', path: [IN_PROGRESS, IN_REVIEW] },
  { team: 'infra', title: 'Kube-dns pod memory limit starvation on worker node 04', description: 'Bumped requests to 256Mi and updated the horizontal pod autoscaler.', type: WorkItemType.ENGINEERING_PROBLEM, priority: HIGH, by: 'rohan', assignee: 'arjun', path: [IN_PROGRESS, RESOLVED, CLOSED], comments: [['arjun', 'Deployed and monitored for 48h — no further evictions.']] },
  { team: 'infra', title: 'Quarterly access review for production clusters', description: 'Review and attest all cluster-admin role bindings.', type: WorkItemType.COMPLIANCE_REQUEST, priority: MEDIUM, by: 'arjun' },
  { team: 'billing', title: 'Stripe webhook delivery queue backlogged', description: 'Delivery retries piling up since the vendor incident; invoices not marked paid.', type: WorkItemType.PAYMENT_INVESTIGATION, priority: HIGH, by: 'meera', assignee: 'priya', path: [IN_PROGRESS, BLOCKED], comments: [['priya', 'Waiting on the vendor to replay events from their side.']] },
  { team: 'billing', title: 'Duplicate invoice emails after retry storm', description: 'About 1,200 customers received two invoice emails on Tuesday.', type: WorkItemType.CUSTOMER_ISSUE, priority: MEDIUM, by: 'priya', assignee: 'meera', path: [IN_PROGRESS] },
  { team: 'billing', title: 'Reconcile March settlement batch variance', description: 'Variance of 0.04% between processor report and ledger.', type: WorkItemType.PAYMENT_INVESTIGATION, priority: LOW, by: 'meera' },
];

/**
 * Fill the in-memory stores with a realistic demo workspace.
 *
 * Everything goes through the real services, so the activity history, comments
 * and notifications that come with the demo data are genuine, and the same
 * rules (permissions, workflow, locking) are applied as for real requests.
 */
export async function seedDemoData(container: AppContainer): Promise<{ users: number; teams: number; items: number }> {
  const { userService, teamRepository, workItemService, workItemLockService, commentService } = container;

  const actors = new Map<string, AuthenticatedUser>();
  for (const person of PEOPLE) {
    const user = await userService.createUser({
      email: person.email,
      name: person.name,
      password: DEMO_PASSWORD,
      role: person.admin ? 'ADMIN' : 'USER',
    });
    actors.set(person.key, {
      id: user.id,
      email: user.email,
      role: person.admin ? GlobalRole.ADMIN : GlobalRole.USER,
    });
  }
  const actor = (key: string): AuthenticatedUser => actors.get(key)!;

  const teamIds = new Map<string, string>();
  for (const team of TEAMS) {
    const created = await teamRepository.create({ name: team.name, description: team.description });
    teamIds.set(team.key, created.id);
    await teamRepository.addMember(created.id, actor(team.manager).id, TeamRole.MANAGER);
    for (const member of team.members) {
      await teamRepository.addMember(created.id, actor(member).id, TeamRole.MEMBER);
    }
  }

  const managerOf = new Map(TEAMS.map((t) => [t.key, t.manager]));

  for (const demo of ITEMS) {
    const teamId = teamIds.get(demo.team)!;
    const manager = managerOf.get(demo.team)!;

    // The reporter creates the item; if it has an owner, the team manager assigns it
    // (assigning is a manager-only action).
    const item = await workItemService.create(actor(demo.by), {
      title: demo.title,
      description: demo.description,
      type: demo.type,
      priority: demo.priority,
      teamId,
    });

    const edit = async (who: string, change: Omit<UpdateWorkItemCommand, 'version'>) => {
      await workItemLockService.acquire(actor(who), item.id);
      const current = await workItemService.getById(actor(who), item.id);
      await workItemService.update(actor(who), item.id, { ...change, version: current.version });
      await workItemLockService.release(actor(who), item.id);
    };

    if (demo.assignee) await edit(manager, { assigneeId: actor(demo.assignee).id });
    for (const status of demo.path ?? []) {
      const closing = status === CLOSED;
      await edit(closing ? manager : (demo.assignee ?? demo.by), { status });
    }
    for (const [who, body] of demo.comments ?? []) {
      await commentService.add(actor(who), item.id, body);
    }
  }

  await container.jobQueue.drain(); // let the notifications for the demo history land
  return { users: PEOPLE.length, teams: TEAMS.length, items: ITEMS.length };
}
