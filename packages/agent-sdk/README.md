# @assistant-mk1/agent-sdk

Build-time contracts for trusted Assistant-mk1 Agent Packs and Runtime Modules.

The package contains no workbench database, authentication, deployment, or
credential implementation. Runtime code receives scoped capabilities from the
workbench and cannot select tenant identity or bypass policy.

## Public exports

```ts
import { defineWorkbenchConfig } from "@assistant-mk1/agent-sdk";
import { defineAgentPack } from "@assistant-mk1/agent-sdk/manifest";
import { defineControlPlaneModule } from "@assistant-mk1/agent-sdk/control-plane";
import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";
import { defineWebModule } from "@assistant-mk1/agent-sdk/web";
```

`pnpm build` emits Node-compatible ESM and declarations under `dist`. The packed
artifact contains only `dist`, JSON schemas, package metadata, and this README;
consumers do not execute repository TypeScript source.

The SDK is a trusted build-time contract and is initially unpublished. It does
not support remote installation or unreviewed executable uploads.
