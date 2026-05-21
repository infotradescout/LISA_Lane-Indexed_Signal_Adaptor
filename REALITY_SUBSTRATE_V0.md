# Reality Substrate v0

## Decision

Build Reality Substrate v0.1 first.

Not Merlin.
Not more UI.
Not another app layer.

Merlin comes later as the coordination surface.

## Core stack

```text
Reality
↓
Reality Primitives
↓
4data
↓
LISA
↓
FactDeck
↓
Merlin
↓
TradeScout / MealScout / Continuum / other systems
```

## Clean definitions

### Reality Primitives

Reality Primitives are the stable objects and concepts that let the system preserve continuity over time.

The first primitives are:

- Entity
- Event
- Signal
- Observation
- Source
- Time
- Trust
- State
- Confidence
- Relationship
- Outcome

### 4data

4data is time-aware truth created by real activity.

4data is not a factory, not an app, and not a model output.

4data is the living material produced when real actions, observations, sources, and outcomes are recorded with time, provenance, and confidence.

### LISA

LISA is continuity, freshness, reconciliation, provenance, and anti-drift infrastructure.

LISA does not generate truth.

LISA preserves observations, reconciles them into current state, tracks freshness, detects contradictions, and exposes confidence.

### FactDeck

FactDeck is prediction from the substrate.

FactDeck reads substrate state and produces probabilistic predictions, scenario comparisons, and uncertainty-aware recommendations.

### Merlin

Merlin is coordination and execution alignment.

Merlin coordinates reality.

Merlin does not define reality.

### AI

AI is an optional cognition/interface layer.

AI can parse, compress, summarize, classify, draft, and accelerate.

AI is not the source of truth.

## Core truth

Most AI systems collapse because they mix truth, inference, memory, generation, and action.

This stack separates them.

The moat is not better AI.

The moat is operational reality infrastructure:

- provenance,
- freshness,
- continuity,
- trust history,
- state replay,
- confidence decay,
- outcome feedback,
- contradiction handling,
- entity continuity,
- and source-linked time-aware truth.

## What to stop doing

Stop building more surfaces until the substrate exists.

Do not expand:

- new verticals,
- new dashboards,
- new assistant features,
- new branding layers,
- new philosophical frameworks.

The risk is not lack of ideas.

The risk is entropy.

## Reality Substrate v0 purpose

Reality Substrate v0 exists to preserve time-aware, source-linked, confidence-scored truth created by real-world activity.

It does not generate truth.
It records observations.
It derives state.
It preserves provenance.
It exposes confidence.
It allows coordination systems to act without becoming truth authorities.

## Foundational rule

Never overwrite observed reality.

Append observations.
Derive current state.

This rule is foundational.

## Layer 1 — Canonical primitives

### Entity

An Entity is a stable thing the system can recognize across time.

Examples:

- business,
- customer,
- contractor,
- homeowner,
- restaurant,
- host,
- vendor,
- event,
- order,
- booking,
- location,
- media package,
- source,
- market instrument,
- system process.

What it is not:

- a one-time event,
- a temporary UI row,
- a raw payload without identity.

Required fields:

- id
- entity_type
- canonical_name
- status
- created_at
- updated_at
- provenance

State impact:

Entities anchor signals, events, observations, relationships, trust, confidence, and outcomes.

### Event

An Event is something that happened at a point in time.

Examples:

- profile claimed,
- order completed,
- booking accepted,
- insurance uploaded,
- search performed,
- LLM visibility gap detected,
- media render failed,
- payment succeeded,
- admin verification approved.

What it is not:

- a current state snapshot,
- a prediction,
- an inferred long-term condition.

Required fields:

- id
- entity_id
- source_id
- event_type
- observed_at
- created_at
- raw_payload
- normalized_payload
- provenance
- confidence
- status

State impact:

Events create 4data and may generate observations, signals, state changes, trust changes, or outcomes.

### Signal

A Signal is a structured claim or observation about an entity, context, condition, or change.

Signals may be observed, inferred, external, predicted, stale, contradicted, or verified.

What it is not:

- raw unprocessed data,
- an action,
- final truth without provenance.

Required fields:

- id
- entity_id
- source_id
- lane
- signal_kind
- observed_fact
- observed_at
- valid_from
- valid_until
- confidence
- trust_weight
- provenance
- status

State impact:

Signals inform current state, confidence, trust, and downstream prediction.

### Observation

An Observation is a recorded piece of reality or context from a source.

It may be direct first-party truth, inferred intent, or external context.

What it is not:

- derived state,
- a prediction,
- an action.

Required fields:

- id
- source_id
- entity_id
- observation_type
- evidence_class
- observed_at
- created_at
- raw_payload
- normalized_payload
- confidence
- provenance

State impact:

Observations are append-only. They are the durable record from which state is derived.

### Source

A Source is where an observation, event, signal, or claim came from.

Examples:

- TradeScout platform event,
- MealScout order event,
- Continuum render event,
- MarketFilter feed,
- public crawl,
- LLM visibility probe,
- admin review,
- user upload,
- external API.

What it is not:

- the claim itself,
- the entity being described.

Required fields:

- id
- source_type
- source_name
- owner
- reliability_rating
- access_method
- provenance_policy
- created_at
- status

State impact:

Source reliability affects trust weight and confidence.

### Time

Time is the fourth dimension of the system.

No fact is complete without time.

Required fields across substrate records:

- created_at
- observed_at
- valid_from
- valid_until
- fresh_until
- updated_at when applicable

State impact:

Time controls freshness, decay, contradiction windows, state replay, and historical reconstruction.

### Trust

Trust is history-backed reliability, verification, permission, and outcome quality.

Trust is not a static score.

It is accumulated evidence over time.

Required fields:

- id
- entity_id
- trust_type
- score
- evidence_refs
- updated_at
- valid_until
- confidence
- status

State impact:

Trust affects routing, ranking, exposure, permissioning, confidence, and review requirements.

### State

State is the current known condition of an entity or system after observations and signals have been reconciled.

State must always be derived.

What it is not:

- raw reality,
- an overwritten observation,
- untraceable truth.

Required fields:

- id
- entity_id
- state_type
- current_value
- source_observation_ids
- source_signal_ids
- confidence
- valid_from
- valid_until
- created_at
- reconciliation_log_id
- status

State impact:

State powers product surfaces, coordination, prediction, and action guidance.

### Confidence

Confidence is bounded certainty based on evidence quality, source trust, freshness, contradiction, and history.

Confidence must decay when freshness decays.

Required fields:

- id
- target_type
- target_id
- score
- reason
- evidence_refs
- calculated_at
- decay_policy
- status

State impact:

Confidence decides whether something can be shown, recommended, routed, predicted, or acted on.

### Relationship

A Relationship is a meaningful connection between entities.

Examples:

- business serves customer,
- contractor works in county,
- vendor booked host,
- order belongs to restaurant,
- media package belongs to business,
- signal affects entity,
- action changed state.

Required fields:

- id
- from_entity_id
- to_entity_id
- relationship_type
- confidence
- source_id
- observed_at
- valid_from
- valid_until
- provenance
- status

State impact:

Relationships allow cross-domain continuity and entity graph reasoning.

### Outcome

An Outcome records what happened after an action, prediction, recommendation, decision, or workflow.

Outcome memory is what separates continuity infrastructure from generic automation.

Required fields:

- id
- entity_id
- related_action_id
- related_prediction_id
- outcome_type
- expected_outcome
- actual_outcome
- observed_at
- created_at
- confidence
- provenance
- status

State impact:

Outcomes update trust, confidence, prediction memory, routing, and future coordination.

## Layer 2 — LISA responsibilities

LISA becomes:

- ingestion,
- normalization,
- freshness tracking,
- provenance tracking,
- reconciliation,
- dedupe,
- contradiction detection,
- confidence decay,
- current state snapshotting,
- and anti-drift infrastructure.

LISA is not the AI.

LISA is the anti-drift layer.

## Layer 3 — Vertical worlds

TradeScout, MealScout, Continuum, MarketFilter, and future systems are domain-specific manifestations of the same state engine.

They should not be built internally as totally separate products.

They are different lenses over one continuity architecture.

Shared logic:

- entity logic,
- trust logic,
- freshness logic,
- provenance logic,
- ranking logic,
- continuity logic,
- behavioral logic,
- outcome logic.

## Product hierarchy

```text
4data = truth material
LISA = truth maintenance
FactDeck = probability engine
Merlin = coordination layer
TradeScout = local trust economy
MealScout = local food activity graph
Continuum = frameless media system
```

## First implementation target

Use TradeScout as the first proof vertical.

Why:

- contractors have identities,
- jobs create events,
- claims require verification,
- trust matters,
- outcomes matter,
- routing depends on confidence,
- bad data has real consequences.

TradeScout is the best training ground for 4data + LISA.

## Minimum tables / objects

- entities
- sources
- signals
- events
- observations
- state_snapshots
- relationships
- trust_scores
- confidence_scores
- outcomes
- reconciliation_logs

## Minimum standard fields

Every substrate object should use relevant fields from this shared set:

- id
- entity_id
- source_id
- created_at
- observed_at
- valid_from
- valid_until
- confidence
- trust_weight
- provenance
- raw_payload
- normalized_payload
- status

Critical distinction:

- observed_at = when reality happened
- created_at = when the system recorded it
- valid_from / valid_until = when it applies

## Week 1 — Canonical primitives

Create and maintain this file as the canonical primitive reference.

For each primitive define:

- what it is,
- what it is not,
- required fields,
- who can create it,
- how it decays,
- how it affects state.

## Week 2 — Schema

Build the database layer for the minimum tables / objects.

Do not optimize prematurely.

Do not add extra primitives until the first set is working.

## Week 3 — LISA reconciliation

Build first reconciliation jobs:

- dedupe entity,
- merge duplicate signals,
- flag contradictions,
- decay old confidence,
- promote trusted repeated observations,
- create current state snapshot,
- log why state changed.

No magic AI is needed.

Stable rules first.

## Week 4 — Merlin read-only coordination

Merlin v0 should only answer:

- What changed?
- Why did it change?
- What should happen next?
- What confidence do we have?
- What source supports this?
- What is stale?
- What needs human review?

Do not let Merlin mutate truth yet.

Merlin can suggest actions.

LISA owns continuity.

4data owns time-aware truth.

## Operating principle

Do not use probabilistic tools to define deterministic truth.

Use AI for:

- parsing,
- summarizing,
- drafting,
- classification support,
- compression,
- interface acceleration.

Do not use AI as:

- source of truth,
- final architect,
- hidden decider,
- provenance substitute,
- trust authority.

## KPI

The KPI is not brilliance.

The KPI is stable compounding architecture.

Success means every real action improves the system's ability to remain aligned with reality over time.
