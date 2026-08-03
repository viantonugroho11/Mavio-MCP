# ADR-014: Open-source license & dual-license posture

**Status:** Proposed
**Date:** 2026-08-03
**Deciders:** Founders, Legal, Platform Architecture

## Context
License choice shapes contributor pool, downstream adoption, and any future commercial strategy. Doing this wrong or late is expensive.

## Decision (proposed)
License Mavio-MCP under **Apache License 2.0**. Keep the door open for **BSL/Enterprise Edition** features (advanced SSO, audit sinks, SLA) under a separate, clearly-marked directory — but ship v1.0 as pure Apache 2.0.

## Options Considered

### Option A: Apache 2.0 (proposed)
**Pros:** Broadest adoption; explicit patent grant; friendly to enterprise consumers.
**Cons:** Cannot restrict SaaS relicensing.

### Option B: MIT
**Pros:** Simplest.
**Cons:** No patent grant; enterprise legal review takes longer.

### Option C: BSL (Business Source License)
**Pros:** Blocks competitive SaaS resell.
**Cons:** Not OSI-approved; scares off contributors; distros won't package.

### Option D: AGPL
**Pros:** Copyleft for network use.
**Cons:** Chills enterprise adoption; incompatible with many corporate policies.

## Trade-off Analysis
Community + enterprise adoption > SaaS defensibility at this stage. Enterprise features can be layered later in a separately-licensed directory without relicensing core.

## Consequences
- Contributor License Agreement (CLA) or Developer Certificate of Origin (DCO) required — pick DCO for lower friction.
- License headers on every source file.
- Third-party dep license audit part of CI.
- Revisit if a competitive SaaS emerges and materially harms sustainability.

## Action Items
- [ ] `LICENSE` file (Apache 2.0).
- [ ] `NOTICE` file for third-party attributions.
- [ ] DCO check in CI.
- [ ] License-scan CI job (e.g., FOSSA/ScanCode).
