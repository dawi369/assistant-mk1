import type { AgentBehaviorTemplate } from "./workbench-types";

import {
  buildPackWorkflowRequest,
  fieldDefinitionsForPackWorkflow,
  packWorkflowBindings,
  packWorkflowFieldDefinitions,
  type PackWorkflowBinding,
  type PackWorkflowFieldDefinition,
  type PackWorkflowFieldName,
  type PackWorkflowRequest,
  type PackWorkflowType,
} from "../../agent-packs/workflow-catalog";

type AgentPackWorkflow = NonNullable<AgentBehaviorTemplate["pack"]>["workflows"][number];

export type ResolvedPackWorkflowBinding =
  | { runnable: true; workflow: AgentPackWorkflow; binding: PackWorkflowBinding }
  | { runnable: false; workflow: AgentPackWorkflow; reason: "declared_only" };

export const resolvePackWorkflowBinding = (
  workflow: AgentPackWorkflow,
): ResolvedPackWorkflowBinding => {
  const binding = packWorkflowBindings[workflow.type as PackWorkflowType];
  return binding
    ? { runnable: true, workflow, binding }
    : { runnable: false, workflow, reason: "declared_only" };
};

export {
  buildPackWorkflowRequest,
  fieldDefinitionsForPackWorkflow,
  packWorkflowBindings,
  packWorkflowFieldDefinitions,
};
export type {
  PackWorkflowBinding,
  PackWorkflowFieldDefinition,
  PackWorkflowFieldName,
  PackWorkflowRequest,
  PackWorkflowType,
};
