type AuditFinding = {
  paths?: unknown;
};

type AuditAdvisory = {
  severity?: unknown;
  module_name?: unknown;
  github_advisory_id?: unknown;
  patched_versions?: unknown;
  findings?: unknown;
};

type AuditReport = {
  advisories?: unknown;
};

export type BlockedAuditAdvisory = {
  id: string;
  moduleName: string;
  severity: string;
  githubAdvisoryId: string;
  paths: string[];
};

export type SecurityAuditDecision = {
  blocked: BlockedAuditAdvisory[];
  allowed: BlockedAuditAdvisory[];
};

const ALLOWED_UNPATCHED_ADVISORIES = new Set(["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"]);

const ALLOWED_IMAGE_SIZE_PATH = "apps__mobile>expo>@expo/metro>metro>image-size";

function normalizeAdvisory(id: string, advisory: AuditAdvisory): BlockedAuditAdvisory {
  const findings = Array.isArray(advisory.findings) ? (advisory.findings as AuditFinding[]) : [];
  const paths = findings.flatMap((finding) =>
    Array.isArray(finding.paths)
      ? finding.paths.filter((path): path is string => typeof path === "string")
      : [],
  );

  return {
    id,
    moduleName: typeof advisory.module_name === "string" ? advisory.module_name : "unknown",
    severity: typeof advisory.severity === "string" ? advisory.severity : "unknown",
    githubAdvisoryId:
      typeof advisory.github_advisory_id === "string" ? advisory.github_advisory_id : "unknown",
    paths,
  };
}

function isNarrowExpoBuildTimeException(
  advisory: AuditAdvisory,
  normalized: BlockedAuditAdvisory,
): boolean {
  return (
    normalized.moduleName === "image-size" &&
    ALLOWED_UNPATCHED_ADVISORIES.has(normalized.githubAdvisoryId) &&
    advisory.patched_versions === "<0.0.0" &&
    normalized.paths.length > 0 &&
    normalized.paths.every((path) => path === ALLOWED_IMAGE_SIZE_PATH)
  );
}

export function evaluateSecurityAudit(report: AuditReport): SecurityAuditDecision {
  const advisories =
    report.advisories && typeof report.advisories === "object"
      ? (report.advisories as Record<string, AuditAdvisory>)
      : {};
  const decision: SecurityAuditDecision = { blocked: [], allowed: [] };

  for (const [id, advisory] of Object.entries(advisories)) {
    if (advisory.severity !== "high" && advisory.severity !== "critical") continue;
    const normalized = normalizeAdvisory(id, advisory);
    if (isNarrowExpoBuildTimeException(advisory, normalized)) {
      decision.allowed.push(normalized);
    } else {
      decision.blocked.push(normalized);
    }
  }

  return decision;
}
