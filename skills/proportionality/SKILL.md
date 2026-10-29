---
name: proportionality
description: Proportionality check for design decisions. Use before adding a special case, cap, threshold, lock, retry, flag, or mode for a subset of cases, before shaping the main design around a rare case, and when designing anything that touches service boundaries, queues, or concurrency.
---

# Proportionality

The main design serves the common case. An outlier earns special handling in proportion to its measured impact, and that handling stays where the outlier lives. The tail never wags the dog.

## Order of thought

Work through these in order. The first answer comes from the ideal, not from the constraints.

1. **Ideal.** Sketch the cleanest design for the problem: each responsibility in the service that owns it, the mechanism built for the job (an event, a version check, an idempotent handler). Ignore the current code for this step.
2. **Constraints.** List the real ones and where you got each: an API limit, delivery semantics, data volume, a deadline. A constraint you cannot point to is a guess; mark it as one.
3. **Fit.** Build the new part from the building blocks the system already has (streams, services, data models) and inside the boundaries the architecture intends. Where existing code already crosses a boundary, that is debt, not a pattern: the new part stays within its boundary, and you mention the debt to the user without copying or fixing it. If the architecture itself does not fit the problem, that is a decision for the user, not a workaround inside the new code.
4. **Outliers.** First check that the case belongs to the current goal. A case that only matters for a later step gets a note, not an implementation. The design stays **extensible, not extended**: check that the later need fits in as an addition (a new consumer, table, field, or event type) without rewriting what you build now, and build nothing for it yet. For each edge case that remains, size it before you touch the design: how many cases are affected (N of M), how often, and what a wrong result costs there. Then pick a response from the ladder below.

## Response ladder

Take the lowest rung that holds.

1. **Accept and mark.** The main path stays as it is. Make the inaccuracy visible where someone would trip over it: a flag on the affected records, a metric, one line in the docs.
2. **Contain.** Handle the outlier at its edge, so only the affected cases see the special logic. The main path stays unchanged.
3. **Redesign.** Change the main design only when the "outlier" turns out to be common, or when a wrong result costs money, data, or security.

Before you take rung 2 or 3, call the `software-engineering:proportionality-review` agent. It starts with no context, so pass all of this:

- the goal;
- the ideal design from step 1;
- the constraint, with its source;
- N of M affected, how often, and the cost of a wrong result there;
- the special case or redesign you propose;
- the repo paths that show the intended boundaries.

Its verdict goes into the **Decision** line of your `humanize` brief.

## Patterns

| Disproportionate | Proportional |
| --- | --- |
| A limit that hits a few cases is applied to all cases, so the data stays "consistent" | The few cases get a flag; everyone else keeps exact data |
| A lock, sleep, or retry loop because two messages might arrive out of order | Events carry a version; the handler applies newer versions and drops stale ones |
| The new service reads another service's tables because an old service does too | The new service consumes the owner's events or API; the old shortcut is reported as debt |
| A fallback chain for a failure seen once | The failure surfaces loudly; the cause gets fixed |
| An optional parameter or mode in a core API for one caller | The caller adapts at its own edge |
| Handling for a case that "could happen", with no evidence it does | Accept and mark; revisit when it shows up |
| A later step's needs widen the current design ("we will need this anyway") | Build for the current goal, shaped so the later need fits in as an addition; note the later need; build it when that step starts |

## Examples

**Bestseller ranking cap.** Goal: estimate orders per product from bestseller rankings across 255 stores. The ranking source returns at most 25,000 products, which truncates the list in 2 stores.
- Disproportionate: stop counting after rank 12,500 in every store, so all 255 behave alike. 253 stores lose correct data to hide a gap in 2.
- Proportional: keep full rankings everywhere and flag the 2 stores as "ranking truncated at 25,000" in the data. If those 2 stores matter enough, contain it: fetch their tail from a second source.

**Out-of-order events across a boundary.** Goal: the inventory service reserves stock when an order is created and releases it when the order is cancelled. Under load, `cancelled` can arrive before `created`. The billing service already solves similar cases by reading the orders database directly.
- Disproportionate: add a delay and retry, or let inventory read the orders database "like billing does." The first hides the cause; the second copies a boundary violation into a new service.
- Proportional: the order service puts a version on every event, and inventory keeps the last version applied per order and ignores older ones. Inventory stays inside its boundary. The billing shortcut goes to the user as a note on existing debt.

**A later step widens the current design.** Goal: the product service reacts to image-pipeline events and has to find the product an image belongs to. Only gallery images get a fingerprint, so only gallery images matter for this goal. Description and variant images get copied, too, and a later step will move their URL rewrite into the product service.
- Disproportionate: because the later step will need all three image kinds, build the lookup for all of them now: pending entries in a URL map, readers that skip pending entries, a backfill for images already copied, maybe a general image-usage table.
- Proportional: look up gallery images only, for example with a hash index on the image URL. Check that the later step can add its own lookup next to this one without changing it. Write the later need into the design doc as an open point. The lookup for description and variant images gets built when the rewrite moves.
