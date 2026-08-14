import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createMobileDeviceEvidenceTemplate,
  readMobileDeviceEvidence,
} from "./mobile-device-evidence-lib";

const command = process.argv[2];
const option = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
};

if (command === "init") {
  const output = resolve(option("output") ?? "output/mobile/device-acceptance.json");
  const commit = option("commit") ?? process.env.GITHUB_SHA ?? "";
  const operator = option("operator") ?? process.env.WORKBENCH_MOBILE_OPERATOR ?? "";
  const workosApplicationId =
    option("workos-app") ?? process.env.WORKBENCH_MOBILE_WORKOS_APPLICATION_ID ?? "";
  if (!/^[a-f0-9]{40}$/.test(commit) || !operator || !workosApplicationId) {
    throw new Error("init requires a full --commit, --operator, and --workos-app.");
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      createMobileDeviceEvidenceTemplate({ commit, operator, workosApplicationId }),
      null,
      2,
    )}\n`,
  );
  console.log(`Created incomplete mobile acceptance template: ${output}`);
} else if (command === "check") {
  const input = resolve(
    option("input") ??
      process.env.WORKBENCH_MOBILE_DEVICE_EVIDENCE ??
      "output/mobile/device-acceptance.json",
  );
  const evidence = readMobileDeviceEvidence(input);
  console.log(`Mobile device evidence passed for ${evidence.commit}: ${input}`);
} else {
  throw new Error("Expected mobile-device-evidence init|check.");
}
