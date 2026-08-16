const { execFileSync } = require("node:child_process");
const product = require("../../config/product.json");

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
  name: product.mobile.displayName,
  slug: product.mobile.slug,
  scheme: product.mobile.scheme,
  ios: {
    ...config.ios,
    bundleIdentifier: product.mobile.bundleIdentifier,
    associatedDomains: [`applinks:${new URL(product.webOrigin).host}`],
  },
  android: {
    ...config.android,
    package: product.mobile.bundleIdentifier,
    intentFilters: (config.android?.intentFilters ?? []).map((filter) => ({
      ...filter,
      data: (filter.data ?? []).map((data) => ({
        ...data,
        host: new URL(product.webOrigin).host,
      })),
    })),
  },
  extra: {
    ...config.extra,
    releaseSha:
      process.env.EXPO_PUBLIC_SENTRY_RELEASE ||
      process.env.EAS_BUILD_GIT_COMMIT_HASH ||
      localCommit(),
  },
});
