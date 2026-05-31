---
project: "Zero Waste Chef"
version: 1
status: draft
created: 2026-05-27
updated: 2026-05-31
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Zero Waste Chef

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Użytkownik otwiera lodówkę i nie wie, co trzeba zużyć — ekspirujące produkty wymykają się uwadze (luka widoczności), a nawet gdy wie, że coś zaraz się popsuje, nie ma szybkiej drogi do "co z tym ugotować" (luka planowania). Aplikacja zamyka obie luki: śledzi zawartość lodówki z datami ważności, wyróżnia produkty "na wyczerpaniu" (wygasające w ciągu 3 dni od dzisiaj), i generuje przepis AI, który priorytetowo zużywa właśnie te produkty — żeby użytkownik mógł działać, a nie tylko martwić się. Bez AI produkt jest zwykłym trackerem; z nim zamyka ostatnią milę między "to zaraz się popsuje" a "oto co ugotować".

## North star

**S-02: Pętla generowania przepisu** — jeśli użytkownik może wygenerować przepis AI priorytetyzujący produkty "na wyczerpaniu" i zatwierdzić go tak, że produkty znikają z inwentarza, rdzeń produktu jest udowodniony i główna hipoteza PRD potwierdzona.

> Gwiazda przewodnia — najmniejszy przepływ od końca do końca (UI → logika → baza → AI → UI), który, jeśli zadziała, udowadnia że produkt ma rację bytu. Umieszczamy go jak najwcześniej, bo wszystko inne ma sens tylko jeśli on działa.

## At a glance

| ID   | Change ID              | Outcome (user can …)                                           | Prerequisites | PRD refs              | Status   |
|------|------------------------|----------------------------------------------------------------|---------------|-----------------------|----------|
| F-01 | data-schema            | (foundation) tabele products + recipes z RLS w Supabase       | —             | FR-004, FR-007, FR-009 | done     |
| S-01 | inventory-management   | dodać produkt, zobaczyć listę z oznaczeniem "at-risk", usunąć | F-01          | FR-001–FR-006         | proposed |
| S-02 | recipe-generation-loop | wygenerować przepis AI, zatwierdzić, usunąć produkty          | S-01, F-01    | FR-007–FR-009, US-01  | proposed |
| S-03 | recipe-history         | zobaczyć listę wcześniej zatwierdzonych przepisów              | S-02          | FR-010                | proposed |

## Baseline

Co jest już w kodzie na 2026-05-27 (auto-zbadane + potwierdzone przez użytkownika).
Foundations poniżej zakładają, że te warstwy są obecne i ich nie przebudowują.

- **Frontend:** present — Astro 6 SSR + React + Radix UI + Tailwind + shadcn/ui; strony auth w `src/pages/auth/`, szkielet dashboard w `src/pages/dashboard.astro`
- **Backend / API:** present — Astro 6 API routes; endpointy auth w `src/pages/api/auth/{signin,signup,signout}.ts`; middleware w `src/middleware.ts`
- **Data:** partial — klient Supabase w `src/lib/supabase.ts`; brak migracji i tabel (products, recipes nie istnieją)
- **Auth:** present — Supabase email+password; weryfikacja sesji w middleware; strony i API routes signin/signup/signout działają; FR-001, FR-002, FR-003 zaimplementowane
- **Deploy / infra:** present — Cloudflare Workers deployed (`zero-waste-chef.ksepiolo.workers.dev`); GitHub Actions CI wired; `wrangler.jsonc` poprawnie skonfigurowany z `nodejs_compat`
- **Observability:** absent — brak biblioteki logowania i error trackingu; Cloudflare built-in (`observability.enabled: true` w `wrangler.jsonc`) wystarczy na MVP

## Foundations

### F-01: Data schema

- **Outcome:** (foundation) tabele `products` i `recipes` w Supabase z Row Level Security — każdy użytkownik widzi i modyfikuje wyłącznie swoje dane; izolacja danych wymuszona na poziomie bazy, nie tylko w UI.
- **Change ID:** data-schema
- **PRD refs:** FR-004, FR-007, FR-009; NFR (izolacja danych na warstwie danych — "not accessible to any other user, including through direct URL construction or session manipulation")
- **Unlocks:** S-01 (inventory management potrzebuje tabeli `products`); S-02 (recipe generation loop potrzebuje tabel `products` i `recipes`); ścieżka weryfikacji guardrail "inventory consistency" z FR-009
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** sekwencjonowane pierwsze — każdy slice zależy od schematu; błąd tu (brak RLS, zły model danych) propaguje się do wszystkich warstw powyżej
- **Status:** done

## Slices

### S-01: Inventory management

- **Outcome:** użytkownik może dodać produkt (nazwa + data ważności) do inwentarza, zobaczyć pełną listę z wizualnym wyróżnieniem produktów "at-risk" — produktów wygasających w ciągu najbliższych 3 dni — i usunąć produkt manualnie.
- **Change ID:** inventory-management
- **PRD refs:** FR-004, FR-005, FR-006; FR-001, FR-002, FR-003 (zaimplementowane w baseline — slice wymaga zalogowanego użytkownika i opiera się na istniejącym auth flow)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** logika obliczania okna "at-risk" (3 dni od dzisiaj) musi żyć w jednym miejscu po stronie serwera — jeśli jest zduplikowana w endpoincie i w UI, może się rozjechać; to samo okno 3-day musi być użyte w S-02 przy generowaniu przepisu
- **Status:** proposed

### S-02: Recipe generation loop

- **Outcome:** użytkownik może zażądać przepisu AI priorytetyzującego produkty "at-risk" z inwentarza, zobaczyć ekran zatwierdzenia z przepisem i dokładną listą produktów do usunięcia, zatwierdzić — przepis zostaje zapisany, a wymienione produkty usunięte z inwentarza jako jedna atomowa operacja.
- **Change ID:** recipe-generation-loop
- **PRD refs:** FR-007, FR-008, FR-009, US-01
- **Prerequisites:** S-01, F-01
- **Parallel with:** —
- **Blockers:** Workers Paid plan ($5/month na Cloudflare) musi być aktywny przed deployem tego endpointu na produkcję — Free tier limit 10 ms CPU jest zbyt niski dla parsowania odpowiedzi OpenRouter + logiki biznesowej (obliczenie at-risk window, zbudowanie listy produktów do usunięcia)
- **Unknowns:**
  - Jaki model OpenRouter i jak sformułować prompt, żeby przepis był praktycznie użyteczny (NFR: common home-cooking techniques)? — Owner: user. Block: no.
- **Risk:** atomowość zatwierdzenia (guardrail FR-009: usunięcie produktów i zapis przepisu muszą się udać lub nie udać razem — ciche niespójności inwentarza są niedopuszczalne); ekran zatwierdzenia jest kontraktem — co pokazuje, to dokładnie to usuwa
- **Status:** proposed

### S-03: Recipe history

- **Outcome:** użytkownik może zobaczyć listę wcześniej zatwierdzonych przepisów posortowaną od najnowszej do najstarszej.
- **Change ID:** recipe-history
- **PRD refs:** FR-010
- **Prerequisites:** S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Co wyświetlać w liście: tylko tytuł, tytuł + składniki, czy pełne instrukcje? — Owner: user. Block: no (może być zdecydowane podczas implementacji per PRD Open Question 3).
- **Risk:** pierwsze do odcięcia pod presją deadline'u — PRD §Recipe Generation wprost to zaznacza: "if timeline pressure appears, this is the first candidate to cut"; jeśli brakuje czasu, FR-010 jedzie w v2
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title                                  | Ready for `/10x-plan` | Notes                              |
|------------|------------------------|--------------------------------------------------------|-----------------------|------------------------------------|
| F-01       | data-schema            | Supabase: schema products + recipes z RLS              | yes                   | Uruchom `/10x-plan data-schema`    |
| S-01       | inventory-management   | Inventory: add / view (at-risk flag) / delete products | no                    | Czeka na F-01                      |
| S-02       | recipe-generation-loop | Recipe loop: generate → approve → remove (AI)          | no                    | Czeka na S-01 + Workers Paid plan  |
| S-03       | recipe-history         | Recipe history: lista zatwierdzonych przepisów         | no                    | Czeka na S-02; pierwsze do odcięcia |

## Open Roadmap Questions

1. **Co wyświetlać w liście przepisów?** Tylko tytuł, tytuł + składniki, czy pełne instrukcje? — Owner: user. Block: no (dotyczy S-03; może być zdecydowane podczas implementacji).

## Parked

- **Edycja produktu** — Why parked: PRD §Non-Goals; poprawka wymaga delete + add w MVP.
- **Śledzenie ilości** — Why parked: PRD §Non-Goals; produkty są obecne lub nieobecne, bez gramów/ml.
- **Powiadomienia** — Why parked: PRD §Non-Goals; użytkownik musi sam otworzyć aplikację.
- **Skanowanie kodów kreskowych / paragonów** — Why parked: PRD §Non-Goals; wpis tylko tekstowy.
- **Wyszukiwanie i filtrowanie** — Why parked: PRD §Non-Goals; listy w naturalnej kolejności.
- **Udostępnianie między kontami** — Why parked: PRD §Non-Goals; inwentarz ściśle jednokonty.
- **Wsparcie offline** — Why parked: PRD §Non-Goals; aplikacja wymaga połączenia.
- **Osobna strona szczegółów przepisu** — Why parked: PRD §Non-Goals; treść widoczna w liście i na ekranie zatwierdzenia.

## Done

- **F-01: (foundation) tabele products + recipes z RLS w Supabase** — Archived 2026-05-31 → `context/archive/2026-05-31-data-schema/`. Lesson: —.
