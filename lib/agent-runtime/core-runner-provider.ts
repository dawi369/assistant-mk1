import { runnerEchoToolName } from "../workbench/admin-test-tools";
import { repoSnapshotToolName } from "../workbench/repo-snapshot";

export const coreRunnerToolIds = ["url.inspect", repoSnapshotToolName, runnerEchoToolName] as const;

const coreRunnerTools = new Set<string>(coreRunnerToolIds);

export const isCoreRunnerTool = (toolId: string) => coreRunnerTools.has(toolId);
