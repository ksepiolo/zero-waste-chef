---
title: "Zero Waste Chef — niezmiennik rdzeniowy i agregat-strażnik"
created: 2026-08-29
type: refactor-plan
---

# Niezmiennik #1 i agregat-strażnik — plan refaktoru

> Produktem tego dokumentu jest **plan**, nie kod. Nie zmodyfikowano ani jednego
> pliku produkcyjnego. Wszystkie cytaty `plik:linia` odnoszą się do gałęzi
> `feature/ddd-m4m5` (HEAD `c8ede96`, 2026-08-29) i zostały zweryfikowane
> odczytem plików. Dokument kontynuuje `context/domain/01-domain-distillation.md`,
> ale identyfikację i wybór przeprowadzono od nowa, z kodu i dokumentów.

---

## KROK 0 — Kontekst

### Dokumenty źródłowe (odczytane)

| Dokument                                   | Co z niego biorę                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context/foundation/prd.md`                | Success Criteria (`:30-42`), User Stories (`:46-57`), FR-001…FR-010, Business Logic (`:110-118`), Access Control (`:122-124`), Non-Goals (`:128-136`) |
| `context/foundation/test-plan.md`          | Mapa ryzyk §2 — w szczególności Ryzyko #3 (atomowość) i #5 (tożsamość zbioru)                                                                         |
| `context/foundation/lessons.md`            | Reguła: filtr `user_id` w warstwie aplikacji **obok** RLS                                                                                             |
| `CLAUDE.md`                                | Twarde reguły: `prerender = false`, RLS + polityka per rola, zod na wejściu, konwencje nazw plików                                                    |
| `context/domain/01-domain-distillation.md` | Poprzedni krok — mapa domeny, ranking kandydatów na agregaty                                                                                          |

### Stack i warstwy, w których żyje logika biznesowa

Astro 6 w trybie `output: "server"`, wyspy React, Supabase (Postgres + RLS +
funkcja plpgsql), deployment na Cloudflare Workers. Testy: Vitest (unit +
jedna integracja przeciw lokalnej bazie), Playwright (E2E), Stryker
(mutacyjne, selektywnie).

| Warstwa             | Pliki                                                                                           | Jaką logikę domenową dziś niesie                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| UI (wyspa React)    | `src/components/inventory/inventory-panel.tsx`, `src/components/hooks/use-recipe-generation.ts` | **Dużo**: przechowuje propozycję przepisu, wylicza zbiór „do usunięcia", uzgadnia różnicę po zatwierdzeniu |
| Strona SSR          | `src/pages/inventory.astro`, `src/pages/recipes.astro`                                          | Ładowanie początkowe; `recipes.astro:9-12` niesie decyzję domenową (migawka jednokierunkowa)               |
| API route           | `src/pages/api/recipes/{generate,approve}.ts`, `src/pages/api/products/*`                       | Autoryzacja, walidacja zod, mapowanie błędów; `generate.ts:54-83` niesie dwie reguły produktowe            |
| Serwis              | `src/lib/services/{recipe,product}.service.ts`                                                  | Klasyfikacja wygasania, budowa promptu, **weryfikacja odpowiedzi modelu**                                  |
| Persystencja        | `supabase/migrations/*.sql`                                                                     | RLS, funkcja `approve_recipe` = jedyna transakcja w systemie                                               |
| **Domena (osobna)** | **brak**                                                                                        | **Nie istnieje żaden moduł domenowy — logika mieszka w czterech pozostałych warstwach**                    |

Wniosek KROKU 0: w projekcie **nie ma warstwy domenowej**. To nie jest samo
w sobie wadą przy tej skali; staje się nią dokładnie tam, gdzie reguła musi
być egzekwowana w więcej niż jednym miejscu.

---

## KROK 1 — Niezmienniki biznesowe

Wyprowadzone z dokumentów **oraz** z kodu (część reguł istnieje wyłącznie
w kodzie — zaznaczam to jawnie).

| #        | Niezmiennik                                                                                                                    | Źródło                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **N-01** | Jeśli w inwentarzu są produkty at-risk, wygenerowany przepis **musi** użyć co najmniej jednego z nich.                         | `prd.md:32`, `prd.md:89` (FR-007), `prd.md:112-116`                         |
| **N-02** | **Zbiór produktów usuwanych przy zatwierdzeniu jest tym zbiorem, który system pokazał — pochodzi od systemu, nie od klienta.** | `prd.md:33`, `prd.md:42` („the approval screen is a contract"), `prd.md:55` |
| **N-03** | Zapis przepisu i usunięcie produktów udają się razem albo nie udają się razem.                                                 | `prd.md:97` (FR-009), `test-plan.md` §2 Ryzyko #3                           |
| **N-04** | Baza nigdy nie usuwa **więcej**, niż pokazał ekran; niedomknięcie jest raportowane wywołującemu, nie ukrywane.                 | `prd.md:42`                                                                 |
| **N-05** | Zapisany przepis jest tym przepisem, który wygenerował model — tytuł, składniki, kroki nie są podmienialne.                    | `prd.md:50` (US-01), `prd.md:93` (FR-008)                                   |
| **N-06** | Przepis nie zostaje zapisany, jeśli nie skonsumował ani jednego produktu.                                                      | `prd.md:97` — „removes the listed products **and** saves the recipe"        |
| **N-07** | Dane produktów i przepisów są ściśle związane z kontem; inny użytkownik nie odczyta ich ani nie zmieni.                        | `prd.md:41`, `prd.md:108`, `prd.md:124`                                     |
| **N-08** | Produkt przeterminowany nie trafia do modelu i nie wchodzi do zbioru at-risk; użytkownik jest o wykluczeniu poinformowany.     | **reguła powstała w kodzie** — `generate.ts:62-83`, `prd.md` jej nie zna    |
| **N-09** | Produkt jest w dokładnie jednym z trzech stanów: `expired` \| `at-risk` \| `safe`.                                             | **reguła kodu** — `product.service.ts:32-49`, `src/types.ts:11-13`          |
| **N-10** | Model może wskazać wyłącznie identyfikatory z inwentarza wysłanego w promptcie.                                                | wynika z `prd.md:33`; w kodzie `recipe.service.ts:213-219`                  |
| **N-11** | Generowanie nigdy nie jest blokowane stanem at-risk — puste okno at-risk to nie błąd.                                          | `prd.md:118`                                                                |
| **N-12** | Żaden surowy komunikat upstreamu (model, PostgREST) nie dociera do użytkownika.                                                | `lessons.md`, `test-plan.md` §2 Ryzyko #6; w kodzie `service-error.ts:1-46` |
| **N-13** | `consumed_products` to migawka jednokierunkowa — użytkownik nie może jej zrekonstruować, więc nie wolno jej zmienić.           | `recipes.astro:9-12` (jawna decyzja), `src/types.ts:23-26`                  |
| **N-14** | Produktu się nie edytuje — poprawka to usunięcie i ponowne dodanie.                                                            | `prd.md:128`                                                                |
| **N-15** | Żądanie nieuwierzytelnione do trasy chronionej → przekierowanie; do API → 401.                                                 | `prd.md:124`; w kodzie `middleware.ts:18-22` + strażnik w każdym endpoincie |
| **N-16** | Data ważności dodawanego produktu nie jest w przeszłości.                                                                      | **reguła kodu** — `api/products/index.ts:10-13`, brak w `prd.md`            |

---

## KROK 2 — Klasyfikacja i wybór #1

Trzy osie, zgodnie z poleceniem:
**(a) rdzeniowość** — czy reguła realizuje cel produktu z `prd.md:20-24`
(„Existing solutions stop at the warning… This product closes that gap") i
kryteria sukcesu `prd.md:30-42`.
**(b) rozsmarowanie** — w ilu warstwach/plikach dziś żyje.
**(c) egzekucja** — `EGZEKWOWANY` (kod uniemożliwia złamanie) / `DEKLAROWANY`
(kod zakłada, ale nie wymusza) / `NARUSZALNY` (istnieje ścieżka złamania).

| #        | (a) Rdzeniowość                                                              | (b) Rozsmarowanie                                                                                                 | (c) Egzekucja                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N-01** | **Maks.** — to kryterium sukcesu #1 (`prd.md:32`) i cała przewaga produktu   | 3 warstwy: `product.service.ts:42-49` (klasyfikacja), `recipe.service.ts:104-128` (prompt), `:224-231` (kontrola) | **EGZEKWOWANY na ścieżce generowania, NIEOBECNY na ścieżce zapisu** — patrz N-02                                                                    |
| **N-02** | **Maks.** — to kryterium sukcesu #2 (`prd.md:33`) i guardrail (`prd.md:42`)  | **5 warstw**: UI, hook, endpoint, serwis, SQL — i w żadnej nie ma reprezentacji „tego, co pokazano"               | **NARUSZALNY** — jedyną obroną jest własność wiersza w SQL; zbiór przychodzi z klienta                                                              |
| **N-03** | Wysoka — bez niej N-02 nie ma znaczenia                                      | 1 warstwa (funkcja plpgsql)                                                                                       | **EGZEKWOWANY** — `…report_deleted.sql:8-34` to jedna funkcja = jedna transakcja                                                                    |
| **N-04** | Wysoka                                                                       | 3 warstwy: SQL `:24-30`, serwis `:276-279`, UI `inventory-panel.tsx:71-79`                                        | **EGZEKWOWANY połowicznie** — „nigdy więcej" tak; „luka raportowana" degraduje się do toastu, nie do błędu                                          |
| **N-05** | Wysoka — US-01 mówi „a recipe **is saved**", domyślnie: ten przepis          | 3 warstwy (hook → endpoint → SQL), zero kontroli po drodze                                                        | **NARUSZALNY** — `approve.ts:9-14` przyjmuje dowolny tytuł/składniki/kroki                                                                          |
| **N-06** | Średnio-wysoka — wynika z koniunkcji w FR-009                                | 0 warstw (nigdzie nie sprawdzana)                                                                                 | **NARUSZALNY** — `INSERT` w `…report_deleted.sql:20-22` jest bezwarunkowy                                                                           |
| **N-07** | Wysoka (guardrail `prd.md:41`), ale **generic** — nie jest przewagą produktu | 2 warstwy, świadomie zduplikowane wg `lessons.md`                                                                 | **EGZEKWOWANY** dwuwarstwowo: RLS `initial_schema.sql:19-31` + filtr `product.service.ts:55`, `:96-97`                                              |
| **N-08** | Średnia — wsparcie dla N-01                                                  | 2 warstwy: `generate.ts:67-83`, UI `inventory-panel.tsx:82-84`                                                    | **EGZEKWOWANY**                                                                                                                                     |
| **N-09** | Średnia                                                                      | 1 punkt wyprowadzenia (`classifyExpiry`) + UI                                                                     | **EGZEKWOWANY przy odczycie**, nieznany bazie                                                                                                       |
| **N-10** | Średnia — techniczny fundament N-02                                          | 1 warstwa                                                                                                         | **EGZEKWOWANY** — `recipe.service.ts:213-219`                                                                                                       |
| **N-11** | Średnia                                                                      | 1 warstwa                                                                                                         | **EGZEKWOWANY z dwoma świadomymi wyjątkami** (`generate.ts:58-60`, `:78-83`)                                                                        |
| **N-12** | Średnia (jakość, nie sens produktu)                                          | wiele endpointów                                                                                                  | **NIESPÓJNY** — `service-error.ts` przestrzegany w `generate.ts:95-97` i `approve.ts:49-51`, ale `api/products/index.ts:31-34` odsyła `err.message` |
| **N-13** | Niska-średnia                                                                | 2 warstwy                                                                                                         | **DEKLAROWANY** — `recipes_update_authenticated` (`initial_schema.sql:73-76`) pozwala na UPDATE                                                     |
| **N-14** | Niska (non-goal)                                                             | brak endpointu                                                                                                    | **DEKLAROWANY** — `products_update_authenticated` (`initial_schema.sql:25-28`) pozwala na UPDATE                                                    |
| **N-15** | Wysoka, ale **generic**                                                      | 2 warstwy                                                                                                         | **EGZEKWOWANY**                                                                                                                                     |
| **N-16** | Niska                                                                        | 2 warstwy (zod + `min` w `inventory-panel.tsx:191`)                                                               | **DEKLAROWANY** — brak `CHECK` w `initial_schema.sql:4-10`                                                                                          |

### Wybór: **N-02** — „zbiór usuwanych produktów pochodzi od systemu, nie od klienta"

Kryterium wyboru było: **jednocześnie najbardziej rdzeniowy i najsłabiej
egzekwowany**. Tylko N-02 zajmuje skrajny punkt na obu osiach naraz.

Uzasadnienie:

1. **Rdzeniowość jest dosłowna, nie interpretacyjna.** `prd.md:33` to zdanie
   o tej regule i o niczym innym: „The database state after approval matches
   exactly what the approval screen displayed." `prd.md:42` nadaje jej status
   kontraktu, a `prd.md:93-95` (FR-008) uzasadnia istnienie całego ekranu
   zatwierdzenia jako „mechanizmu zaufania i bezpieczeństwa".
2. **To jedyny nieodwracalny skutek w systemie.** Zatwierdzenie kasuje wiersze.
   `prd.md:128` (non-goal „No product editing") oznacza, że naprawa po błędnym
   usunięciu to ręczne wpisanie produktu od nowa. Koszt złamania tego
   niezmiennika jest asymetrycznie wysoki wobec każdego innego z listy.
3. **Egzekucja jest zerowa, nie słaba.** Nie ma serwerowej reprezentacji „tego,
   co pokazano". Serwer nie ma **z czym** porównać przychodzącego zbioru — więc
   nie chodzi o lukę w walidacji, tylko o brak bytu. To odróżnia N-02 od N-13,
   N-14 i N-16, gdzie luka jest wąska i punktowa.
4. **Naprawa N-02 zamyka przy okazji N-05 i N-06 oraz przywraca N-01 w punkcie
   zapisu.** Wszystkie cztery tracą punkt egzekucji w tym samym miejscu i z tego
   samego powodu. Żaden inny niezmiennik nie ma takiej dźwigni.

Dlaczego **nie** N-01, choć jest równie rdzeniowy: jest realnie egzekwowany
tam, gdzie powstaje (`recipe.service.ts:224-231`), i to jest właściwe miejsce.
Jego problem — brak kontroli w punkcie zapisu — jest **podzbiorem** problemu
N-02 i zostaje rozwiązany razem z nim.

Dlaczego **nie** N-07 ani N-15: rdzeniowe dla bezpieczeństwa, ale egzekwowane
dwuwarstwowo i podparte testami (`test-plan.md` §2 Ryzyko #4, faza zamknięta
w `context/changes/testing-data-isolation-input-trust/`). Wysoka wartość,
niskie ryzyko → nie kwalifikują się.

Niezależne potwierdzenie z innego artefaktu: `test-plan.md:71` (Ryzyko #5)
formułuje dokładnie to pytanie — „Whether the approve endpoint re-derives the
set server-side or accepts a client-supplied list" — i notuje mit do obalenia:
„The client sends what we sent it."

---

## KROK 3 — Diagnoza N-02

### Gdzie dziś żyje reguła

**Warstwa 1 — UI. Tu powstaje „to, co pokazano".**

`src/components/inventory/inventory-panel.tsx:384-390`:

```tsx
<AlertDialogDescription>
  Will remove from inventory:{" "}
  {products
    .filter((p) => recipe?.used_product_ids.includes(p.id))
    .map((p) => p.name)
    .join(", ")}
</AlertDialogDescription>
```

Zbiór pokazany użytkownikowi to **przecięcie** `recipe.used_product_ids`
z lokalnym stanem `products` (`:62`). Zbiór wysyłany do serwera to
`recipe.used_product_ids` **bez przecięcia**. To są dwa różne zbiory i nic
w kodzie nie wymusza ich równości: produkt spoza lokalnego stanu nie pojawi się
w napisie, a mimo to zostanie skasowany.

**Warstwa 2 — hook. Tu propozycja żyje i tu jest tracona.**

`src/components/hooks/use-recipe-generation.ts:29` — cała propozycja to stan
Reacta:

```ts
const [recipe, setRecipe] = useState<GeneratedRecipe | null>(null);
```

`:92-97` — przy zatwierdzeniu klient odsyła **całą treść z własnej pamięci**:

```ts
body: JSON.stringify({
  title: current.title,
  ingredients: current.ingredients,
  instructions: current.instructions,
  usedProductIds: current.used_product_ids,
}),
```

`:104-108` — uzgodnienie różnicy również dzieje się po stronie klienta:

```ts
const { deletedIds } = (await res.json()) as { deletedIds: string[] };
const skippedIds = current.used_product_ids.filter((id) => !deletedIds.includes(id));
onApproveSuccess?.(deletedIds, skippedIds);
```

**Warstwa 3 — endpoint. Waliduje kształt, nie tożsamość.**

`src/pages/api/recipes/approve.ts:9-14`:

```ts
const approveRecipeSchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.string()).min(1),
  instructions: z.array(z.string()).min(1),
  usedProductIds: z.array(z.uuid()).min(1),
});
```

Schemat przepuszcza dowolny tytuł, dowolne składniki, dowolne kroki i dowolną
listę UUID-ów. `:39` przekazuje `result.data` do serwisu bez żadnego
odniesienia do czegokolwiek, co system wcześniej wygenerował.

**Warstwa 4 — serwis. Czysty pass-through.**

`src/lib/services/recipe.service.ts:260-269` — `approveRecipe` wywołuje RPC
z tym, co dostał; jedyna transformacja to `instructions.join("\n")` (`:267`).

**Warstwa 5 — SQL. Jedyny realny strażnik: własność wiersza.**

`supabase/migrations/20260816120000_approve_recipe_report_deleted.sql:14-32`:

```sql
SELECT jsonb_agg(...) INTO v_consumed_products
FROM products WHERE id = ANY(p_used_product_ids) AND user_id = auth.uid();

INSERT INTO recipes (...) VALUES (auth.uid(), p_title, ...) RETURNING id INTO v_recipe_id;

WITH deleted AS (
  DELETE FROM products WHERE id = ANY(p_used_product_ids) AND user_id = auth.uid()
  RETURNING id
) SELECT COALESCE(array_agg(id), '{}') INTO v_deleted_ids FROM deleted;
```

Warunek `user_id = auth.uid()` chroni N-07, nie N-02. Wobec **własnych**
produktów użytkownika funkcja nie ma żadnego pojęcia o tym, co pokazano.

**Warstwa 6 — ścieżka generowania. Tu dowód powstaje i tu jest wyrzucany.**

`recipe.service.ts:213-219` weryfikuje przynależność id do promptu (N-10),
`:224-231` weryfikuje at-risk floor (N-01). `generate.ts:85-89` zwraca wynik
klientowi — i **nic z tej weryfikacji nie zostaje po stronie serwera**.
Po zwróceniu odpowiedzi dowód przestaje istnieć.

### Werdykt po warstwach

| Warstwa     | Rola wobec N-02                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| UI          | **Jedyny strażnik.** Zbiór jest pokazywany i wysyłany z tego samego miejsca — i to jest cała „egzekucja" reguły |
| Hook        | Jedyny magazyn propozycji. Odświeżenie strony gubi kontrakt bez śladu                                           |
| Endpoint    | **Nie egzekwuje.** Waliduje kształt UUID, nie pochodzenie                                                       |
| Serwis      | **Nie egzekwuje.** Pass-through                                                                                 |
| SQL         | Egzekwuje **N-07** (własność), nie N-02. Chroni przed cudzym produktem, nie przed własnym niepokazanym          |
| Generowanie | Egzekwuje N-01 i N-10 na wyjściu modelu — i natychmiast traci ten wynik                                         |

### Cztery konkretne ścieżki złamania

1. **Zbiór szerszy niż pokazany.** `POST /api/recipes/approve` z listą własnych
   id, których żaden ekran nie pokazał → 200 i skasowane produkty.
   `prd.md:128` czyni to nieodwracalnym.
2. **Treść niezwiązana z modelem (N-05).** Tytuł, składniki i kroki mogą być
   dowolne — historia z `prd.md:100` (FR-010) nie ma gwarancji, że opisuje to,
   co system zasugerował.
3. **Przepis bez konsumpcji (N-06).** Gdy wszystkie id są nieaktualne,
   `v_consumed_products` jest `NULL`, `COALESCE(..., '[]'::JSONB)`
   (`…report_deleted.sql:21`) domyka to do pustej tablicy, `INSERT` wykonuje się
   mimo to, `deleted_ids` wraca puste — a endpoint odpowiada **200**
   (`approve.ts:40-43`). Powstaje wpis w historii, który nic nie skonsumował.
4. **At-risk floor nie obowiązuje przy zapisie (N-01).** Ścieżka zatwierdzenia
   nie zna pojęcia at-risk. Kryterium sukcesu #1 jest sprawdzane wyłącznie
   w punkcie sugestii, nigdy w punkcie trwałego skutku.

### Gdzie błąd jest „połykany" zamiast zatrzymywać operację

- **`inventory-panel.tsx:71-79`** — niedomknięcie zbioru (produkt pokazany, ale
  nieusunięty) kończy się `toast.info("Already removed elsewhere: …")`.
  Informacyjnym, nie błędem. Operacja jest już zatwierdzona i nieodwracalna;
  transakcja się dokonała, przepis zapisany. To jest dokładnie wzorzec
  „loguj i jedź dalej", którego ograniczenia tego zadania zakazują.
- **`…report_deleted.sql:24-30`** — zero usunięć jest normalnym wynikiem;
  nic nie porównuje `array_length(v_deleted_ids, 1)` z
  `array_length(p_used_product_ids, 1)`.
- **`approve.ts:38-43`** — brak jakiegokolwiek rozróżnienia między
  zatwierdzeniem pełnym a częściowym; oba dają 200.

Uwaga terminologiczna: `prd.md:33` mówi „matches **exactly**", `prd.md:42`
mówi „never removes **more** … that gap is reported back". To dwa różne
kontrakty w tym samym pliku. Rozstrzygnięcie jest warunkiem wstępnym refaktoru
— patrz Faza 0.

---

## KROK 4 — Projekt agregatu-strażnika

### 4.1 Nazwa i granica

**`RecipeSuggestion` (pol. „propozycja przepisu")** — byt między
„wygenerowane" a „zatwierdzone". Dziś nie ma nazwy ani w dokumentach, ani
w kodzie, i właśnie jego brak jest przyczyną diagnozy z KROKU 3.

- **Korzeń agregatu:** `RecipeSuggestion`.
- **Wewnątrz granicy:** treść przepisu (tytuł, składniki, kroki), zbiór
  `usedProductIds`, migawka `atRiskProductIds` z chwili generowania, status,
  właściciel, czas wygaśnięcia.
- **Poza granicą (referencje po id):** `Product` (należy do agregatu
  `Inventory`), `Recipe` (powstaje jako skutek zatwierdzenia).
- **Reguła nadrzędna:** zatwierdzenie przyjmuje **wyłącznie identyfikator
  propozycji**. Zbiór id i treść przepisu przestają przekraczać granicę
  klient→serwer.

### 4.2 Model persystencji

Rozważane były dwa warianty: (a) podpisany token przekazywany klientowi,
(b) utrwalona propozycja w bazie. **Wybieram (b)**: jednorazowość
(`pending → approved` dokładnie raz) wymaga stanu po stronie serwera, więc
token i tak musiałby być podparty tabelą; przy tabeli sam token przestaje
cokolwiek wnosić.

```sql
-- supabase/migrations/YYYYMMDDHHmmss_recipe_suggestions.sql

CREATE TYPE suggestion_status AS ENUM ('pending', 'approved', 'discarded');

CREATE TABLE recipe_suggestions (
  id                   UUID              DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID              NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                TEXT              NOT NULL,
  ingredients          TEXT[]            NOT NULL,
  instructions         TEXT              NOT NULL,
  used_product_ids     UUID[]            NOT NULL,
  -- Migawka, nie zapytanie: at-risk floor sprawdzany przy zatwierdzeniu musi
  -- czytać stan z chwili generowania, nie ponownie odczytywać zegara.
  at_risk_product_ids  UUID[]            NOT NULL,
  status               suggestion_status NOT NULL DEFAULT 'pending',
  approved_recipe_id   UUID              REFERENCES recipes(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ       NOT NULL,
  CONSTRAINT used_products_non_empty CHECK (cardinality(used_product_ids) > 0)
);

CREATE INDEX recipe_suggestions_user_status_idx
  ON recipe_suggestions(user_id, status, created_at DESC);

ALTER TABLE recipe_suggestions ENABLE ROW LEVEL SECURITY;

-- Zgodnie z CLAUDE.md: osobna polityka na operację i na rolę, bez USING (true).
CREATE POLICY "recipe_suggestions_select_authenticated" ON recipe_suggestions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "recipe_suggestions_insert_authenticated" ON recipe_suggestions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
-- Świadomie BRAK polityki UPDATE dla authenticated: przejście stanu należy
-- wyłącznie do funkcji approve_suggestion (SECURITY DEFINER), nie do klienta.
CREATE POLICY "recipe_suggestions_delete_authenticated" ON recipe_suggestions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "recipe_suggestions_select_anon"  ON recipe_suggestions FOR SELECT TO anon USING (false);
CREATE POLICY "recipe_suggestions_insert_anon"  ON recipe_suggestions FOR INSERT TO anon WITH CHECK (false);
CREATE POLICY "recipe_suggestions_update_anon"  ON recipe_suggestions FOR UPDATE TO anon USING (false);
CREATE POLICY "recipe_suggestions_delete_anon"  ON recipe_suggestions FOR DELETE TO anon USING (false);
```

### 4.3 Moduł domenowy — sygnatury i pseudokod

Nowy katalog `src/lib/domain/` (dziś nie istnieje; `src/lib/services/` zostaje
warstwą I/O). Nazwy plików wg konwencji z `CLAUDE.md` — kebab-case
z sufiksem typu.

**`src/lib/domain/recipe-suggestion.error.ts`**

```ts
export type DomainErrorKind =
  | "suggestion_not_found" // 404 — także dla cudzej propozycji: nie potwierdzamy istnienia
  | "suggestion_already_resolved" // 409 — jednorazowość
  | "suggestion_expired" // 410 — po TTL
  | "suggestion_stale" // 409 — pokazany produkt zniknął pod ekranem
  | "empty_consumption" // 422 — N-06
  | "at_risk_floor_violated" // 422 — N-01
  | "unknown_product_in_suggestion"; // 422 — N-10

// Ta sama dyscyplina co service-error.ts:31-46: status i bezpieczny komunikat
// pochodzą z jednej tabeli, więc klasa nie może istnieć bez tekstu, który
// wolno pokazać. N-12 pozostaje strukturalne.
export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  readonly status: number;
  constructor(kind: DomainErrorKind, options?: ErrorOptions) {
    /* … */
  }
}
```

**`src/lib/domain/recipe-suggestion.ts`** — czysty, bez I/O, bez `astro:env`.

```ts
export type SuggestionStatus = "pending" | "approved" | "discarded";

export interface RecipeSuggestionState {
  id: string;
  userId: string;
  title: string;
  ingredients: string[];
  instructions: string[];
  usedProductIds: string[];
  atRiskProductIds: string[];
  status: SuggestionStatus;
  expiresAt: Date;
}

export const SUGGESTION_TTL_MINUTES = 30;

export class RecipeSuggestion {
  private constructor(private readonly state: RecipeSuggestionState) {}

  /**
   * Jedyna droga powstania propozycji. Preconditions egzekwują N-06, N-10 i N-01
   * *zanim* cokolwiek zostanie utrwalone.
   */
  static propose(input: {
    userId: string;
    generated: GeneratedRecipe;
    inventorySnapshot: ProductWithRisk[]; // dokładnie to, co poszło do promptu
    now: Date;
  }): RecipeSuggestion {
    const used = dedupe(input.generated.used_product_ids);

    // N-06 — propozycja, która niczego nie konsumuje, nie ma prawa powstać.
    if (used.length === 0) throw new DomainError("empty_consumption");

    // N-10 — id spoza migawki unieważnia całą propozycję (fail-fast, nie filtrowanie:
    // odfiltrowanie obcego id po cichu zmieniłoby zbiór, który zobaczy użytkownik).
    const known = new Set(input.inventorySnapshot.map((p) => p.id));
    if (!used.every((id) => known.has(id))) throw new DomainError("unknown_product_in_suggestion");

    // N-01 — at-risk floor egzekwowany w domenie, nie w adapterze providera.
    const atRisk = input.inventorySnapshot.filter((p) => p.is_at_risk).map((p) => p.id);
    if (atRisk.length > 0 && !used.some((id) => atRisk.includes(id))) {
      throw new DomainError("at_risk_floor_violated");
    }

    return new RecipeSuggestion({
      id: crypto.randomUUID(),
      userId: input.userId,
      title: input.generated.title,
      ingredients: input.generated.ingredients,
      instructions: input.generated.instructions,
      usedProductIds: used,
      atRiskProductIds: atRisk,
      status: "pending",
      expiresAt: new Date(input.now.getTime() + SUGGESTION_TTL_MINUTES * 60_000),
    });
  }

  /** Odtworzenie z wiersza — bez walidacji reguł tworzenia (te już przeszły). */
  static rehydrate(row: RecipeSuggestionRow): RecipeSuggestion;

  /**
   * Preconditions zatwierdzenia. NIE mutuje bazy — decyduje, czy transakcja
   * ma prawo się odbyć, i zwraca dokładny zbiór do usunięcia.
   * Nielegalne przejście rzuca nazwany błąd; nie ma wariantu „zwróć false".
   */
  approveWith(input: { requestedBy: string; now: Date }): { productIdsToDelete: string[] } {
    if (this.state.userId !== input.requestedBy) throw new DomainError("suggestion_not_found");
    if (this.state.status !== "pending") throw new DomainError("suggestion_already_resolved");
    if (input.now >= this.state.expiresAt) throw new DomainError("suggestion_expired");

    // N-01 sprawdzany ponownie w punkcie zapisu — ale wobec MIGAWKI, nie zegara.
    // Produkt, który przez te 30 minut stał się `expired`, nie unieważnia
    // decyzji, którą użytkownik już zobaczył.
    if (
      this.state.atRiskProductIds.length > 0 &&
      !this.state.usedProductIds.some((id) => this.state.atRiskProductIds.includes(id))
    ) {
      throw new DomainError("at_risk_floor_violated");
    }

    return { productIdsToDelete: [...this.state.usedProductIds] };
  }

  discard(): void {
    /* pending → discarded; z innego stanu → suggestion_already_resolved */
  }

  get shownProducts(): string[] {
    return [...this.state.usedProductIds];
  }
}
```

Co się tu zmienia względem dziś: `recipe.service.ts:213-231` traci rolę
strażnika reguł domenowych i zostaje **adapterem providera** — parsuje
odpowiedź, egzekwuje schemat i klasy awarii (`ServiceError`), a decyzję
„czy ta propozycja ma prawo istnieć" podejmuje `propose`. Adapter przestaje
znać pojęcie at-risk.

### 4.4 Repozytorium

**`src/lib/services/recipe-suggestion.repository.ts`**

```ts
export interface RecipeSuggestionRepository {
  save(suggestion: RecipeSuggestion): Promise<void>; // INSERT, status pending
  load(id: string, userId: string): Promise<RecipeSuggestion>; // brak wiersza → DomainError("suggestion_not_found")
  /**
   * Jedno wywołanie RPC = jedna transakcja. Repozytorium nie składa skutku
   * z kilku zapytań PostgREST, bo N-03 nie da się w ten sposób utrzymać.
   */
  commitApproval(id: string, userId: string): Promise<{ recipeId: string; deletedIds: string[] }>;
}
```

`load` chaininguje `.eq("user_id", userId)` **obok** RLS — reguła
z `lessons.md`.

### 4.5 Transakcja — jedna funkcja plpgsql

```sql
CREATE FUNCTION public.approve_suggestion(p_suggestion_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s              recipe_suggestions%ROWTYPE;
  v_consumed       JSONB;
  v_recipe_id      UUID;
  v_deleted_ids    UUID[];
BEGIN
  -- Blokada wiersza domyka jednorazowość wobec dwóch równoczesnych żądań:
  -- drugie czeka i widzi już status 'approved'.
  SELECT * INTO v_s FROM recipe_suggestions
   WHERE id = p_suggestion_id AND user_id = auth.uid()
   FOR UPDATE;

  IF NOT FOUND                      THEN RAISE EXCEPTION 'suggestion_not_found'        USING ERRCODE = 'P0002'; END IF;
  IF v_s.status <> 'pending'        THEN RAISE EXCEPTION 'suggestion_already_resolved' USING ERRCODE = 'P0001'; END IF;
  IF v_s.expires_at <= NOW()        THEN RAISE EXCEPTION 'suggestion_expired'          USING ERRCODE = 'P0003'; END IF;

  SELECT jsonb_agg(jsonb_build_object('name', name, 'expiry_date', expiry_date::TEXT))
    INTO v_consumed
    FROM products
   WHERE id = ANY(v_s.used_product_ids) AND user_id = auth.uid();

  WITH deleted AS (
    DELETE FROM products
     WHERE id = ANY(v_s.used_product_ids) AND user_id = auth.uid()
     RETURNING id
  ) SELECT COALESCE(array_agg(id), '{}') INTO v_deleted_ids FROM deleted;

  -- SERCE N-02: usunięto dokładnie to, co pokazano — albo nic.
  -- Wyjątek wycofuje całą transakcję: żadnego przepisu-sieroty,
  -- żadnego częściowo opróżnionego inwentarza, żadnego toastu zamiast błędu.
  IF cardinality(v_deleted_ids) <> cardinality(v_s.used_product_ids) THEN
    RAISE EXCEPTION 'suggestion_stale' USING ERRCODE = 'P0004';
  END IF;

  INSERT INTO recipes (user_id, title, ingredients, instructions, consumed_products)
  VALUES (auth.uid(), v_s.title, v_s.ingredients, v_s.instructions, COALESCE(v_consumed, '[]'::JSONB))
  RETURNING id INTO v_recipe_id;

  UPDATE recipe_suggestions
     SET status = 'approved', approved_recipe_id = v_recipe_id
   WHERE id = v_s.id;

  RETURN jsonb_build_object('recipe_id', v_recipe_id, 'deleted_ids', to_jsonb(v_deleted_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_suggestion(UUID) TO authenticated;
```

Trzy różnice wobec dzisiejszej funkcji, każda odpowiada punktowi z KROKU 3:

1. Treść przepisu i zbiór id pochodzą z **wiersza propozycji**, nie z argumentów
   → N-02 i N-05 egzekwowane w bazie, nie w zaufaniu do klienta.
2. `cardinality` check → N-04 w brzmieniu „exactly" i **fail-fast**: rozjazd
   zatrzymuje operację zamiast dawać 200 plus toast.
3. `INSERT` po `DELETE` i po sprawdzeniu → N-06 domyka się strukturalnie:
   przepis nie może powstać bez konsumpcji, bo do `INSERT` się nie dochodzi.

`SECURITY DEFINER` jest tu konieczne: klient nie ma polityki `UPDATE`
na `recipe_suggestions`, więc przejście stanu należy wyłącznie do funkcji.
`auth.uid()` w każdym predykacie utrzymuje N-07 mimo podniesionych uprawnień;
`SET search_path = public` domyka standardowe ryzyko `SECURITY DEFINER`.

### 4.6 Cienki endpoint

**`src/pages/api/recipes/approve.ts` — po refaktorze**

```ts
export const prerender = false;

// Cały kontrakt wejściowy. Nie ma czego walidować poza tożsamością propozycji.
const approveSchema = z.object({ suggestionId: z.uuid() });

export const POST: APIRoute = async (context) => {
  // …createClient / 503 / 401 bez zmian…

  const parsed = approveSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return json({ error: "Validation error" }, 400);

  try {
    const suggestion = await repo.load(parsed.data.suggestionId, context.locals.user.id);
    suggestion.approveWith({ requestedBy: context.locals.user.id, now: new Date() }); // preconditions, fail-fast
    const { recipeId, deletedIds } = await repo.commitApproval(suggestion.id, context.locals.user.id);
    return json({ id: recipeId, deletedIds }, 200);
  } catch (err) {
    if (err instanceof DomainError) return json({ error: err.message }, err.status);
    if (err instanceof ServiceError) return json({ error: err.message }, err.status);
    console.error("Unhandled error in POST /api/recipes/approve:", err);
    return json({ error: "Something went wrong — try again" }, 500);
  }
};
```

Endpoint sprowadza się do: **parse → metoda agregatu → mapowanie błędu**.
Allowlista błędów pozostaje typem, nie nawykiem — komentarz z `approve.ts:45-48`
obowiązuje dalej, rozszerzony o `DomainError`.

**`src/pages/api/recipes/generate.ts` — zmiana**

```ts
const recipe = await generateRecipe(usableProducts, excludeTitles, { technique, method, time });
const suggestion = RecipeSuggestion.propose({
  userId: context.locals.user.id,
  generated: recipe,
  inventorySnapshot: usableProducts, // dokładnie to, co poszło do promptu
  now: new Date(),
});
await repo.save(suggestion);

// Zbiór zwracany jest teraz zbiorem SERWERA — UI go renderuje, nie wylicza.
return json(
  {
    suggestion_id: suggestion.id,
    recipe,
    will_remove: usableProducts
      .filter((p) => suggestion.shownProducts.includes(p.id))
      .map(({ id, name }) => ({ id, name })),
    excluded_expired: excludedExpired,
  },
  200,
);
```

Dwie reguły z `generate.ts:54-83` (pusty inwentarz → 400, wszystko
przeterminowane → 422) zostają **na miejscu i bez zmian** — to świadome
wyjątki od N-11 i nie są przedmiotem tego refaktoru.

### 4.7 Przeniesienie egzekucji z klienta na serwer

| Co dziś robi klient                                                  | Kto to robi po refaktorze                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Wylicza „Will remove from inventory" (`inventory-panel.tsx:386-389`) | Serwer — pole `will_remove` z `generate`; UI je **renderuje**                            |
| Przechowuje propozycję (`use-recipe-generation.ts:29`)               | Baza — `recipe_suggestions`; klient trzyma tylko `suggestion_id` i kopię do wyświetlenia |
| Odsyła treść i zbiór id (`use-recipe-generation.ts:92-97`)           | Nie odsyła nic poza `suggestionId`                                                       |
| Uzgadnia różnicę `skippedIds` (`use-recipe-generation.ts:104-108`)   | Nie istnieje — rozjazd jest błędem 409, nie różnicą do pogodzenia                        |

---

## KROK 5 — Before / after, plan, testy

### 5.1 Before / after dla każdego dzisiejszego miejsca reguły

| Miejsce                                       | Dziś                                                                   | Po refaktorze                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `inventory-panel.tsx:384-390`                 | Zbiór pokazany = `products ∩ used_product_ids`, liczony w przeglądarce | Renderuje `will_remove` z odpowiedzi serwera; brak logiki wyliczania                               |
| `inventory-panel.tsx:71-79`                   | Rozjazd → `toast.info("Already removed elsewhere")`, operacja dokonana | Rozjazd niemożliwy: 409 `suggestion_stale`, nic nie zapisane, `toast.error` + „wygeneruj ponownie" |
| `use-recipe-generation.ts:29`                 | Propozycja tylko w stanie Reacta                                       | Stan Reacta to kopia do wyświetlenia; źródłem prawdy jest wiersz w bazie                           |
| `use-recipe-generation.ts:92-97`              | Body: `{title, ingredients, instructions, usedProductIds}`             | Body: `{suggestionId}`                                                                             |
| `use-recipe-generation.ts:104-108`            | Klient wylicza `skippedIds`                                            | Usunięte — `deletedIds` z definicji równe zbiorowi pokazanemu                                      |
| `approve.ts:9-14`                             | Schemat czterech pól z dowolną treścią                                 | `z.object({ suggestionId: z.uuid() })`                                                             |
| `approve.ts:38-43`                            | Wywołuje `approveRecipe(supabase, result.data)`                        | `load → approveWith → commitApproval`; mapowanie `DomainError`                                     |
| `recipe.service.ts:260-279` (`approveRecipe`) | Pass-through argumentów do RPC                                         | **Usunięta**; zastąpiona przez `recipe-suggestion.repository.ts`                                   |
| `recipe.service.ts:213-219` (N-10)            | W adapterze providera                                                  | W `RecipeSuggestion.propose` (`unknown_product_in_suggestion`)                                     |
| `recipe.service.ts:224-231` (N-01)            | W adapterze providera, tylko przy generowaniu                          | W `propose` **oraz** w `approveWith` — obie strony punktu zapisu                                   |
| `…report_deleted.sql:14-32`                   | Kasuje wg argumentu; `INSERT` bezwarunkowy                             | **Zastąpiona** przez `approve_suggestion`: wg wiersza propozycji, z kontrolą `cardinality`         |
| `generate.ts:85-89`                           | Zwraca `{recipe, excluded_expired}`, dowód znika                       | Zwraca `{suggestion_id, recipe, will_remove, excluded_expired}`; dowód utrwalony                   |
| `src/types.ts:91-96` (`ApproveRecipeInput`)   | Cztery pola z klienta                                                  | `{ suggestionId: string }`                                                                         |

### 5.2 Plan faz

Projekt ma działającą dyscyplinę test-first: `test-plan.md` §3 prowadzi
fazowy rollout, `package.json` odpala `vitest related --run` w lint-staged,
a `/10x-tdd` jest udokumentowaną ścieżką. **Fazy 1, 2 i 4 idą test-first.**

| Faza  | Zakres                                                                                                                                                                                               | Test-first                                                                                             | Kryterium wyjścia                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **0** | **Decyzja produktowa, zero kodu.** Uzgodnić `prd.md:33` („exactly") vs `prd.md:42` („never more, gap reported"). Plan zakłada brzmienie „exactly" + fail-fast. Zaktualizować `prd.md:42` i guardrail | —                                                                                                      | Jedno obowiązujące brzmienie w PRD; decyzja zapisana w `context/changes/<id>/change.md`       |
| **1** | Moduł domenowy `src/lib/domain/recipe-suggestion.ts` + `recipe-suggestion.error.ts`. Czysty, bez I/O, bez `astro:env`                                                                                | **tak** — Vitest unit                                                                                  | Wszystkie przypadki z §5.3 A i B zielone; zero importów Supabase w module domenowym           |
| **2** | Migracja `recipe_suggestions` + RLS + funkcja `approve_suggestion`                                                                                                                                   | **tak** — Vitest integration, wzorzec `recipe.service.approve.integration.test.ts` (`describe.skipIf`) | Przypadki §5.3 C zielone przy `npx supabase start`; suite pomija się czysto bez lokalnej bazy |
| **3** | `recipe-suggestion.repository.ts`; `generate.ts` tworzy i zapisuje propozycję, zwraca `suggestion_id` + `will_remove`. **Stary `approve.ts` nietknięty** — aplikacja działa przez cały czas          | częściowo                                                                                              | `npm run test` zielone; E2E `tests/generate-approve.spec.ts` przechodzi bez zmian             |
| **4** | `approve.ts` zwęża schemat do `{suggestionId}`; hook i UI przechodzą na nowy kontrakt; usunięcie `skippedIds`                                                                                        | **tak** — najpierw test endpointu na nowy kontrakt                                                     | Przypadki §5.3 D zielone; `tests/generate-approve.spec.ts` zaktualizowany i zielony           |
| **5** | Sprzątanie: `DROP FUNCTION approve_recipe`, usunięcie `approveRecipe` z `recipe.service.ts`, `ApproveRecipeInput` → `{suggestionId}`, aktualizacja `test-plan.md` §8 i `CLAUDE.md`                   | —                                                                                                      | Brak martwego kodu; `npm run typecheck` i `npm run lint` czyste                               |
| **6** | _Opcjonalnie, poza zakresem N-02_: `DROP POLICY products_update_authenticated` i `recipes_update_authenticated` (N-13, N-14); zamiatanie wygasłych propozycji; `CHECK` na `expiry_date` (N-16)       | —                                                                                                      | Osobna zmiana, osobna decyzja produktowa                                                      |

Testy mutacyjne (`CLAUDE.md` §Mutation testing): po Fazie 1 uruchomić Stryker
z zawężeniem `--mutate "src/lib/domain/recipe-suggestion.ts"`. Przeżyte mutanty
przeglądać pojedynczo — asercję dodawać tylko tam, gdzie mutant odpowiada
realnemu błędowi biznesowemu.

### 5.3 Przypadki testowe dla N-02

**A. Legalne operacje — `propose` (unit, Faza 1)**

1. Inwentarz z at-risk, `used_product_ids` zawiera at-risk → propozycja
   `pending`, `usedProductIds` = zbiór z modelu bez duplikatów.
2. Inwentarz bez at-risk (N-11) → propozycja powstaje, `atRiskProductIds` puste.
3. `used_product_ids` zawiera duplikat tego samego id → deduplikacja; `propose`
   nie rzuca.
4. `expiresAt` = `now + SUGGESTION_TTL_MINUTES`, liczone z wstrzykniętego `now`
   (zegar zamrożony — jak w `product.service.test.ts`).

**B. Nielegalne operacje — `propose` / `approveWith` (unit, Faza 1)**

5. `used_product_ids` puste → `DomainError("empty_consumption")` (N-06).
6. `used_product_ids` zawiera id spoza `inventorySnapshot` → `unknown_product_in_suggestion`
   (N-10). **Asercja dodatkowa: nic nie zostało odfiltrowane po cichu.**
7. At-risk niepuste, ale `used` ich nie dotyka → `at_risk_floor_violated` (N-01).
8. `approveWith` na propozycji `approved` → `suggestion_already_resolved`.
9. `approveWith` na propozycji `discarded` → `suggestion_already_resolved`.
10. `approveWith` z `now >= expiresAt` → `suggestion_expired`.
11. `approveWith` z `requestedBy ≠ userId` → `suggestion_not_found`
    (nie `403` — nie potwierdzamy istnienia cudzego zasobu; N-07).
12. `approveWith` na propozycji, której `atRiskProductIds` niepuste, a `used`
    ich nie zawiera → `at_risk_floor_violated` **liczone z migawki, nie z zegara**
    (test przesuwa czas o 10 dni i sprawdza, że wynik się nie zmienia).

**C. Transakcja — `approve_suggestion` (integration przeciw lokalnej bazie, Faza 2)**

13. Trzy produkty pokazane, wszystkie obecne → dokładnie trzy usunięte, jeden
    wiersz w `recipes`, `consumed_products` ma trzy wpisy, status `approved`,
    `approved_recipe_id` ustawione.
14. **Rozjazd zbioru**: jeden z pokazanych produktów usunięty innym kanałem
    tuż przed zatwierdzeniem → wyjątek `suggestion_stale`; **zero wierszy
    w `recipes`, pozostałe produkty nadal w bazie, status wciąż `pending`.**
15. **Jednorazowość**: dwa kolejne wywołania na tej samej propozycji → drugie
    kończy się `suggestion_already_resolved`; w `recipes` **jeden** wiersz.
16. **Współbieżność**: dwa równoczesne wywołania → dokładnie jedno wygrywa,
    jeden wiersz w `recipes` (`FOR UPDATE`).
17. **Cudza propozycja**: drugi uwierzytelniony użytkownik podaje `suggestion_id`
    pierwszego → `suggestion_not_found`; wiersze pierwszego nietknięte (N-07,
    wzorzec z `test-plan.md` §2 Ryzyko #4).
18. **Atomowość przy wymuszonej awarii**: produkt o nazwie
    `__test_force_delete_failure__` (wyzwalacz z
    `20260816130000_approve_recipe_test_delete_trigger.sql:5-13`) w zbiorze →
    nic nie skomitowane: brak przepisu, produkty na miejscu, status `pending` (N-03).
19. **TTL**: propozycja z `expires_at` w przeszłości → `suggestion_expired`,
    zero skutków.

**D. Endpoint i kontrakt (integration + E2E, Faza 4)**

20. `POST /api/recipes/approve` z **nadmiarowym** własnym id w body →
    id jest ignorowane (schemat go nie zna); usunięty zostaje wyłącznie zbiór
    z propozycji. **To jest test naruszenia N-02 z KROKU 3 punkt 1.**
21. `POST` z podmienionym `title` w body → tytuł ignorowany; w `recipes`
    ląduje tytuł z propozycji (N-05).
22. `POST` z losowym UUID jako `suggestionId` → 404, zero skutków.
23. `POST` bez `suggestionId` → 400, zero skutków.
24. Każda klasa `DomainError` mapuje się na swój status i na komunikat
    z tabeli — **żaden surowy tekst z Postgresa nie pojawia się w odpowiedzi**
    (N-12, `test-plan.md` §2 Ryzyko #6).
25. E2E (`tests/generate-approve.spec.ts`, rozszerzenie): po zatwierdzeniu
    ekran pokazuje ten sam zbiór nazw, który znika z inwentarza po przeładowaniu,
    a przepis pojawia się w historii (Ryzyko #8). Lokatory wg `CLAUDE.md`:
    `getByRole` / `getByText`, żadnych selektorów CSS, żadnego `waitForTimeout`.

### 5.4 Nowe nazwy „load-bearing" do zarejestrowania

Projekt **nie prowadzi** osobnego rejestru kontraktów. Rolę rejestru pełnią
trzy miejsca i tam należy dopisać poniższe nazwy:
`CLAUDE.md` (§Architecture / Key conventions), `context/foundation/test-plan.md`
§8 Freshness Ledger, `context/foundation/lessons.md` (jeśli z refaktoru wyjdzie
reguła ogólna).

| Nazwa                                                       | Rodzaj                   | Gdzie zarejestrować                                                        |
| ----------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `RecipeSuggestion` / „propozycja przepisu"                  | pojęcie domenowe         | `CLAUDE.md`, `prd.md` (Ubiquitous Language — dziś PRD tego słowa nie zna)  |
| `SuggestionStatus` = `pending` \| `approved` \| `discarded` | typ stanu                | `CLAUDE.md`, `src/types.ts`                                                |
| `recipe_suggestions`                                        | tabela                   | `CLAUDE.md` §Architecture                                                  |
| `approve_suggestion(p_suggestion_id UUID)`                  | RPC / granica transakcji | `CLAUDE.md`, `test-plan.md` §8                                             |
| `RecipeSuggestion.propose` / `.approveWith` / `.discard`    | metody domenowe          | `CLAUDE.md` §Services/helpers                                              |
| `DomainError` + siedem wartości `DomainErrorKind`           | kontrakt błędu           | `CLAUDE.md` obok `ServiceError`; `test-plan.md` §2 Ryzyko #6               |
| `SUGGESTION_TTL_MINUTES`                                    | stała domenowa           | `src/lib/domain/recipe-suggestion.ts` (jedyne źródło)                      |
| `will_remove` (pole odpowiedzi `/api/recipes/generate`)     | kontrakt API             | `CLAUDE.md` §API routes                                                    |
| `src/lib/domain/`                                           | nowa warstwa             | `CLAUDE.md` §Key conventions — dziś dokument zna tylko `src/lib/services/` |

### 5.5 Ryzyka planu

- **Faza 4 zmienia kontrakt API.** Sekwencja 3 → 4 jest celowa: przez całą
  Fazę 3 działają obie ścieżki, więc żaden commit nie zostawia aplikacji zepsutej.
- **Zaostrzenie N-04 do „exactly" zmienia zachowanie widoczne dla użytkownika**:
  sytuacja, która dziś kończy się zatwierdzeniem plus toastem, po refaktorze
  kończy się błędem i koniecznością ponownego wygenerowania. To jest zamierzone
  (fail-fast), ale **jest decyzją produktową i dlatego stanowi Fazę 0**, a nie
  skutek uboczny Fazy 2.
- **`SECURITY DEFINER`** podnosi uprawnienia funkcji. Mitygacja: `auth.uid()`
  w każdym predykacie i `SET search_path = public`; do pokrycia przypadkiem 17.
- **Rosnąca tabela propozycji.** Przy `target_scale` z `prd.md` (users: small)
  nie jest to problem MVP; zamiatanie wygasłych wpisów należy do Fazy 6.
