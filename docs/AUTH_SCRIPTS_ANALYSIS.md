
# 🔐 Auth Scripts Analysis & Cleanup

Dieses Dokument beschreibt die Skripte im Ordner `scripts/auth/` und deren aktuellen Status.
Ziel ist es, Redundanzen zu erkennen und obsolete Skripte später zu entfernen.

## 🟢 AKTIV & WICHTIG (Nicht löschen!)

Diese Skripte sind essenziell für den Betrieb auf dem VPS und die lokale Entwicklung.

| Skript | Beschreibung | Verwendung |
|--------|-------------|------------|
| **`auto-instagram-login.ts`** | **Hauptskript für Instagram Login.** Versucht Auto-Login mit Credentials aus `.env`, falls Session abgelaufen. Speichert Session persistent. | Wird vom Monitor genutzt oder manuell zur Reparatur. |
| **`twitter-vnc-login.ts`** | **Hauptskript für manuellen Twitter Login (VNC).** Startet Firefox im `headless: false` Modus mit persistentem Profil. | Nutzung via VNC (`/fix-twitter-session`), um sich bei X einzuloggen. |
| **`twitter-session-manager.ts`** | **Hilfsmodul.** Verwaltet Lade-/Speicherlogik für Cookies und Pfade. | Wird von anderen Skripten importiert. |
| **`fix-instagram-session.ts`** | **Manueller Instagram Login (VNC).** Ähnlich wie Auto-Login, aber öffnet Browser sichtbar für VNC, um Challenges/Captchas zu lösen. | Nutzung via VNC (`/fix-instagram-session`). |

---

## 🟡 REDUNDANT / VERALTET (Kandidaten für Löschung)

Diese Skripte scheinen Duplikate zu sein oder wurden durch bessere Versionen ersetzt.

| Skript | Grund für Obsoleszenz | Ersatz |
|--------|----------------------|--------|
| `twitter-vps-login.ts` | Identisch zu `twitter-vnc-login.ts`, nur anderer Name. | `twitter-vnc-login.ts` |
| `fix-twitter-vnc.ts` | Wahrscheinlich identisch zu `twitter-vnc-login.ts`. | `twitter-vnc-login.ts` |
| `instagram-vnc-login.ts` | Duplikat von `fix-instagram-session.ts`. | `fix-instagram-session.ts` |
| `local-twitter-login.ts` | Altes Test-Skript für lokalen Login. | `twitter-vnc-login.ts` |
| `twitter-cookie-login.ts` | Versucht Login via `cookies` Array. Veraltet, da wir jetzt komplette Profile (`user_data_dir`) nutzen. | `twitter-vnc-login.ts` |
| `env-to-session.ts` | Konvertiert `.env` Cookies zu JSON. Veraltet, da wir Browser-Profile nutzen. | - |
| `twitter-iphone-login.ts` | Versuch mit iPhone User-Agent. Nicht mehr nötig. | `twitter-vnc-login.ts` |

---

## 🔵 DEBUG & TEST (Verschieben nach `scripts/debug/`)

Nützliche Skripte für Tests, aber keine Core-Auth-Logik.

| Skript | Beschreibung |
|--------|-------------|
| `export-twitter-session.ts` | Exportiert aktuelle Session-Cookies als JSON (Backup). |
| `twitter-test-tweet.ts` | Versucht einen Test-Tweet abzusetzen. |
| `session-test.ts` | Testet, ob eine gespeicherte Session noch gültig ist. |
| `twitter-login-test.ts` | Testet Login-Logik isoliert. |
| `twitter-session-test.ts` | Testet Session-Wiederherstellung. |

---

## 🛠️ Empfohlene Cleanup-Strategie

1.  **Behalten:** Die 🟢 grünen Skripte.
2.  **Löschen:** Die 🟡 gelben Skripte (nach kurzem Backup-Check).
3.  **Verschieben:** Die 🔵 blauen Skripte nach `scripts/debug/auth-tests/`.

Damit wird der `scripts/auth/` Ordner sauber und enthält nur noch die wirklichen Login-Tools.
