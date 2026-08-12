# @assistant-mk1/workbench-react

React Query bindings for `@assistant-mk1/workbench-client`. The package is UI
agnostic and works with React DOM or React Native.

The package owns parameterized resource keys, request cancellation, mutation
invalidation, workspace cache fencing, and realtime-event invalidation. Chat
transport and session reconciliation remain application-owned; publish their
canonical session snapshots with `usePublishWorkbenchSession`.
