const { execFileSync } = require("node:child_process");

const localCommit = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "development";
  }
};

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    releaseSha:
      process.env.EXPO_PUBLIC_SENTRY_RELEASE ||
      process.env.EAS_BUILD_GIT_COMMIT_HASH ||
      localCommit(),
  },
});
