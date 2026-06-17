# Agent Profile Authoring

Agent/profile authoring is the contract for how reusable behavior templates
become durable agent behavior.

## Current v0

Current v0 is metadata-only and server-owned:

- Built-in templates live in Cloudflare control-plane source code.
- Templates declare `authoring.kind = "built_in_template"`.
- Templates declare `authoring.format = "xml"`.
- Templates declare `authoring.source = "cloudflare-control-plane"`.
- Templates are not browser-editable.
- Creating an agent copies the selected template into
  `agents.data_json.behavior` as a snapshot.

This keeps active agent behavior stable even if built-in template source changes
later.

## Not In v0

- No filesystem template loader.
- No browser prompt editor.
- No user-authored profile packs.
- No template migration system.
- No model-visible authoring metadata.

Future filesystem-first or profile-pack authoring should compile into explicit
durable records with stable IDs, ownership, policy, version history, and audit.
It should not make file paths the production identity source.
