# deliver

Deliverables to WooCommerce, the third module of the pipeline (CONTEXT.md "Pipeline orthogonality"). It attaches download URLs to a line item, completes an order once every Quiz of it is delivered, and adds private operator notes for failures, all through the WooCommerce REST API.

May know: Quiz ids, order ids, line item ids, file URLs, failure reasons.
May not know: Items, Compositions, Storage paths. Never imports from `sample` or `render`.

Interface in `index.ts` is pinned on master (spec #36); implementation lands with ticket #41.
