# Contracts Model

## Overview

`contracts.js` auto-discovers and auto-solves coding contracts across all
rooted servers.

## Solver Safety

Uses `ns.codingcontract.attempt()` — **wrong answers cost attempts**. Each
solver must be verified correct before adding it. Test solver logic carefully
against edge cases before introducing a new contract type.

## Supported Types

25 contract types are currently supported. Unsupported types are logged and
skipped with no penalty (no attempt is made).

## Deduplication

Solved contracts are tracked in-session to avoid re-attempting contracts that
previously failed. This prevents burning remaining attempts on a known-bad
solver.

## Status

Written to `data/contracts_status.txt`. Line count equals the number of
discovered contracts.
