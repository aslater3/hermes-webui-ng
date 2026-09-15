# Phase 6 HTTP checkpoint

14 September 2026. Recovery confirmed remote `6272f26` and all five CI regression workflows passing. This checkpoint connects the previously internal file writer and operations to protected local HTTP endpoints. It is not a completed Phase 6 editor or Git-write release.

Writes require explicit global and logical-root opt-in plus HTTPS. Every request validates live Hermes admission before consuming a bounded body and again immediately before commit. Same-origin Host/Origin, Fetch Metadata and a custom header protect both JSON mutations and raw binary upload. No browser request enables a write flag or remounts a project. Existing deployments remain read-only.

PUT files/write uses expectedVersion. POST files/mkdir and files/rename and DELETE files/delete require explicit confirmation; rename/delete use a current entry revision. POST files/upload uses a bounded 10 MiB octet stream to an exclusive temporary file and kernel no-replace publication. It never replaces existing names. GET files/info supports confirmation/readback; writable text previews return an opaque revision. Every response remains no-store. Mutation audit logs include operation/outcome and opaque process-scoped tags, never file contents or raw paths.

Fresh build, typecheck and lint pass; 214 existing unit tests and 38 HTTP/WebSocket contracts pass, including real verified TLS in gated and trusted-local modes. Tests cover exact saves, stale versions, safe upload/rename/delete, nonempty-directory refusal, missing/revoked identity, CSRF/simple-form requests, bad paths, oversized upload, and disabled defaults. Browser/editor and writable-container acceptance are still required. The previously reported interruption did not lose any pushed code.
