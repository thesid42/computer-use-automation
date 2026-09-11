import type { ActionKind, RiskClass } from '../domain/types.js';
import type { ResolvedControl } from '../surface/adapter.js';

export type PolicyProfile = {
  allowedOrigins: string[];
  allowedRoutes: string[];
  allowedActionKinds: ActionKind[];
  maxRisk: RiskClass;
  controlOwner: 'automation' | 'human';
  blockedTargetNamePatterns?: string[] | undefined;
};

export type PolicyAction = { kind: ActionKind; risk?: RiskClass; target?: Pick<ResolvedControl, 'name' | 'text' | 'label'> };
export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

const riskRank: Record<RiskClass, number> = { READ_ONLY: 0, REVERSIBLE_WRITE: 1, IRREVERSIBLE_WRITE: 2 };

function targetRisk(target: PolicyAction['target'], patterns: string[] | undefined): RiskClass {
  if (!target || !patterns?.length) return 'READ_ONLY';
  const values = [target.name, target.text, target.label].filter((value): value is string => Boolean(value));
  return patterns.some((pattern) => values.some((value) => {
    try { return new RegExp(pattern, 'i').test(value); } catch { return value.toLowerCase().includes(pattern.toLowerCase()); }
  })) ? 'IRREVERSIBLE_WRITE' : 'READ_ONLY';
}

function routeAllowed(pathname: string, routes: string[]): boolean {
  return routes.some((route) => route.endsWith('*') ? pathname.startsWith(route.slice(0, -1)) : pathname === route);
}

export class PolicyGate {
  constructor(private readonly profile: PolicyProfile) {}

  isOriginAllowed(url: URL): boolean { return this.profile.allowedOrigins.includes(url.origin); }

  isRouteAllowed(url: URL): boolean { return routeAllowed(url.pathname, this.profile.allowedRoutes); }

  check(action: PolicyAction, url: URL, owner: 'automation' | 'human', resolvedControl?: ResolvedControl): PolicyDecision {
    if (owner !== this.profile.controlOwner) return { allowed: false, reason: 'control_owner_mismatch' };
    if (!this.profile.allowedOrigins.includes(url.origin)) return { allowed: false, reason: 'origin_not_allowed' };
    if (!routeAllowed(url.pathname, this.profile.allowedRoutes)) return { allowed: false, reason: 'route_not_allowed' };
    if (!this.profile.allowedActionKinds.includes(action.kind)) return { allowed: false, reason: 'action_kind_not_allowed' };
    const declaredRisk = action.risk ?? 'READ_ONLY';
    const resolvedRisk = targetRisk(resolvedControl ?? action.target, this.profile.blockedTargetNamePatterns);
    const effectiveRisk = riskRank[declaredRisk] >= riskRank[resolvedRisk] ? declaredRisk : resolvedRisk;
    if (riskRank[effectiveRisk] > riskRank[this.profile.maxRisk]) return { allowed: false, reason: 'risk_exceeds_policy' };
    return { allowed: true };
  }
}
