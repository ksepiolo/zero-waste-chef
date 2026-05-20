## zero-waste-chef - MVP

### Glowny problem
Użytkownik wie że marnuje jedzenie, ale nie wie co konkretnie jest zagrożone — przez to wyrzuca produkty i traci pieniądze.

### Najmniejszy zestaw funkcjonalnosci 
- Logowanie przez email i hasło, w celu izolacji danych uzytkownika (produkty i przepisy)
- Dodaj produkt (nazwa + data ważności)
- Lista produktów z oznaczeniem zagrożonych
- Usuń produkt ręcznie
- Generuj przepis (AI) na ządanie uzytkownika
- Ekran zatwierdzenia (przepis + lista produktów do usunięcia)
- Zatwierdź - auto-aktualizacja inwentarza
- Lista wygenerowanych przepisów przepisów


### Co NIE wchodzi w zakres MVP
- Edycja produktu (usuń + dodaj ponownie wystarczy)
- Wyszukiwanie / filtrowanie
- Szczegóły przepisu osobna strona (wystarczy lista)
- Powiadomienia o wygasających produktach 
- Śledzenie ilości produktów (ml, g, szt) — MVP traktuje produkt jako obecny/nieobecny
- Skanowanie paragonów / kodów kreskowych
- Parser naturalnego języka do dodawania produktów

### Kryterium sukcesu
- AI generuje przepis który zawiera co najmniej jeden produkt zagrożony (wygasający najwcześniej)
- Po zatwierdzeniu przepisu użyte produkty znikają z inwentarza — stan bazy jest spójny z tym co pokazał ekran zatwierdzenia
- Ekran główny natychmiast pokazuje które produkty są zagrożone 