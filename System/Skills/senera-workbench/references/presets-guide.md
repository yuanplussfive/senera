# Presets Guide

Presets are durable persona cards stored in `.senera/presets/<name>.json` on the workspace.

## Identity

- The preset **file name** (including the `.json` extension) is the canonical identity; the UI and the command surface accept the name with or without the suffix.
- The activation state is stored separately (`.senera/presets-state.json`) and holds the canonical file name.

## Persona Card Format

A valid card is JSON with `schemaVersion` (`senera.persona/v1` or the current version), `title`, `corePersona`, `languageStyle`, `examples`, and `lore`. Invalid cards are rejected with diagnostics before any file is written.

## Semantics

- `preset use <name>` activates the card: the next turn's persona context switches to it, and the frontend is notified.
- `preset use null` deactivates the persona (no active preset).
- `preset create` either creates or overwrites; the command reports which.
- Activation through the command surface is durable: it survives restarts (state is persisted, not held in memory).
