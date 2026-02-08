---
ID: 20260208-process-instagram
Date: 2026-02-08
Status: Active
Topic: Instagram Complete Process (Login, Navigation, Scraping)
---

# 📸 Instagram Prozess-Dokumentation (Single Source of Truth)

Dieses Dokument beschreibt den VÖLLSTÄNDIGEN Prozess für Instagram – vom Login über die Navigation bis zum Scraping der Following-Liste.
Der Agent MUSS sich strikt an diese Vorgaben halten.

---

## 1. Login-Phase

### A. Start
- URL: `https://www.instagram.com/accounts/login/`
- Warten: 5 Sekunden
- Popups entfernen:
  - Cookie-Layer ("Alle akzeptieren", "Allow all cookies")
  - "Jetzt nicht"-Dialoge

### B. Login-Varianten
1.  **Gespeicherter Account ("Weiter"-Button):**
    - Selektor: `button:has-text("Weiter")`, `div[role="button"]:has-text("Weiter")`
    - Aktion: Klick -> Warten -> Prüfen ob Passwortfeld erscheint
    - Falls Passwortfeld: Eingeben -> "Anmelden" klicken
2.  **Standard Login:**
    - Felder: `input[name="username"]`, `input[name="password"]`
    - Aktion: Ausfüllen -> "Anmelden"

---

## 2. Navigations-Phase (Zum Profil)

1.  **Ziel-URL:** `https://www.instagram.com/[USERNAME]/`
2.  **Warten:**
    - Auf Body-Content warten (nicht nur Netzwerkleerlauf).
    - Prüfen, ob wir auf einer "Diese Seite ist leider nicht verfügbar"-Seite gelandet sind.
3.  **Metriken lesen:**
    - Header-Informationen auslesen (z.B. "175 Gefolgt").
    - Selektor für Following-Count Link: `a[href$="/following/"]`

---

## 3. Scraping-Phase (Die Liste)

### A. Öffnen der Liste
1.  **Klick:** Auf den Link "Gefolgt" / "Following" (`a[href*="/following/"]`).
2.  **Verifikation:**
    - URL ändert sich zu `.../following/`
    - Ein Dialog (`role="dialog"`) öffnet sich.
    - **FEHLERQUELLE:** Wenn kein Dialog kommt -> Screenshot -> Bot-Verdacht möglich.

### B. Durchlaufen der Liste (Scrolling)
Das ist der kritischste Teil. Die Liste lädt dynamisch ("Infinite Scroll").

1.  **Scroll-Container finden:**
    - Der Container ist NICHT `window`, sondern ein spezifisches `div` im Dialog.
    - Selektor: `div[role="dialog"] div[style*="overflow"]` (oft `overflow-y: auto`).
2.  **Scroll-Logik:**
    - Wir nutzen **API Interception** (lauschen auf Netzwerk-Antworten), nicht DOM-Parsing (zu unzuverlässig).
    - Aktion:
        - Simulations-Script scrollt das Element via JS (`scrollTop += 600`).
        - Alternativ: Mausrad über dem Dialog.
    - **WICHTIG:** Nach jedem Scroll **3.5 - 5.5 Sekunden warten**! Die API ist langsam/gedrosselt.
3.  **Abbruch-Bedingungen:**
    - "Keine neuen Daten": Wenn nach 15 Scrolls keine neuen API-Responses kamen.
    - Quota erreicht:
        - **Follows:** 95% der erwarteten Anzahl gefunden.
        - **Unfollows:** Auch 95% (zur Sicherheit).

### C. Fehlerbehandlung beim Scraping
1.  **Liste lädt nicht (Spinner dreht ewig):** könnte Soft-Ban oder schlechte Connection sein. -> Abbruch + Screenshot.
2.  **Container nicht gefunden:** Instagram hat das Layout geändert. -> Doku Update nötig!
3.  **Scrollen bewirkt nichts:** Container-Selektor falsch oder Event-Blocking. -> Mausrad-Simulation nutzen.

---
*Letztes Update: 2026-02-08*
