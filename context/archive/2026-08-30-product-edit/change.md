---
change_id: product-edit
title: Edit existing pantry product via modal in inventory panel
status: archived
created: 2026-08-30
updated: 2026-09-04
archived_at: 2026-09-04T07:45:35Z
---

## Notes

dodaj edycję istniejącego produktu w spiżarni — okno dialogowe (modal) uruchamiane z inventory-panel.tsx, pozwalające zmienić nazwę i datę ważności. Backend: brakuje updateProduct w product.service.ts oraz PATCH w src/pages/api/products/[id].ts (obecnie tylko GET/POST na index, DELETE na [id]); RLS UPDATE policy dla authenticated już istnieje (products_update_authenticated w 20260531120000_initial_schema.sql), więc migracja nie powinna być potrzebna. Walidacja taka sama jak przy tworzeniu (name 1–255 znaków, expiry_date dzisiaj lub później). Modal ma wzorować się na istniejącym radix-ui Dialog z recipe-history-panel.tsx (house rule: bez nowego shadcn primitive).
