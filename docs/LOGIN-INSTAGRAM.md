---
ID: 20260208-login-instagram
Date: 2026-02-08
Status: Active
Topic: Instagram Login & Navigation Process
---

# 📸 Instagram Login & Navigation Protokoll

Dieses Dokument ist die **Single Source of Truth** für den Instagram Login- und Navigationsprozess im Smart Monitoring System.
Es beschreibt exakt, wie der Browser gesteuert werden muss, welche Selektoren verwendet werden und wie auf verschiedene Szenarien reagiert wird.

**WICHTIG:** Wenn sich das Verhalten von Instagram ändert (z.B. neue Buttons, andere Texte), MUSS dieses Dokument aktualisiert werden!

---

## 1. Browser Start & Initialisierung

- **Browser:** Firefox (Persistent Context)
- **URL:** `https://www.instagram.com/accounts/login/`
- **Wartezeit:** Initial 5 Sekunden warten, damit alle Skripte laden können.
- **Popup-Bereinigung:**
  - Suche nach Cookie-Layern ("Alle akzeptieren", "Allow all cookies").
  - Suche nach "Jetzt nicht" Dialogen für Benachrichtigungen.

## 2. Login-Szenarien

### Szenario A: Gespeicherter Account ("Weiter"-Button)
Das System erkennt einen bereits bekannten Account.

1. **Erkennung:**
   - Suche nach Button/Div mit Text "Weiter", "Continue", "Log in as".
   - Selektoren: `button:has-text("Weiter")`, `div[role="button"]:has-text("Weiter")`.
2. **Aktion:**
   - Klicke auf den Button.
   - Warte 3 Sekunden.
3. **Folge-Check (Passwort-Abfrage):**
   - Prüfe, ob **nur** ein Passwort-Feld (`input[name="password"]`) erscheint, aber **kein** Username-Feld.
   - **Falls JA:**
     - Passwort aus `INSTAGRAM_PASSWORD` eingeben.
     - Klicke "Anmelden" (`button:has-text("Anmelden")`, `button[type="submit"]`).
   - **Falls NEIN:**
     - Login gilt als erfolgreich, wenn URL nicht mehr `/login` enthält.

### Szenario B: Standard Login (Username & Passwort)
Kein gespeicherter Account oder expliziter Logout.

1. **Erkennung:**
   - Eingabefelder für Username (`input[name="username"]`) und Passwort (`input[name="password"]`) sind sichtbar.
2. **Aktion:**
   - Username eingeben.
   - Passwort eingeben.
   - Klicke "Anmelden".
3. **Verifikation:**
   - Warte auf Navigation zur Startseite.
   - Prüfe auf Elemente wie `nav` oder Such-Icon.

---

## 3. Navigation zum Profil

1. **URL aufrufen:** `https://www.instagram.com/[USERNAME]/`
2. **Warten:** Warte bis `body` Text enthält (Indikator für geladenen Content).
3. **Daten extrahieren:**
   - Following-Zahl aus Header lesen (Link mit Text "following", "abonniert").

## 4. Öffnen der Following-Liste

1. **Button finden:**
   - Suche nach Link/Button, der zur Following-Liste führt.
   - Selektor: `a[href*="/following/"]`.
2. **Aktion:**
   - Klicke auf den Link.
3. **Verifikation:**
   - Prüfe, ob sich die URL zu `.../following/` ändert.
   - Prüfe, ob ein Dialog-Fenster (`role="dialog"`) geöffnet wurde.
   - **Fehlerfall:** Wenn kein Dialog erscheint -> Screenshot machen + Alarm!

## 5. Scraping der Liste (Scrolling)

1. **Container finden:**
   - Suche den scrollbaren Bereich im Dialog (`div[role="dialog"] div[style*="overflow"]`).
2. **Aktion:**
   - Führe Scroll-Bewegungen aus (JS oder Mausrad).
   - Warte nach jedem Scroll (3.5 - 5.5 Sekunden) auf API-Antworten.
3. **Abbruch-Bedingungen:**
   - Ende der Liste erreicht.
   - `maxNoNewCount` (15) Scrolls ohne neue Daten.
   - Quote erfüllt (95% bei Follows, 95% bei Unfollows zur Sicherheit).

---

## 🔧 Fehlerbehandlung & Updates

**Wenn ein Schritt fehlschlägt:**
1. **Screenshot erstellen:** `public/debug/` prüfen.
2. **Analyse:**
   - Hat sich der Text des Buttons geändert? (z.B. "Weiter" -> "Next")
   - Hat sich die ID/Klasse geändert?
3. **DOKUMENT UPDATE:**
   - Trage die Änderung HIER in dieses Dokument ein.
   - Aktualisiere den Code (`smart-monitor-v4.ts`) entsprechend der neuen Doku.

---
*Letztes Update: 2026-02-08*
