## Mål

Demogruppen ska kunna skapa konto via vanliga `/registrera`-formuläret men slippa både e-postverifiering och betalning — utan att vanliga besökare märker något. Lösningen: **inbjudningskod**.

## Så fungerar det

1. På `/registrera` läggs ett extra valfritt fält till: **"Inbjudningskod (valfritt)"**.
2. Vanliga användare lämnar fältet tomt → registrering fungerar precis som idag.
3. Demotestare skriver in koden du delat ut (t.ex. `MINNEN-DEMO-2026`) → kontot skapas, e-postverifiering hoppas över, och kontot får automatiskt **Premium**-status.

## Tekniska steg

### Backend
1. **Ny tabell `invite_codes`** med kolumner:
   - `code` (unik text)
   - `grants_premium` (boolean)
   - `skip_email_verification` (boolean)
   - `max_uses` (int, null = obegränsat)
   - `used_count` (int)
   - `expires_at` (timestamp, null = aldrig)
   - `active` (boolean)
   - RLS: ingen läsning från klienten — bara edge functions via service role.

2. **Ny edge function `redeem-invite-code`**
   - Tar emot e-post, lösenord, namn och kod.
   - Validerar koden (aktiv, inte utgången, inom max_uses).
   - Skapar användaren via `auth.admin.createUser` med `email_confirm: true`.
   - Loggar in användaren och returnerar session.
   - Höjer `used_count`.
   - Lägger till en rad i en ny `premium_overrides`-tabell (eller sätter ett flagg-fält på `profiles`) så användaren behandlas som Premium utan Stripe-betalning.

3. **Premium-status utan Stripe**
   - Tillägg av kolumn `profiles.is_premium_override` (boolean) ELLER ny tabell `premium_grants(user_id, source, granted_at)`.
   - Befintlig logik som kollar Premium-status uppdateras att acceptera override-flaggan.

### Frontend
4. **Uppdatera `/registrera` (`Register.tsx`)**
   - Litet kollapsbart fält längst ner: *"Har du en inbjudningskod? (valfritt)"*.
   - Om ifylld → anropa `redeem-invite-code` istället för vanlig `signUp`.
   - Om tom → behåll dagens flöde (vanlig signup med e-postbekräftelse).

5. **Skapa själva koden**
   - Jag lägger in en startkod i tabellen, t.ex. `MINNEN-DEMO-2026`, max 50 användningar, giltig 90 dagar.
   - Du kan be mig skapa fler koder när som helst.

## Vad det INTE innebär

- Inga publika ändringar i UI:t — bara ett valfritt fält som ser oansenligt ut.
- Inga ändringar i Stripe-flödet. Riktiga köp fungerar precis som idag.
- E-postverifiering är fortfarande på som standard för alla utan kod.

## Senare/valfritt

- Admin-vy för att skapa, inaktivera och se användning av koder (kan läggas till i `/admin` när du behöver det).
- Statistik per kod (hur många registrerade, när).
