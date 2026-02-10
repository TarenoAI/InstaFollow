# 🚀 VPS Handbuch: Nutzung & Testing

Dieses Dokument beschreibt, wie du die verschiedenen Komponenten des InstaFollow-Systems auf dem VPS testest und überwachst.

---

## 🔐 1. Login-Status prüfen

### Instagram Login testen
Prüft, ob die Session noch gültig ist. Falls nicht, wird ein automatischer Login-Versuch unternommen.
```bash
npx tsx scripts/auth/auto-instagram-login.ts
```
*   **Ergebnis:** Zeigt "✅ INSTAGRAM LOGIN ERFOLGREICH" oder fordert zur manuellen Reparatur via VNC auf.

### X (Twitter) Login testen
Prüft, ob der Home-Feed sichtbar ist, macht einen Screenshot und aktualisiert den Status in der Datenbank.
```bash
npx tsx scripts/utils/check-twitter-login.ts
```
*   **Ergebnis:** Screenshot unter `public/debug/twitter-status-check.png` (wird auch nach GitHub gepusht).

---

## � 2.1 Diagnose & Fehlersuche

Falls der Scraper blockiert wird oder keine Daten lädt, nutze das Step-by-Step Tool. Es macht nach jeder Aktion (Klick, Scroll, Wartezeit) einen Screenshot, damit du genau siehst, wo Instagram dich stoppt.

### Step-by-Step Test ausführen
```bash
npx tsx scripts/debug/step-by-step-instagram-test.ts [username]
```
*   **Ergebnis:** Screenshots landen unter `public/debug/step-test/`.
*   **Wichtig:** Vergleiche die Bilder mit der [Instagram Prozess-Doku](LOGIN-INSTAGRAM.md).

---

## �📸 3. Scraping & Monitoring

### Einzelnes Konto manuell scrapen
Ideal, um zu sehen, ob ein bestimmtes Profil (z.B. @morewatchez) Probleme macht.
```bash
npx tsx scripts/monitors/smart-monitor-v4.ts morewatchez
```

### Monitoring-Status (Zusammenfassung)
Zeigt die letzten 20 Scrapes aus der Datenbank an (Erfolg, Fehler, Prozentsatz).
```bash
npx tsx scripts/debug/check-monitoring-status.ts
```

### Vollständige Monitoring-Logs einsehen
Live-Ansicht dessen, was der Monitor gerade im Hintergrund tut:
```bash
tail -f /var/log/instafollow-monitor.log

## letzten 100 Zeilen
tail -n 100 /var/log/instafollow-monitor.log
```

---

## 🕒 3. Cron-Jobs & Prozesse

### Aktive Cron-Tabelle anzeigen
```bash
crontab -l
```
*   `0 * * * *` -> Monitor läuft stündlich zur vollen Stunde.
*   `30 * * * *` -> Queue-Prozessor läuft stündlich um halb.

### Prüfen, ob Prozesse gerade laufen
```bash
pgrep -af node
```
*   Sollte `smart-monitor-v4.ts` oder `server.js` (Next.js) anzeigen.

### Laufende Prozesse stoppen (Cleanup)
Falls sich etwas aufgehängt hat:
```bash
pkill -f "smart-monitor"
pkill -f "queue-processor"
```

---

## 🐦 4. X/Twitter Queue & Retries

### Warteschlange (Queue) prüfen
Zeigt an, wie viele Posts wegen Fehlern (z.B. kurzzeitiger Logout) auf einen erneuten Versuch warten.
```bash
npx tsx scripts/debug/check-twitter-queue.ts
```

### Unverarbeitete Events nachholen (Retry)
Holt alle Events mit `processed = 0` nach und postet sie mit **15 Minuten Abstand**.
```bash
# Im Hintergrund starten (empfohlen):
nohup npx tsx scripts/utils/retry-unprocessed-events.ts > /var/log/retry-events.log 2>&1 &
```

---

## 📂 5. Wichtige Pfade & Dateien

*   **Logs:** `/var/log/instafollow-monitor.log`
*   **Screenshots:** `public/debug/` (via GitHub einsehbar)
*   **Sessions:** `data/browser-profiles/`
*   **Projekt-Hauptordner:** `~/InstaFollow`

---

## 🔄 6. System aktualisieren
Nach Änderungen am Code auf dem Mac immer auf dem VPS ausführen:
```bash
cd ~/InstaFollow
git pull
# Falls das Datenbankschema geändert wurde:
npx tsx scripts/utils/manual-migration.ts
```

---

## 🚨 7. Prozess-Sicherheit (Single Source of Truth)
Alle Automatisierungen folgen strikten Regeln. Ändere keine Selektoren oder Abläufe, ohne die entsprechende Dokumentation zu prüfen:
*   **Instagram:** [docs/LOGIN-INSTAGRAM.md](LOGIN-INSTAGRAM.md)
*   **Twitter:** [docs/LOGIN-TWITTER.md](LOGIN-TWITTER.md)

*Dieses Dokument wurde gemäß der `.agent/skills/process-documentation-reference` erstellt.*
