# G2-6 + G6-6 — Design Dispositions (decided, deferred against G9-4 evidence)

> **Date:** 2026-07-22 · **Status:** DECIDED (deferral with explicit re-open criteria)
> **Rows:** G2-6 (closed-loop one-shots) · G6-6 (structured per-state behavior on templates)
> **Pattern:** same disposition class as G0-3b / G0-11b — single-evidence features
> are not generalized until the G9-4 second-project pilot supplies a second case.

## G2-6 — Closed-loop one-shots (e.g. Straighten-Up)

**Evidence:** exactly one instance — the hand-authored straighten block in
`UC_Rotator.scl` (drive toward the nearest home window until `rot_at_home`,
with direction chosen from the signed angle). It is a bespoke closed-loop
routine over one axis's geometry.

**Decision: stays hand-authored; DO NOT generalize from one sample.**
A generic "closed-loop one-shot" model would need: a target predicate (gate),
an actuation rule (which EM command/setpoint, signed how), interaction with
the unit SM (which states permit it), and abort semantics. Every one of those
choices would currently be invented from a single data point — precisely what
the TODO-not-guess rule exists to prevent. The G2 coordinator emits everything
around such a block (gates, routing, geometry), so a hand-authored one-shot
drops into the generated UC as a clearly-bounded custom section.

**Re-open when:** the G9-4 pilot (or any second project) needs a comparable
closed-loop routine. Two evidenced instances define the generic shape
(predicate + actuation + permission + abort); model it then as a
`unit_coordination.one_shots[]` construct with its own writer.

## G6-6 — Structured per-state behavior model on templates

**Evidence gap:** template `states` today are coverage-only
(`{slug, name, is_safe}`) — enough for the G6 coverage gate and the G7 text
lists, but the template's per-state behavior lives in opaque SCL.

**Decision: defer; the cost/benefit is currently upside-down.**
What structured behavior would buy: per-state DOCX behavior appendices
without SCL parsing, cross-checking a template's states against FDS
`command_behavior`, and library-EM participation in behavior-level
verification. What it costs: a second behavior schema (parallel to the FDS's
static/sequential/command_behavior model) that every library import must
populate — for templates whose SCL is the signed artifact anyway. The G0-8
behavior appendix is DERIVED from the template at DOCX time, and the coverage
gate + interface contract already police the safety-relevant surface
(states declared, safe state, pins/roles).

**Re-open when:** either (a) the G9 acceptance requires behavior-level
verification of a library EM (not just state coverage), or (b) the DOCX
behavior appendix proves inadequate when derived from SCL + documentation.
If reopened, reuse the FDS state-behavior schema (static holds /
command_behavior) on `FbInterfaceContract` rather than inventing a third
model.

## Roadmap effect

Both rows move from 💡 NEEDS DESIGN to **decided-deferred** with the criteria
above; they are not open work items and should not read as backlog debt.
