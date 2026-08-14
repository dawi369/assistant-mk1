import { readFileSync } from "node:fs";

export const mobileDeviceChecks = [
  "signIn",
  "earlySend",
  "foregroundResume",
  "workflowArtifact",
  "approvalPush",
  "terminalPush",
  "signOutRevocation",
] as const;

export type MobileDeviceCheck = (typeof mobileDeviceChecks)[number];
export type MobilePlatform = "ios" | "android";

type AcceptanceCheck = {
  status: "passed";
  completedAt: string;
  screenshot?: string;
  recordId?: string;
};

type PlatformEvidence = {
  device: {
    name: string;
    model: string;
    osVersion: string;
    appBuild: string;
  };
  checks: Record<MobileDeviceCheck, AcceptanceCheck>;
};

export type MobileDeviceEvidence = {
  schemaVersion: 2;
  commit: string;
  operator: string;
  workosApplicationId: string;
  createdAt: string;
  platforms: Record<MobilePlatform, PlatformEvidence>;
};

export type MobileDeviceEvidenceDraft = Omit<MobileDeviceEvidence, "platforms"> & {
  platforms: Record<
    MobilePlatform,
    {
      device: PlatformEvidence["device"];
      checks: Record<
        MobileDeviceCheck,
        {
          status: "not-run" | "passed";
          completedAt: string | null;
          screenshot?: string;
          recordId?: string;
        }
      >;
    }
  >;
};

const credentialPattern =
  /(?:sk_(?:test|live)_[A-Za-z0-9_-]{12,}|sk-or-v1-[A-Za-z0-9_-]{12,}|(?:access|refresh|id)[_-]?token|authorization|cookie|client[_-]?secret|pkce|code[_-]?verifier|password|api[_-]?key)/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireString = (value: unknown, path: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Mobile device evidence requires ${path}.`);
  }
  return value.trim();
};

const requireTimestamp = (value: unknown, path: string) => {
  const timestamp = requireString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) {
    throw new Error(`Mobile device evidence has an invalid timestamp at ${path}.`);
  }
  return timestamp;
};

const scanForCredentials = (value: unknown, path = "evidence") => {
  if (typeof value === "string") {
    if (credentialPattern.test(value)) {
      throw new Error(`Mobile device evidence contains credential-shaped data at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForCredentials(item, `${path}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (credentialPattern.test(key)) {
        throw new Error(`Mobile device evidence contains a forbidden field at ${path}.${key}.`);
      }
      scanForCredentials(item, `${path}.${key}`);
    }
  }
};

export function parseMobileDeviceEvidence(value: unknown): MobileDeviceEvidence {
  scanForCredentials(value);
  if (!isObject(value) || value.schemaVersion !== 2) {
    throw new Error("Mobile device evidence must use schemaVersion 2.");
  }
  const commit = requireString(value.commit, "commit");
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("Mobile device evidence commit must be a full Git SHA.");
  }
  const platforms = value.platforms;
  if (!isObject(platforms)) throw new Error("Mobile device evidence requires platforms.");

  for (const platform of ["ios", "android"] as const) {
    const evidence = platforms[platform];
    if (!isObject(evidence) || !isObject(evidence.device) || !isObject(evidence.checks)) {
      throw new Error(`Mobile device evidence requires ${platform} device and checks.`);
    }
    for (const field of ["name", "model", "osVersion", "appBuild"] as const) {
      requireString(evidence.device[field], `platforms.${platform}.device.${field}`);
    }
    let screenshots = 0;
    for (const checkName of mobileDeviceChecks) {
      const check = evidence.checks[checkName];
      if (!isObject(check) || check.status !== "passed") {
        throw new Error(`Mobile device evidence requires passed ${platform}.${checkName}.`);
      }
      requireTimestamp(check.completedAt, `platforms.${platform}.checks.${checkName}.completedAt`);
      if (check.screenshot !== undefined) {
        const screenshot = requireString(
          check.screenshot,
          `platforms.${platform}.checks.${checkName}.screenshot`,
        );
        if (!screenshot.startsWith(`output/mobile/${platform}/`)) {
          throw new Error(`${platform}.${checkName} screenshot must stay under output/mobile.`);
        }
        screenshots += 1;
      }
      if (check.recordId !== undefined) {
        requireString(check.recordId, `platforms.${platform}.checks.${checkName}.recordId`);
      }
    }
    if (screenshots === 0) {
      throw new Error(`Mobile device evidence requires at least one ${platform} screenshot.`);
    }
  }

  requireString(value.operator, "operator");
  requireString(value.workosApplicationId, "workosApplicationId");
  requireTimestamp(value.createdAt, "createdAt");
  return value as MobileDeviceEvidence;
}

export function readMobileDeviceEvidence(path: string) {
  return parseMobileDeviceEvidence(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function createMobileDeviceEvidenceTemplate(input: {
  commit: string;
  operator: string;
  workosApplicationId: string;
}): MobileDeviceEvidenceDraft {
  const checks = Object.fromEntries(
    mobileDeviceChecks.map((check) => [check, { status: "not-run" as const, completedAt: null }]),
  ) as MobileDeviceEvidenceDraft["platforms"][MobilePlatform]["checks"];
  const platform = () => ({
    device: { name: "", model: "", osVersion: "", appBuild: "" },
    checks: structuredClone(checks),
  });
  return {
    schemaVersion: 2,
    commit: input.commit,
    operator: input.operator,
    workosApplicationId: input.workosApplicationId,
    createdAt: new Date().toISOString(),
    platforms: { ios: platform(), android: platform() },
  };
}
