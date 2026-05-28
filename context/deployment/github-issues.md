# GitHub Issues — Roadmap Migration Plan

## Context

Roadmap (`context/foundation/roadmap.md`) zawiera 4 elementy (F-01, S-01, S-02, S-03) w statusie `ready`/`proposed` oraz 2 otwarte pytania. Przeniesione do GitHub Issues jako backlog widoczny dla osób spoza zespołu, z odwzorowanymi zależnościami między ticketami i pytaniami otwartymi jako `type:question`.

Repo: `ksepiolo/zero-waste-chef`

---

## Created Issues

| # | ID | Title | Labels | URL |
|---|-----|-------|--------|-----|
| #13 | F-01 | [F-01] Supabase: tabele products + recipes z RLS | `type:foundation`, `status:ready` | https://github.com/ksepiolo/zero-waste-chef/issues/13 |
| #14 | S-01 | [S-01] Inventory: dodaj produkt, oznacz at-risk, usuń | `type:slice`, `status:proposed` | https://github.com/ksepiolo/zero-waste-chef/issues/14 |
| #15 | S-02 | [S-02] Recipe loop: wygeneruj przepis AI → zatwierdź → usuń produkty | `type:slice`, `type:north-star`, `status:proposed` | https://github.com/ksepiolo/zero-waste-chef/issues/15 |
| #16 | S-03 | [S-03] Recipe history: lista zatwierdzonych przepisów | `type:slice`, `status:proposed` | https://github.com/ksepiolo/zero-waste-chef/issues/16 |
| #17 | Q-S02 | [Q] S-02: Jaki model OpenRouter i jak sformułować prompt do generowania przepisów? | `type:question`, `status:proposed` | https://github.com/ksepiolo/zero-waste-chef/issues/17 |
| #18 | Q-S03 | [Q] S-03: Co wyświetlać w liście przepisów? | `type:question`, `status:proposed` | https://github.com/ksepiolo/zero-waste-chef/issues/18 |

> **Note:** Repo miał już 12 istniejących issues — numeracja zaczęła się od #13, nie od #1. Prerequisites w ticketach używają poprawnych numerów (#13–#16).

---

## Dependency graph

```
#13 F-01 (ready)
 └─► #14 S-01
      └─► #15 S-02 ◄── #17 [Q] model/prompt
           └─► #16 S-03 ◄── #18 [Q] lista przepisów
```

---

## Issue format

```
Title:  [ID] <skrócony outcome jako capability statement>
Labels: <type:*>, status:<status>  [+ type:north-star dla S-02]

Body:
## Outcome
<pełny tekst outcome z roadmapy>

## PRD References
<PRD refs>

## Prerequisites
Depends on #N — <title>   (lub "Brak — to pierwszy krok.")

## Risk
<tekst risk z roadmapy>

## Roadmap
Change ID: `<change-id>` | Status: <status>
```
