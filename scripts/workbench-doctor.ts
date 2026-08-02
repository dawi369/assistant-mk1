import { diagnoseWorkbench } from "./workbench-doctor-core";

void diagnoseWorkbench({
  root: process.cwd(),
  offline: process.argv.includes("--offline"),
}).then(({ checks, failures }) => {
  for (const check of checks) console.log(`ok - ${check}`);
  if (failures.length) {
    for (const failure of failures) console.error(`error - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      process.argv.includes("--offline")
        ? "Workbench configuration is ready (offline)."
        : "Workbench is ready.",
    );
  }
});
