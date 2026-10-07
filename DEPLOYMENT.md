# Wdrożenie Abyss Spin: Vercel + Supabase

Wdrożenie używa Vercel Functions (Node.js) do istniejącego API `/api/*` i Supabase PostgreSQL do kont, sesji, zapisów, czatu, znajomych, EXP oraz ustawień. Lokalny `server.py` i jego SQLite nie są zmieniane.

## 1. Przygotuj Supabase

1. Utwórz projekt Supabase i zachowaj hasło bazy w menedżerze haseł.
2. W **SQL Editor** uruchom cały plik `migrations/001_initial_schema.sql`.
3. W **Project Settings → Database → Connection string** skopiuj URI poolera **Session mode**, port `5432`. Nie używaj klucza `service_role` w aplikacji przeglądarkowej ani nie umieszczaj hasła w repozytorium.

## 2. Przygotuj Vercel

1. Umieść folder w prywatnym repozytorium GitHub i zaimportuj je do Vercel albo wdrażaj folder przez Vercel CLI.
2. Dodaj w ustawieniach projektu Vercel zmienną `DATABASE_URL` z URI Supabase; ustaw ją osobno dla Production, Preview i Development, jeśli mają używać różnych baz.
3. Wygeneruj losowy klucz szyfrowania hasła SMTP poleceniem:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Zapisz wynik jako `SMTP_ENCRYPTION_KEY` w ustawieniach Vercel (to sekret 32 bajtów, 64 znaki hex). Nie wpisuj wartości do `.env.example`, kodu ani dokumentacji. Utrata lub zmiana klucza uniemożliwi odszyfrowanie zapisanego hasła SMTP; pozostałe ustawienia i dane pozostaną dostępne.
4. Zainstaluj zależności (`npm install`), wypchnij zmiany i uruchom deployment. W Vercel **Settings → Environment Variables** dodaje się sekrety — nie do repozytorium.
5. Zanim udostępnisz adres innym osobom, utwórz pierwsze konto — zostaje administratorem i jest automatycznie zatwierdzone; kolejne wymagają akceptacji. Jeśli to możliwe, chroń wdrożenie Vercel do czasu utworzenia konta administratora.

## 3. Konfiguracja funkcji w aplikacji

- **Webhook Discorda:** zaloguj się jako administrator, skonfiguruj webhook w panelu administracyjnym.
- **Reset hasła:** ustaw SMTP w panelu administratora; `SMTP_ENCRYPTION_KEY` musi być już ustawiony przed zapisaniem hasła SMTP. `Adres aplikacji` musi wskazywać publiczną domenę HTTPS Vercel, np. `https://twoja-aplikacja.vercel.app`. W ustawieniach SMTP zachowaj puste pole hasła, aby nie zmieniać zapisanego hasła.
- Uruchomienie poczty zależy od serwera SMTP i dostępności połączeń wychodzących z funkcji. Użyj dostawcy, który zezwala na SMTP/TLS z Vercel; przy blokadzie portu należy przełączyć wysyłkę na dostawcę e-mail oferującego API.

## Dane lokalne i migracja

Wdrożenie nie kopiuje kont, haseł, ustawień ani historii z lokalnej bazy SQLite. Baza lokalna pozostaje bez zmian i nadal działa przez `start-abyssspin.bat`; środowisko Vercel/Supabase zaczyna z nową bazą. Użytkownicy muszą zarejestrować konta ponownie. Nie przenoś ręcznie hashy haseł ani wartości DPAPI SMTP — lokalne hasło SMTP jest zaszyfrowane kluczem Windows i nie jest zgodne z szyfrowaniem hostowanym.

## Zmienne środowiskowe

| Zmienna | Wymagana | Zastosowanie |
| --- | --- | --- |
| `DATABASE_URL` | Tak | Prywatne połączenie funkcji Vercel z PostgreSQL Supabase. |
| `SMTP_ENCRYPTION_KEY` | Do zapisywania hasła SMTP | Szyfrowanie AES-256-GCM ustawień SMTP w bazie. |

Lokalny serwer Python nie korzysta z tych zmiennych.
