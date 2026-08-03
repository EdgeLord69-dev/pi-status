# Statusline Sidebar Phase 8: Release Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document, package, and manually verify the complete sidebar before release.

**Architecture:** This phase changes no runtime behavior. It records attribution and user-facing contracts, then runs the repository/package gates and a deterministic manual matrix.

**Tech Stack:** Markdown, MIT attribution, pnpm, Node 24.15.0, tmux.

---

## Task 1: Update release documentation

**Files:** `LICENSE`, `README.md`, `CHANGELOG.md`.

- [ ] **Step 1: Add attribution**

Retain the existing pi-status MIT notice and add Michael’s current Atelier copyright notice for the ported palette, panel, renderer, and split behavior.

- [ ] **Step 2: Document behavior**

Document the nine built-ins, ordered Sidebar tab, contribution channel/protocol, hidden-by-default contributions, TODO formats/collapse rule, 39-column compact breakpoint, 92-column auto-hide, resize shortcut, fullscreen behavior, `NO_COLOR`, and cleanup guarantees.

- [ ] **Step 3: Add changelog entry**

Record the sidebar parity feature, current Atelier/Pi reference SHAs, and the preserved footer/dashboard compatibility.

## Task 2: Run automated release gates

- [ ] **Step 1: Run the full repository checks**

```bash
mise exec node@24.15.0 -- pnpm check
mise exec node@24.15.0 -- pnpm pack:dry-run
git diff --check
```

Expected: all commands exit 0 and the package includes source, docs, license, README, and changelog without dependencies added.

- [ ] **Step 2: Commit release documentation**

```bash
git add LICENSE README.md CHANGELOG.md
git commit -m "docs: document current sidebar parity"
```

## Task 3: Complete the manual matrix

- [ ] **Step 1: Check responsive behavior**

Verify sidebar widths 39 and 40, terminal widths 91 and 92, 44-column default, exact-height output, height contraction, warning/error priority, panel order, hidden panels, unavailable configured panels, and contribution registration before/after pi-status startup.

- [ ] **Step 2: Check controls and lifecycle**

Verify `NO_COLOR`, active tool names, Sidebar tab reorder/save/failure, TODO collapse/clear/error behavior, dashboard centering beside the sidebar, keyboard/mouse resize, session tree replacement, fullscreen warning, and idempotent shutdown.

## Phase gate

All automated gates and manual checks pass; the implementation is release-ready.
