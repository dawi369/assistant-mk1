export const releaseNodeMajor = 24;
export const localDevelopmentNodeMajors = [releaseNodeMajor, 26] as const;

export type NodeRuntimeAssessment = {
  supported: boolean;
  message: string;
};

export const assessLocalNodeRuntime = (version = process.versions.node): NodeRuntimeAssessment => {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (major === releaseNodeMajor) {
    return {
      supported: true,
      message: `Node.js ${version} matches the release runtime (24.x)`,
    };
  }
  if (major === 26) {
    return {
      supported: true,
      message: `Node.js ${version} is accepted for local development; release verification uses 24.x`,
    };
  }
  return {
    supported: false,
    message: `Node.js 24.x is required for releases; local development also accepts 26.x (current runtime is v${version})`,
  };
};
