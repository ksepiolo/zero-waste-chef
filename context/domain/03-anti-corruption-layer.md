---
title: "Zero Waste Chef — warstwa antykorupcyjna dla zależności persystencyjnej"
created: 2026-08-29
type: refactor-plan
---

# Anti-Corruption Layer — plan refaktoru

> Produktem tego dokumentu jest **plan**, nie kod. Żaden plik produkcyjny nie
> został zmieniony. Wszystkie cytaty `plik:linia` odnoszą się do stanu
> repozytorium na gałęzi `feature/ddd-m4m5` (HEAD `9801deb`, 2026-08-29)
> i zostały zweryfikowane przez odczyt plików.
>
> Dokument kontynuuje `01-domain-distillation.md` (mapa domeny, klasyfikacja
> subdomen) i `02-invariant-aggregate-refactor.md` (agregat `RecipeSuggestion`).
> Tam, gdzie tamten plan wprowadza nazwy (`src/lib/domain/`, `DomainError`,
> `RecipeSuggestionRepository`), ten dokument je **rozszerza**, a nie zastępuje.

---

## KROK 0 — Kontekst

### Odczytane dokumenty bazowe

| Dokument                               | Co wnosi do tej analizy                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `context/foundation/prd.md`            | guardrail izolacji danych (`:41`, `:108`), guardrail spójności inwentarza (`:42`), model płaski bez ról (`:124`)                                 |
| `context/foundation/tech-stack.md`     | uzasadnienie wyboru Supabase — **kupiony mechanizm**, nie przewaga produktu (`:28-31`)                                                           |
| `README.md`                            | deklaracja o granicy klient/serwer: zmienne środowiskowe „are treated as **server-only secrets** — they are never exposed to the client" (`:75`) |
| `CLAUDE.md`                            | twarda reguła projektu o `createClient()` zwracającym `null` i o tym, że **„all callers must null-check"** (`:5`)                                |
| `context/foundation/lessons.md`        | zarejestrowany near-miss: poleganie wyłącznie na RLS okazało się niewystarczające (`:5-10`)                                                      |
| `context/domain/01-…`                  | klasyfikacja „Persystencja / migracje / RLS jako mechanizm" jako **GENERIC** (`:122`); integracja LLM jako GENERIC (`:123`)                      |
| `context/domain/02-…`                  | wprowadza warstwę `src/lib/domain/`, typ `DomainError` i pierwszy port (`RecipeSuggestionRepository`, `:497-516`)                                |
| `context/foundation/infrastructure.md` | jedyne miejsce, gdzie projekt świadomie rozważa wymianę dostawcy (adapter Vercel vs Cloudflare, `:62`)                                           |

### Stack i warstwy

Astro 6 w trybie `output: "server"` (`astro.config.mjs:11`), React 19 jako wyspy,
Supabase (Postgres + Auth + RLS), Cloudflare Workers, OpenRouter jako dostawca LLM.

| Warstwa                     | Katalog / pliki                                                      |
| --------------------------- | -------------------------------------------------------------------- |
| Middleware (sesja, ochrona) | `src/middleware.ts`                                                  |
| API (kontrakt wire)         | `src/pages/api/**` — 9 handlerów                                     |
| Serwisy („domena")          | `src/lib/services/*.service.ts`                                      |
| Typy współdzielone          | `src/types.ts`, `src/env.d.ts`                                       |
| SSR / UI                    | `src/pages/*.astro`, `src/layouts/`, `src/components/**`             |
| Persystencja                | `supabase/migrations/*.sql` (tabele, RLS, funkcja `approve_recipe`)  |
| Testy                       | `*.test.ts`, `*.integration.test.ts`, `tests/*.spec.ts` (Playwright) |

### Zależności zewnętrzne (manifest)

Z `package.json` — kandydaci na przeciek (pomijam czysto prezentacyjne:
`tailwindcss`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`):

`@supabase/ssr`, `@supabase/supabase-js`, `zod`, `astro` (+ wirtualny
`astro:env/server`), `react` / `react-dom`, `sonner`, `lucide-react`,
`radix-ui`. Dostawca LLM (OpenRouter) nie ma pakietu — jest wołany surowym
`fetch`, co samo w sobie jest sygnałem (patrz oś B).

---

## KROK 1 — Przeciekające zależności

Kryterium: zależność „przecieka", jeśli jej typy, kształt obiektów, nazwy
albo semantyka błędów są **znane poza jedną warstwą**.

### Oś A — Supabase (`@supabase/ssr` + `@supabase/supabase-js` + PostgREST + `auth.uid()`)

**17 plików produkcyjnych i 6 testowych, cztery warstwy.**

| #   | Plik                                  | Linie                                                | Co dokładnie wie                                                               |
| --- | ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `src/lib/supabase.ts`                 | `:1`, `:3`, `:6`, `:9`                               | `createServerClient`, `parseCookieHeader`, kształt adaptera ciasteczek         |
| 2   | `src/env.d.ts`                        | `:3`                                                 | `import("@supabase/supabase-js").User` **jako typ tożsamości całej aplikacji** |
| 3   | `src/lib/services/product.service.ts` | `:1`, `:51`, `:53`, `:73`, `:78`, `:92`, `:94`       | `SupabaseClient` w sygnaturze; łańcuch `.from().select().eq().order()`         |
| 4   | `src/lib/services/recipe.service.ts`  | `:2`, `:241`, `:245`, `:260`, `:262`, `:269`, `:276` | `SupabaseClient` w sygnaturze; `.rpc()`, `.overrideTypes<>()`, `as unknown as` |
| 5   | `src/middleware.ts`                   | `:2`, `:7`, `:9`, `:12`                              | `supabase.auth.getUser()`                                                      |
| 6   | `src/pages/api/auth/signin.ts`        | `:2`, `:9`, `:11`, `:13`                             | `auth.signInWithPassword`; nazwa „Supabase" w komunikacie                      |
| 7   | `src/pages/api/auth/signup.ts`        | `:2`, `:9`, `:11`, `:13`                             | `auth.signUp`; jw.                                                             |
| 8   | `src/pages/api/auth/signout.ts`       | `:2`, `:5`, `:7`                                     | `auth.signOut`                                                                 |
| 9   | `src/pages/api/products/index.ts`     | `:3`, `:17-18`, `:26`, `:38-39`, `:60`               | konstrukcja klienta ×2 + polityka „brak klienta → 503"                         |
| 10  | `src/pages/api/products/[id].ts`      | `:2`, `:8-9`, `:22`                                  | jw.                                                                            |
| 11  | `src/pages/api/recipes/index.ts`      | `:3`, `:18-19`, `:36`                                | jw.                                                                            |
| 12  | `src/pages/api/recipes/generate.ts`   | `:3`, `:25-26`, `:52`                                | jw.                                                                            |
| 13  | `src/pages/api/recipes/approve.ts`    | `:3`, `:17-18`, `:39`                                | jw.                                                                            |
| 14  | `src/pages/inventory.astro`           | `:3`, `:10-13`                                       | konstrukcja klienta **w szablonie UI**                                         |
| 15  | `src/pages/recipes.astro`             | `:3`, `:14-17`                                       | jw.                                                                            |
| 16  | `src/lib/config-status.ts`            | `:1`, `:13-16`                                       | nazwa dostawcy + URL do jego instrukcji, jako **treść dla użytkownika**        |
| 17  | `src/layouts/Layout.astro`            | `:4`, `:25`                                          | renderuje powyższe w banerze na każdej stronie                                 |

Testy: `src/lib/services/product.service.test.ts:1,64-82,131-145`;
`src/lib/services/recipe.service.test.ts:2,672-681`;
`src/lib/services/recipe.service.approve.integration.test.ts:2,71-80`;
`src/pages/api/products/index.integration.test.ts:3,22-23,73-76`;
`src/pages/api/products/[id].integration.test.ts:3,72-75`;
`src/pages/api/recipes/index.integration.test.ts:3,65-68`.

SQL: `auth.uid()` w każdej polityce RLS
(`supabase/migrations/20260531120000_initial_schema.sql:20,23,26-28,31`
i `:67-92`) oraz w trzech predykatach funkcji
`20260816120000_approve_recipe_report_deleted.sql:18,21,27`.

### Oś B — OpenRouter (dostawca LLM, bez pakietu, surowy `fetch`)

| Plik                                 | Linie                                                                        | Co wie                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/services/recipe.service.ts` | `:3`, `:17-19`, `:23-58`, `:72-76`, `:136-160`, `:171-197`                   | URL, klucz, nazwa modelu, `response_format`, `plugins`, role wiadomości, mapowanie statusów HTTP |
| `src/lib/services/service-error.ts`  | `:16-21`, `:31-46`                                                           | słownik błędów **nazwany kategoriami dostawcy** (`provider_unavailable`, `upstream_fault`)       |
| `src/lib/services/recipe-prompt.ts`  | `:3-7`                                                                       | komentarz dokumentujący, dlaczego moduł **musi** unikać `astro:env`                              |
| `astro.config.mjs`                   | `:21-27`                                                                     | `OPENROUTER_API_KEY`, `OPENROUTER_URL` w schemacie env                                           |
| `.env.example`                       | `:7`                                                                         | jw.                                                                                              |
| testy                                | `recipe.service.test.ts:14-18,110,587-589`; `generate.test.ts:11-15,102,156` | klucz i kształt odpowiedzi dostawcy                                                              |

Skoncentrowane w jednym module produkcyjnym — ale **zrośnięte z regułą rdzenia**:
sortowanie at-risk-first (`:104`), cap promptu (`:107`), kontrola id wobec
inwentarza (`:213-219`) i at-risk floor (`:224-231`) żyją w tej samej funkcji,
co nagłówki HTTP dostawcy.

### Oś C — `astro:env/server` (wirtualny moduł frameworka)

`src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`,
`src/lib/services/recipe.service.ts:3`, plus 5 plików testowych.
Dowód przecieku jest **zapisany w kodzie**: `src/types.ts:47-49` wyjaśnia, że
`RECIPES_PAGE_SIZE` musiał zostać przeniesiony do `types.ts`, bo wyspa historii
przepisów wciągnęłaby moduł serwerowy do bundla klienta i dostała
`ServerOnlyModule`. Ten sam komentarz powtarza się w `recipe-prompt.ts:3-7`.

### Oś D — `zod`

`src/pages/api/products/index.ts:2,8-14`, `src/pages/api/recipes/index.ts:2,10-15`,
`src/pages/api/recipes/generate.ts:2,17-22`, `src/pages/api/recipes/approve.ts:2,9-14`,
`src/lib/services/recipe.service.ts:1,60-65`. Biblioteka walidacji jest i w
warstwie API, i w serwisie. Jej błąd **już raz wyciekł do użytkownika** —
`service-error.ts:5-6` opisuje to wprost („how a `ZodError` dump … ended up
rendered as user toasts"). Dziś zamknięte przez `ServiceError`, ale
strukturalnie zależność nadal jest w dwóch warstwach.

### Oś E — Astro (`APIRoute`, `AstroCookies`, `Astro.locals`)

Wszechobecna, ale to **framework nośny**, a nie wymienialny komponent;
`infrastructure.md:19` traktuje wymianę adaptera (Cloudflare→Vercel) jako
realną, a samego Astro — nie. Odrzucona jako oś refaktoru.

### Oś F — React / `sonner` / `lucide-react` / `radix-ui`

Wyłącznie w `src/components/**`. Zero przecieku przez granicę. Odrzucona.

---

## KROK 2 — Klasyfikacja i wybór #1

| Oś                   | (a) warstwy / pliki                                         | (b) koszt wymiany dziś                                                                                                                                         | (c) deklaracja wymienialności w dokumentach                                                                                                               | Werdykt |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **A Supabase**       | **4 warstwy, 17 plików prod. + 6 test. + cała warstwa SQL** | **Krytyczny.** Zmiana dotyka sygnatur serwisów, `App.Locals`, dwóch szablonów `.astro`, wszystkich 9 handlerów API, banera w layoucie i trzech atrap w testach | `tech-stack.md:28-31` — kupiony **mechanizm**; `01-…:122` klasyfikuje go jako **GENERIC**; `CLAUDE.md:5` reguluje go regułą „all callers must null-check" | **#1**  |
| B OpenRouter         | 1 plik prod. (+ config, +2 test.)                           | Średni — ale wymaga edycji pliku, w którym mieszka reguła rdzenia                                                                                              | `recipe.service.ts:18` („Swap to … if the limit bites") i `01-…:123` („integracja jest wymienialna") — **deklaracja jest, kodu ACL nie ma**               | #2      |
| C `astro:env/server` | 3 pliki prod.                                               | Niski w liczbach, ale **ostry** — dotyczy granicy klient/serwer                                                                                                | `README.md:75` deklaruje granicę; kod ją utrzymuje **obejściem** (`types.ts:47-49`)                                                                       | #3      |
| D `zod`              | 5 plików, 2 warstwy                                         | Niski — walidacja to lokalna decyzja każdego handlera                                                                                                          | brak                                                                                                                                                      | #4      |
| E Astro              | wszędzie                                                    | —                                                                                                                                                              | framework nośny, nie kandydat                                                                                                                             | —       |
| F React itd.         | 1 warstwa                                                   | —                                                                                                                                                              | brak przecieku                                                                                                                                            | —       |

### Wybór: **oś A — Supabase**

Trzy powody, w kolejności siły:

1. **Rozjazd intencja-vs-kod jest udokumentowany po obu stronach.**
   `tech-stack.md:28-31` wybiera Supabase, bo „ships PostgreSQL + auth with Row
   Level Security out of the box, **directly satisfying** the PRD's strict
   data-isolation guardrail" — czyli kupuje **gotowy mechanizm** do realizacji
   wymagania. `01-domain-distillation.md:122` klasyfikuje go wprost jako
   **GENERIC**. W DDD zależność generyczna ma leżeć **za granicą**. W kodzie
   leży w sygnaturze każdej operacji rdzeniowej.

2. **Projekt sam nazwał przeciek i uznał go za regułę.** `CLAUDE.md:5` mówi:
   „`createClient()` returns `null` … **all callers must null-check**". To zdanie
   nie opisuje ACL — opisuje jego brak. `src/lib/supabase.ts` jest **fabryką**,
   nie warstwą antykorupcyjną: oddaje surowy obiekt dostawcy i deleguje
   obsługę jego nieobecności trzynastu wywołującym.

3. **Skala i typ przecieku.** Oś B jest zamknięta w jednym module, oś C w trzech,
   oś D w pięciu. Oś A przecieka do **szablonów UI** (`inventory.astro:10`,
   `recipes.astro:14`), do **typu tożsamości aplikacji** (`env.d.ts:3`) i do
   **treści widocznej dla użytkownika** (`config-status.ts:15` → `Layout.astro:25`).
   Oś B po naprawie osi A staje się prostym powtórzeniem tego samego wzorca —
   dlatego ten plan projektuje port tak, żeby dał się powtórzyć dla dostawcy LLM
   (patrz §6.3).

---

## KROK 3 — Diagnoza

### 3.1 Duplikacja

**D1 — konstrukcja klienta powtórzona 13 razy.**

```
src/middleware.ts:7                  const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/auth/signin.ts:9       const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/auth/signup.ts:9       const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/auth/signout.ts:5      const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/products/index.ts:17   const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/products/index.ts:38   const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/products/[id].ts:8     const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/recipes/index.ts:18    const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/recipes/generate.ts:25 const supabase = createClient(context.request.headers, context.cookies);
src/pages/api/recipes/approve.ts:17  const supabase = createClient(context.request.headers, context.cookies);
src/pages/inventory.astro:10         const supabase = createClient(Astro.request.headers, Astro.cookies);
src/pages/recipes.astro:14           const supabase = createClient(Astro.request.headers, Astro.cookies);
```

Middleware **już zbudował** klienta w tym samym żądaniu (`middleware.ts:7`)
i zdążył go wyrzucić; każdy handler buduje go po raz drugi.

**D2 — jedna sytuacja („magazyn nieskonfigurowany"), cztery różne polityki.**

| Zachowanie                                          | Miejsca                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 503 + `{"error":"Service unavailable"}`             | `products/index.ts:18-20`, `:39-41`; `products/[id].ts:9-11`; `recipes/index.ts:19-21`; `generate.ts:26-28`; `approve.ts:18-20` |
| redirect z komunikatem „Supabase is not configured" | `signin.ts:10-12`, `signup.ts:10-12`                                                                                            |
| cicho pomiń, udawaj sukces                          | `signout.ts:6-8`, `middleware.ts:9,14-16`                                                                                       |
| cicho zdegraduj do pustego widoku                   | `inventory.astro:11-17` (pusty inwentarz), `recipes.astro:15-22` (flaga `loadError`)                                            |

Cztery odpowiedzi na jedno pytanie infrastrukturalne, rozstrzygane **13 razy**.
Dodanie nowego endpointu to dodanie czternastego rozstrzygnięcia.

**D3 — reguła własności rozpisana po zapytaniach.**
`lessons.md:5-10` wymaga `.eq("user_id", userId)` obok RLS. Reguła jest dziś
implementowana osobno w każdym zapytaniu — `product.service.ts:55`, `:79`
(przez `user_id` w `insert`), `:96-97`, `recipe.service.ts:247` — oraz osobno
w SQL przez `auth.uid()` (`…report_deleted.sql:18`, `:21`, `:27`). Sześć
niezależnych implementacji jednego guardrailu z `prd.md:41`. Nie ma **żadnego
miejsca**, w którym dałoby się tę regułę złamać tylko raz.

**D4 — trzykrotna rekonstrukcja kształtu buildera PostgREST w testach.**

```ts
// src/lib/services/product.service.test.ts:64-82
interface QueryStub { select: () => QueryStub; eq: () => QueryStub; order: () => Promise<{ data: unknown; error: null }>; }
// „The chain is thenable only at .order(), which is where listProducts awaits it."
return { from: () => query } as unknown as SupabaseClient;

// src/lib/services/product.service.test.ts:131-145
interface DeleteQueryStub { delete: …; eq: …; then: PromiseLike<{ count: number; error: null }>["then"]; }

// src/lib/services/recipe.service.test.ts:672-681
rpc: (name, args) => { call = { name, args }; return { overrideTypes: () => Promise.resolve(result) }; }
```

Każda atrapa koduje **implementacyjny szczegół dostawcy** — w którym ogniwie
łańcuch staje się `thenable`. Każda kończy się `as unknown as SupabaseClient`.
Do tego osiem linii `eslint-disable` w czterech suitach integracyjnych,
istniejących wyłącznie dlatego, że `createClient()` i `SupabaseClient` mają
generyki w innej kolejności (`products/index.integration.test.ts:73,75`;
`products/[id].integration.test.ts:72,74`; `recipes/index.integration.test.ts:65,67`;
`recipe.service.approve.integration.test.ts:77,79`).

**D5 — „dzisiaj w UTC" policzone dwa razy, dwoma sposobami.**

```ts
// src/lib/services/product.service.ts:12-16 — z komentarzem, dlaczego to musi być UTC
function utcDateOffset(days: number, from: Date = new Date()): string { … }

// src/pages/api/products/index.ts:13 — niezależna, nieudokumentowana kopia
.refine((val) => val >= new Date().toISOString().split("T")[0], "Expiry date must be today or in the future")
```

Reguła „data ważności to kalendarzowy dzień w UTC" wynika z typu kolumny
`expiry_date DATE` (`20260531120000_initial_schema.sql:8`) i z rzutowania
`expiry_date::TEXT` w funkcji (`…report_deleted.sql:14`) — czyli **z kontraktu
persystencji**. Jest znana w dwóch warstwach i nigdzie nie jest jednym bytem.

### 3.2 Przecieki przez granice

**P1 — typ dostawcy jako tożsamość całej aplikacji.**

```ts
// src/env.d.ts:3
user: import("@supabase/supabase-js").User | null;
```

Ten typ czytają: `Topbar.astro:2,11` (renderuje `user.email`),
`dashboard.astro:4,14`, `inventory.astro:11,13`, `recipes.astro:15,17` i
wszystkie handlery API (`products/index.ts:21,26,42,60`; `products/[id].ts:12,22`;
`recipes/index.ts:22,36`; `generate.ts:29,52`; `approve.ts:21`).
**Zamiana dostawcy uwierzytelniania zmienia typ, który czyta warstwa
szablonów.** To jest dokładnie ten przeciek, przed którym KROK 1 promptu
ostrzega jako „typy biblioteki w sygnaturach domenowych".

**P2 — biblioteka w sygnaturze operacji rdzeniowych.**

```ts
// src/lib/services/product.service.ts:51
export async function listProducts(supabase: SupabaseClient, userId: string): Promise<ProductWithRisk[]>;
// :73, :92 — to samo
// src/lib/services/recipe.service.ts:241, :260 — to samo
```

`01-domain-distillation.md:122` klasyfikuje persystencję jako **GENERIC**.
Pięć funkcji z warstwy uznanej za domenową nie da się wywołać ani nawet
otypować bez klasy dostawcy.

**P3 — nazwa dostawcy jako komunikat dla użytkownika końcowego.**

```ts
// src/lib/config-status.ts:13-16
name: "Supabase",
message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
```

Renderowane w `Layout.astro:25` — czyli **na każdej stronie aplikacji**.
Do tego `signin.ts:11` i `signup.ts:11` wysyłają tę samą nazwę w URL-u redirectu.
Użytkownik gotujący obiad dowiaduje się nazwy dostawcy bazy danych i adresu
repozytorium startera.

**P4 — biblioteka serwerowa ciągnięta w stronę bundla klienta.**
`README.md:75` deklaruje: sekrety „are treated as server-only secrets — they
are **never** exposed to the client". Deklaracja jest utrzymywana **konwencją,
nie strukturą**, i już raz wymusiła obejście:

```ts
// src/types.ts:47-49
// Lives here, not in recipe.service.ts: that module imports astro:env/server, which
// throws ServerOnlyModule if pulled into the client bundle. The history island needs
// this constant, and src/types.ts has no runtime imports at all.
```

Ten sam mechanizm czeka po stronie persystencji: dowolny import z
`product.service.ts` w komponencie `client:load` (`inventory.astro:34`,
`recipes.astro:31`) pociągnie `@supabase/ssr` i `astro:env/server`. Dziś nic
tego nie blokuje poza dyscypliną autora.

**P5 — kształt wiersza bazy jako kontrakt wire i jako propsy Reacta.**
`src/types.ts:1-7` to typ **wiersza tabeli** (`user_id`, `expiry_date`,
`created_at` — snake_case, kolumny), a jednocześnie DTO odpowiedzi API i props
komponentu. Warstwa UI zna nazwy kolumn:
`inventory-panel.tsx:113`, `:119`, `:129` (`expiry_date`), `:223` (`is_at_risk`),
`:229` (`is_expired`), `:234`. Zmiana nazwy kolumny jest zmianą w JSX.

**P6 — semantyka domenowa wyrażona jako string, bo nie było typu domenowego.**

```ts
// src/lib/services/product.service.ts:106
if (count === 0) throw new Error("not found");
// src/pages/api/products/[id].ts:26
if (message === "not found") { … 404 … }
```

Wynik domenowy („produktu nie ma") przechodzi przez granicę warstw jako
**dopasowanie tekstu**, bo `ServiceError` (`service-error.ts:15-21`) ma słownik
nazwany kategoriami **dostawcy LLM**, nie domeny. Komentarz w `:104-105`
przyznaje to wprost: „Deliberately left as a bare Error".

**P7 — walka z generykami dostawcy w kodzie serwisu.**

```ts
// src/lib/services/recipe.service.ts:269, :273-276
.overrideTypes<{ recipe_id: string; deleted_ids: string[] }>();
// „With no generated Database types supabase-js infers an array shape…"
const result = data as unknown as { recipe_id: string; deleted_ids: string[] } | null;
```

Dwa rzutowania obchodzące system typów, w module, który w warstwowym podziale
uchodzi za domenowy.

### 3.3 Werdykt

`src/lib/supabase.ts` **wygląda** na ACL — jeden plik, jedna funkcja, nazwa
neutralna. Nie jest nim, bo **zwraca typ dostawcy**. ACL jest granicą wtedy,
gdy po jego zewnętrznej stronie typ biblioteki nie występuje. Tutaj granica
kończy się w linii `return` i przecieka do 16 kolejnych plików.

---

## KROK 4 — Projekt warstwy antykorupcyjnej

### 4.1 Nowe granice katalogów

```
src/lib/domain/                        ← czyste; ZERO importów z @supabase/*, astro:*, zod
  expiry-date.vo.ts
  account.vo.ts
  product-item.entity.ts
  recipe-entry.entity.ts
  data-access.port.ts                  ← wąskie porty
  domain-error.ts                      ← rozszerza DomainError z 02-…:§4.3

src/lib/adapters/supabase/             ← JEDYNE miejsce z importem @supabase/*
  client.adapter.ts                    ← dzisiejsze src/lib/supabase.ts
  database.types.ts                    ← generowane: supabase gen types typescript --local
  row.mapper.ts                        ← wiersz ⇄ byt domenowy
  inventory.store.ts
  recipe.store.ts
  session.gateway.ts
  index.ts                             ← openDataAccess() — jedyny punkt kompozycji
```

Nazewnictwo zgodne z `CLAUDE.md` §Key conventions: kebab-case z sufiksem typu
(`feature.store.ts`, `feature.port.ts`, `feature.vo.ts`).
Katalog `src/lib/domain/` jest tym samym, który wprowadza `02-…:§5.2 Faza 1`.

### 4.2 `ExpiryDate` — value object znający kształt zależności

Jedyne miejsce w kodzie, które wie, że data ważności jest kalendarzowym dniem
bez strefy, że persystencja trzyma ją w kolumnie `DATE`, że PostgREST podaje ją
jako `'YYYY-MM-DD'`, a funkcja `approve_recipe` rzutuje przez `::TEXT`
(`…report_deleted.sql:14`).

```ts
// src/lib/domain/expiry-date.vo.ts        (bez importów zewnętrznych)

export const AT_RISK_DAYS = 3;

export class ExpiryDate {
  private constructor(readonly iso: string) {} // kanonicznie 'YYYY-MM-DD'

  /** Z persystencji. Jedyne miejsce, które zna format kolumny DATE. */
  static fromStored(value: string): ExpiryDate; // niepoprawny format → DomainError("malformed_expiry")
  /** Z wejścia użytkownika (dziś: zod .regex w products/index.ts:12). */
  static fromInput(value: string, today?: CalendarDay): ExpiryDate;
  /** Do persystencji i na wire — ta sama reprezentacja, jeden punkt zmiany. */
  toStored(): string;
  toWire(): string;

  // operacje domenowe — dziś rozsypane po product.service.ts:19-49
  isExpired(today?: CalendarDay): boolean;
  isAtRisk(today?: CalendarDay): boolean;
  compare(other: ExpiryDate): -1 | 0 | 1; // zastępuje localeCompare w inventory-panel.tsx:129
}

/** „Dziś" jako pojedynczy odczyt zegara — jedyna implementacja arytmetyki UTC. */
export class CalendarDay {
  static today(clock: () => Date = () => new Date()): CalendarDay;
  plusDays(days: number): CalendarDay;
  readonly iso: string;
}
```

Wchłania: `product.service.ts:12-16` (`utcDateOffset`), `:19-21`, `:24-30`,
`:42-49` (`classifyExpiry`) **oraz** duplikat z `pages/api/products/index.ts:13`.
Powód, dla którego `classifyExpiry` czyta zegar raz (`product.service.ts:43-44`,
komentarz o północy UTC między dwoma odczytami), staje się własnością typu
`CalendarDay`, a nie dyscypliną wywołującego.

### 4.3 `ProductItem` i `Inventory` — byty domenowe

```ts
// src/lib/domain/product-item.entity.ts

export class ProductItem {
  private constructor(
    readonly id: ProductId,
    readonly owner: AccountId,
    readonly name: ProductName, // ≤255 znaków; sanityzacja \r\n z recipe.service.ts:114
    readonly expiry: ExpiryDate,
  ) {}

  static create(owner: AccountId, name: string, expiry: string, today: CalendarDay): ProductItem;

  isAtRisk(today: CalendarDay): boolean; // deleguje do expiry
  isExpired(today: CalendarDay): boolean;

  /** Kontrakt wire — świadoma decyzja, dziś nieistniejąca (P5). */
  toWire(today: CalendarDay): ProductView; // { id, name, expiresOn, atRisk, expired }
}

export class Inventory {
  constructor(
    private readonly items: ProductItem[],
    private readonly today: CalendarDay,
  ) {}
  atRisk(): ProductItem[];
  usable(): ProductItem[]; // zastępuje generate.ts:67
  expired(): ProductItem[]; // zastępuje generate.ts:70-72
  orderedForPrompt(cap: number): ProductItem[]; // zastępuje recipe.service.ts:104-107
  isEmpty(): boolean; // zastępuje generate.ts:58
}
```

`Inventory` jest agregatem nazwanym już w `01-…:§KROK 3 A`. Tutaj dostaje ciało.

### 4.4 `Account` — zamiast typu `User` dostawcy

```ts
// src/lib/domain/account.vo.ts

export class AccountId {
  private constructor(readonly value: string);
  static parse(value: string): AccountId;    // UUID; niepoprawny → DomainError("invalid_account")
}

export interface Account {
  readonly id: AccountId;
  readonly email: EmailAddress;              // jedyne pole User, którego UI faktycznie używa
}
```

`Topbar.astro:11` i `dashboard.astro:14` używają wyłącznie `user.email`.
Cały pozostały kształt `@supabase/supabase-js.User` jest w `App.Locals`
bez powodu.

### 4.5 Wąskie porty — interfejsy domenowe

```ts
// src/lib/domain/data-access.port.ts     (ZERO importów zewnętrznych)

export interface InventoryStore {
  list(owner: AccountId): Promise<Inventory>;
  add(item: ProductItem): Promise<ProductItem>;
  /** Brak wiersza → DomainError("product_not_found"). Nigdy string „not found". */
  remove(owner: AccountId, id: ProductId): Promise<void>;
}

export interface RecipeStore {
  /** Kontrakt: zawsze malejąco po dacie utworzenia; strona poza końcem → pusta lista + prawdziwy total. */
  page(owner: AccountId, page: PageNumber): Promise<RecipeHistoryPage>;
  approve(owner: AccountId, approval: ApprovalCommand): Promise<ApprovalReport>;
}

export interface SessionGateway {
  currentAccount(): Promise<Account | null>;
  signIn(credentials: Credentials): Promise<Account>; // porażka → DomainError("bad_credentials")
  signUp(credentials: Credentials): Promise<void>;
  signOut(): Promise<void>;
}

/** Jedno wejście dla wszystkiego, co wychodzi poza proces. */
export interface DataAccess {
  readonly inventory: InventoryStore;
  readonly recipes: RecipeStore;
  readonly session: SessionGateway;
}
```

Trzy porty zamiast jednego „repozytorium od wszystkiego" — bo `middleware.ts`
potrzebuje wyłącznie `SessionGateway`, a `inventory.astro` wyłącznie
`InventoryStore`. Port `RecipeStore.approve` jest miejscem, w które wpina się
`RecipeSuggestionRepository.commitApproval` z `02-…:§4.4` — te dwa plany
schodzą się tutaj, nie konkurują.

### 4.6 Błędy — jeden słownik domenowy

`02-…:§5.4` rejestruje `DomainError` + `DomainErrorKind`. Ten plan dokłada
cztery wartości i **nie** tworzy drugiego typu:

| Kind                | Znaczenie                                        | Zastępuje dziś                                                 |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `store_unavailable` | magazyn nieskonfigurowany lub nieosiągalny       | 13 rozstrzygnięć z D2                                          |
| `store_failure`     | magazyn odpowiedział błędem                      | `ServiceError("data_access")` (`product.service.ts:63,86,102`) |
| `product_not_found` | brak wiersza pod tym id **dla tego właściciela** | `new Error("not found")` + dopasowanie stringa (P6)            |
| `bad_credentials`   | logowanie odrzucone                              | `error.message` dostawcy w URL-u redirectu (`signin.ts:16`)    |

`ServiceError` **zostaje** dla klas awarii dostawcy LLM — tam jego nazewnictwo
(`provider_unavailable`, `upstream_fault`) jest trafne. Rozdzielenie tych dwóch
słowników jest częścią refaktoru, nie efektem ubocznym.

### 4.7 Adapter — jedyny plik, który zna dostawcę

```ts
// src/lib/adapters/supabase/inventory.store.ts
import type { SupabaseClient } from "@supabase/supabase-js";     // ← jedyna warstwa z tym importem
import type { Database } from "./database.types";

export function supabaseInventoryStore(db: SupabaseClient<Database>): InventoryStore {
  return {
    async list(owner) {
      // Reguła z lessons.md:5-10 — filtr aplikacyjny obok RLS — JEDNO miejsce w kodzie.
      const { data, error } = await db.from("products").select("*")
        .eq("user_id", owner.value).order("expiry_date", { ascending: true });
      if (error) { logDiagnostic(error); throw new DomainError("store_failure", { cause: error }); }
      return new Inventory(data.map(toProductItem), CalendarDay.today());
    },

    async remove(owner, id) {
      const { count, error } = await db.from("products").delete({ count: "exact" })
        .eq("user_id", owner.value).eq("id", id.value);
      if (error) { logDiagnostic(error); throw new DomainError("store_failure", { cause: error }); }
      if (count === 0) throw new DomainError("product_not_found");   // decyzja Q1, §5.4
    },
    …
  };
}

// src/lib/adapters/supabase/index.ts — jedyny punkt kompozycji
export function openDataAccess(headers: Headers, cookies: AstroCookies): DataAccess | null {
  const db = createServerClient<Database>(…);          // dzisiejszy src/lib/supabase.ts
  return db && {
    inventory: supabaseInventoryStore(db),
    recipes:   supabaseRecipeStore(db),
    session:   supabaseSessionGateway(db),
  };
}
```

### 4.8 Kompozycja — raz na żądanie, w middleware

```ts
// src/middleware.ts  (po refaktorze)
const data = openDataAccess(context.request.headers, context.cookies);
context.locals.data = data; // DataAccess | null
context.locals.account = data ? await data.session.currentAccount() : null;

// src/env.d.ts  (po refaktorze) — zero typów dostawcy
declare namespace App {
  interface Locals {
    account: import("@/lib/domain/account.vo").Account | null;
    data: import("@/lib/domain/data-access.port").DataAccess | null;
  }
}
```

Handlery i strony `.astro` nie konstruują już niczego — czytają
`context.locals.data.inventory`. Polityka „magazyn niedostępny" zapada
**raz**, w jednym mapowaniu `DomainError → status` (`store_unavailable` → 503).

---

## KROK 5 — Dowód izolacji i before/after

### 5.1 Kto zna zależność: dziś vs po refaktorze

| Plik                                                    | Dziś | Po   | Dlaczego przestaje wiedzieć                                                                |
| ------------------------------------------------------- | ---- | ---- | ------------------------------------------------------------------------------------------ |
| `src/lib/adapters/supabase/*` (7 plików)                | —    | ✅   | **jedyne** miejsce importu `@supabase/*`                                                   |
| `src/lib/supabase.ts`                                   | ✅   | —    | przeniesiony → `adapters/supabase/client.adapter.ts`                                       |
| `src/env.d.ts`                                          | ✅   | ❌   | `App.Locals` typowane bytami domenowymi (§4.8)                                             |
| `src/lib/services/product.service.ts`                   | ✅   | ❌   | zapytania → adapter; reguły → `ExpiryDate` / `Inventory`                                   |
| `src/lib/services/recipe.service.ts`                    | ✅   | ❌   | `listRecipes`/`approveRecipe` → `RecipeStore`                                              |
| `src/middleware.ts`                                     | ✅   | ❌   | woła `openDataAccess()`, widzi wyłącznie porty                                             |
| `src/pages/api/auth/{signin,signup,signout}.ts`         | ✅   | ❌   | wołają `locals.data.session`                                                               |
| `src/pages/api/products/index.ts`                       | ✅   | ❌   | `locals.data.inventory`                                                                    |
| `src/pages/api/products/[id].ts`                        | ✅   | ❌   | jw. + `DomainError("product_not_found")` zamiast stringa                                   |
| `src/pages/api/recipes/{index,generate,approve}.ts`     | ✅   | ❌   | `locals.data.recipes` / `.inventory`                                                       |
| `src/pages/inventory.astro`                             | ✅   | ❌   | `Astro.locals.data.inventory.list(account.id)`                                             |
| `src/pages/recipes.astro`                               | ✅   | ❌   | `Astro.locals.data.recipes.page(account.id, 1)`                                            |
| `src/lib/config-status.ts` + `src/layouts/Layout.astro` | ✅   | ❌   | komunikat traci nazwę dostawcy (§5.3)                                                      |
| `product.service.test.ts`, `recipe.service.test.ts`     | ✅   | ❌   | testują czystą domenę — atrapy D4 znikają, nie są zastępowane                              |
| 4 suity `*.integration.test.ts`                         | ✅   | ✅\* | \*przenoszone do `src/lib/adapters/supabase/` — to **testy adaptera** i mają znać dostawcę |

**Kryterium sukcesu (KROK 6):**

```bash
grep -rln "@supabase/" src
# oczekiwane wyjście — wyłącznie:
#   src/lib/adapters/supabase/client.adapter.ts
#   src/lib/adapters/supabase/database.types.ts
#   src/lib/adapters/supabase/inventory.store.ts
#   src/lib/adapters/supabase/recipe.store.ts
#   src/lib/adapters/supabase/session.gateway.ts
#   src/lib/adapters/supabase/row.mapper.ts
#   src/lib/adapters/supabase/*.integration.test.ts
```

17 plików produkcyjnych → **6**, wszystkie w jednym katalogu.
Wymiana dostawcy = napisanie drugiego katalogu obok i zmiana jednej linii
w `openDataAccess`. Tabele, kontrakt API i UI pozostają nietknięte.

### 5.2 Before / after dla każdego miejsca duplikacji

**D1 + D2 — konstrukcja i polityka niedostępności**

```ts
// BEFORE — src/pages/api/products/index.ts:17-23 (i 12 analogicznych miejsc)
const supabase = createClient(context.request.headers, context.cookies);
if (!supabase) return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
if (!context.locals.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
const products = await listProducts(supabase, context.locals.user.id);

// AFTER
const { data, account } = context.locals;
if (!data) return problem("store_unavailable"); // 503 — jedno mapowanie dla całej aplikacji
if (!account) return problem("unauthenticated"); // 401
const inventory = await data.inventory.list(account.id);
```

**D3 — reguła własności**

```ts
// BEFORE — sześć niezależnych implementacji:
//   product.service.ts:55, :79, :96-97 · recipe.service.ts:247
//   …report_deleted.sql:18, :21, :27
// AFTER — jedno miejsce w warstwie aplikacyjnej (inventory.store.ts, recipe.store.ts),
//   nadal podparte RLS w SQL. lessons.md:5-10 przestaje być regułą do zapamiętania
//   przy pisaniu każdego zapytania, a staje się właściwością jednego katalogu.
```

**D4 — atrapy w testach**

```ts
// BEFORE — product.service.test.ts:73-82: atrapa kodująca „chain is thenable only at .order()"
// AFTER  — testy jednostkowe nie znają dostawcy:
const store: InventoryStore = fakeInventoryStore([item("mleko", "2026-09-01")]);
// Zachowanie względem prawdziwego PostgREST pokrywa jedna suita integracyjna adaptera.
```

**D5 — „dzisiaj w UTC"**

```ts
// BEFORE — product.service.ts:12-16 ORAZ pages/api/products/index.ts:13
// AFTER  — CalendarDay.today(); walidacja wejścia to ExpiryDate.fromInput(value, today),
//          wywołana z handlera, ale zaimplementowana raz w domenie.
```

### 5.3 UI dostaje dane domenowe, nie surowy obiekt biblioteki

| Miejsce                                     | Before                                                     | After                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Topbar.astro:2,11`, `dashboard.astro:4,14` | `Astro.locals.user` typu `@supabase/supabase-js.User`      | `Astro.locals.account` typu domenowego `Account`                                                                                       |
| `inventory.astro:10-17`                     | buduje klienta dostawcy w szablonie                        | `Astro.locals.data.inventory.list(account.id)` → `ProductView[]`                                                                       |
| `recipes.astro:14-22`                       | jw.                                                        | `Astro.locals.data.recipes.page(account.id, 1)`                                                                                        |
| `inventory-panel.tsx:223,229,234`           | `is_at_risk` / `is_expired` / `expiry_date` — nazwy kolumn | `atRisk` / `expired` / `expiresOn` z `ProductItem.toWire()` — kontrakt domenowy                                                        |
| `inventory-panel.tsx:129`                   | `a.expiry_date.localeCompare(b.expiry_date)`               | kolejność należy do `Inventory`, klient jej nie odtwarza                                                                               |
| `Layout.astro:25` ← `config-status.ts:15`   | „**Supabase** nie jest skonfigurowany…" + URL startera     | „Magazyn danych nie jest skonfigurowany — funkcje konta są wyłączone."; nazwa dostawcy zostaje w `adapters/supabase/` i w logu serwera |
| `signin.ts:16`, `signup.ts:16`              | `error.message` dostawcy w query stringu redirectu         | `DomainError("bad_credentials")` → nasz komunikat (ta sama higiena, co `service-error.ts:1-8`)                                         |

### 5.4 Pytania zależne od kontraktu biblioteki — rozstrzygnięcia

Źródło: dokumentacja `postgrest-js` / `supabase-js` (Context7,
`/supabase/postgrest-js`, `/supabase/supabase-js`, sprawdzone 2026-08-29).

**Q1 — czy `count === 0` po DELETE oznacza „nie istnieje", czy „nie twoje"?**
Dokumentacja: `count` jest parsowany z nagłówka `Content-Range`, niezależnie od
ciała odpowiedzi. RLS i `.eq("user_id", …)` odfiltrowują wiersze **przed**
zliczeniem — kontrakt nie rozróżnia tych dwóch przypadków i rozróżnić ich nie
może. **Decyzja:** świadomie je scalamy w `DomainError("product_not_found")`;
to również jedyna bezpieczna odpowiedź, bo rozróżnienie potwierdzałoby istnienie
cudzego wiersza (`prd.md:41`). **Zakodować w:**
`src/lib/adapters/supabase/inventory.store.ts` — nie w
`pages/api/products/[id].ts:26`, gdzie dziś jest dopasowaniem stringa.

**Q2 — dlaczego RPC wymaga `.overrideTypes<>()` i `as unknown as`?**
Dokumentacja: bez wygenerowanych typów `Database` inferencja kształtu wyniku
(obiekt vs tablica) jest „entirely inaccessible"; `createClient<Database>` jest
generyczne po to, by te typy przyjąć. **Decyzja:** wygenerować
`supabase gen types typescript --local > src/lib/adapters/supabase/database.types.ts`
i przekazać do `createServerClient<Database>`. Oba rzutowania
(`recipe.service.ts:269`, `:276`) znikają. **Zakodować w:** adapterze; typy
generowane są artefaktem adaptera, nie warstwy współdzielonej.

**Q3 — czy `.range()` poza końcem zbioru zwraca błąd?**
Dokumentacja: `range(from, to)` ustawia parametry `offset` i `limit`, jest
0-based i domknięty; **nie definiuje błędu** dla zakresu poza zbiorem, ale
wymaga towarzyszącego `order()` dla deterministycznych granic stron. Potwierdza
to komentarz w `recipe.service.ts:236-240`. **Decyzja:** semantyka „strona poza
końcem = pusta lista + prawdziwy `total`" **oraz** wymóg sortowania stają się
częścią kontraktu portu `RecipeStore.page` (§4.5), żeby przyszły adapter nie
mógł po cichu porzucić `order()`. **Zakodować w:** doksie interfejsu
`RecipeStore` + `recipe.store.ts`; endpoint `recipes/index.ts` przestaje
cokolwiek wiedzieć o PostgREST.

**Q4 — koszt `{ count: "exact" }`.** Dokumentacja: `count` przyjeżdża
nagłówkiem niezależnie od `.select()`, ale `exact` to pełne `COUNT` przy każdym
odczycie strony. Przy `target_scale.users: small` (`prd.md:8-10`) to nie jest
problem MVP. **Decyzja:** port zwraca `total`, nie „dokładny total" — dzięki
temu adapter może kiedyś przejść na `planned` bez zmiany kontraktu.
**Zakodować w:** komentarzu kontraktu portu.

---

## KROK 6 — Weryfikacja i plan

### 6.1 Kryteria wyjścia (sprawdzalne)

1. `grep -rln "@supabase/" src` → wyłącznie `src/lib/adapters/supabase/**` (§5.1).
2. `grep -rn "@supabase\|Supabase" src/components src/layouts src/pages/*.astro` → pusto.
3. `grep -rn "createClient(" src/pages src/middleware.ts` → pusto.
4. `grep -rn "Service unavailable" src` → jedno wystąpienie (mapowanie `DomainError`).
5. `grep -rn "not found\"" src/pages` → pusto (koniec dopasowań po stringu).
6. `grep -rn "as unknown as SupabaseClient" src` → pusto.
7. `npm run typecheck` i `npm run lint` czyste; osiem linii `eslint-disable`
   z §D4 usuniętych, nie przeniesionych.
8. `npm run test` zielone; `tests/generate-approve.spec.ts` (E2E) przechodzi
   **bez zmian** po fazach 1–4 — zmiana kontraktu wire to dopiero faza 5.

### 6.2 Plan faz

Zgodny z konwencją projektu: `/10x-new` zakłada `context/changes/<change-id>/`,
dalej `/10x-research` → `/10x-plan` → `/10x-tdd` (fazy czysto domenowe) lub
`/10x-implement`. Migracje w formacie `YYYYMMDDHHmmss_opis.sql`.

| Faza  | Zakres                                                                                                                                                                           | Test-first | Kryterium wyjścia                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| **1** | `src/lib/domain/`: `expiry-date.vo.ts`, `account.vo.ts`, `product-item.entity.ts`, `domain-error.ts`. Czyste, bez I/O                                                            | **tak**    | Testy z `product.service.test.ts:1-62` przeniesione i zielone; zero importów zewnętrznych w katalogu |
| **2** | `data-access.port.ts` + `src/lib/adapters/supabase/`: `client.adapter.ts` (przeniesienie `src/lib/supabase.ts`), `database.types.ts` (Q2), `row.mapper.ts`, `inventory.store.ts` | częściowo  | 4 suity `*.integration.test.ts` przeniesione obok adaptera i zielone przy `npx supabase start`       |
| **3** | Kompozycja: `openDataAccess()`, `middleware.ts`, `env.d.ts` → typy domenowe. **Stare serwisy nietknięte** — aplikacja działa przez całą fazę                                     | **tak**    | `npm run test` zielone; E2E przechodzi bez zmian                                                     |
| **4** | Migracja wywołujących: 9 handlerów API + `inventory.astro` + `recipes.astro` na porty; `recipe.store.ts`; usunięcie `SupabaseClient` z sygnatur serwisów                         | **tak**    | Kryteria 1–6 z §6.1 spełnione                                                                        |
| **5** | Kontrakt wire: `ProductItem.toWire()` (`expiresOn`/`atRisk`/`expired`), aktualizacja `inventory-panel.tsx` i `use-recipe-generation.ts`, E2E                                     | **tak**    | E2E zaktualizowany i zielony; `src/types.ts` przestaje być typem wiersza tabeli                      |
| **6** | Higiena komunikatów: `config-status.ts` bez nazwy dostawcy; `signin`/`signup` przez `DomainError("bad_credentials")`                                                             | częściowo  | Kryterium 2 z §6.1; żaden komunikat UI nie zawiera nazwy dostawcy                                    |
| **7** | Sprzątanie i rejestracja nazw: `CLAUDE.md` (reguła `createClient()` zastąpiona regułą o granicy adaptera), `test-plan.md` §8, `lessons.md`                                       | —          | Brak martwego kodu; `CLAUDE.md:5` opisuje stan faktyczny                                             |

Kolejność 3 → 4 jest celowa: przez całą fazę 3 działają obie ścieżki, więc żaden
commit nie zostawia aplikacji zepsutej — ta sama dyscyplina, co w `02-…:§5.5`.

Testy mutacyjne (`CLAUDE.md` §Mutation testing): po fazie 1 uruchomić Stryker
z zawężeniem `--mutate "src/lib/domain/expiry-date.vo.ts"` — to moduł, który
wchłania regułę at-risk z `test-plan.md` §2 Ryzyko #1. Przeżyte mutanty
przeglądać pojedynczo.

### 6.3 Powtórzenie wzorca dla osi B (poza zakresem tego planu)

Po fazie 7 ten sam kształt stosuje się do dostawcy LLM: port `RecipeGenerator`
(`propose(inventory: Inventory, params, exclude): Promise<RecipeProposal>`),
adapter `src/lib/adapters/openrouter/`, a reguły rdzenia — kolejność
at-risk-first (`recipe.service.ts:104`), kontrola id (`:213-219`) i at-risk floor
(`:224-231`) — przenoszą się **przed** port, do `Inventory` i `RecipeProposal`.
Dopiero wtedy komentarz „Swap to … if the limit bites" (`recipe.service.ts:18`)
i klasyfikacja z `01-…:123` będą prawdziwe.

### 6.4 Nazwy „load-bearing" do zarejestrowania

Projekt nie ma osobnego rejestru kontraktów; rolę tę pełnią `CLAUDE.md`,
`context/foundation/test-plan.md` §8 i `context/foundation/lessons.md`
(za `02-…:§5.4`).

| Nazwa                                                                        | Rodzaj            | Gdzie zarejestrować                                               |
| ---------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `src/lib/adapters/<dostawca>/`                                               | nowa warstwa      | `CLAUDE.md` §Key conventions                                      |
| `ExpiryDate`, `CalendarDay`, `AT_RISK_DAYS`                                  | value objecty     | `CLAUDE.md`, `prd.md` (Ubiquitous Language)                       |
| `Account` / `AccountId` (zamiast `User` dostawcy)                            | value object      | `CLAUDE.md`, `src/env.d.ts`                                       |
| `InventoryStore` / `RecipeStore` / `SessionGateway` / `DataAccess`           | porty             | `CLAUDE.md` §Architecture                                         |
| `openDataAccess()`                                                           | punkt kompozycji  | `CLAUDE.md` — zastępuje regułę o `createClient()` (`CLAUDE.md:5`) |
| `store_unavailable`, `store_failure`, `product_not_found`, `bad_credentials` | `DomainErrorKind` | `CLAUDE.md` obok `ServiceError`; `test-plan.md` §2 Ryzyko #6      |
| `ProductView` (`expiresOn` / `atRisk` / `expired`)                           | kontrakt API      | `CLAUDE.md` §API routes                                           |

### 6.5 Ryzyka planu

- **Faza 5 zmienia kontrakt wire.** Przemianowanie `expiry_date` → `expiresOn`
  dotyka E2E (`tests/generate-approve.spec.ts`) i wyspy Reacta. Jest wydzielona
  jako osobna faza właśnie dlatego; fazy 1–4 są niewidoczne dla użytkownika.
- **Generowane `database.types.ts` wymagają działającego lokalnego Supabase.**
  Ta sama zależność, którą mają dziś suity integracyjne (`describe.skipIf`
  w `products/index.integration.test.ts:22-44`) — nie jest to nowy warunek.
- **Rozszerzanie `DomainErrorKind` kolidowałoby z `02-…`, gdyby oba plany szły
  równolegle.** Sekwencja: najpierw `02-…` fazy 0–2 (`DomainError` powstaje tam),
  potem ten plan. Jeśli kolejność się odwróci, `domain-error.ts` powstaje tutaj,
  a tamten plan go rozszerza.
- **Wysiłek jest realny: 17 plików produkcyjnych.** Fazowanie gwarantuje, że po
  każdej fazie aplikacja się buduje i E2E przechodzi, ale to nie jest zmiana
  jednowieczorna. Uzasadnieniem nie jest hipotetyczna wymiana Supabase, lecz
  koszt bieżący: dziś każdy nowy endpoint powtarza D1, D2 i D3.
