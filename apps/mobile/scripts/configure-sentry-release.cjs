const { spawnSync } = require("node:child_process");

const release = process.env.EAS_BUILD_GIT_COMMIT_HASH;
if (!release || !/^[a-f0-9]{40}$/.test(release)) {
  throw new Error("EAS mobile builds require a full EAS_BUILD_GIT_COMMIT_HASH.");
}
for (const name of ["SENTRY_RELEASE", "EXPO_PUBLIC_SENTRY_RELEASE"]) {
  const result = spawnSync("set-env", [name, release], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Unable to set ${name} for the EAS build.`);
}
console.log("Configured the mobile Sentry release from the EAS commit.");
