# 🔐 Persistente Browser-Profile - Session-Management

> **Stand:** 06.02.2026  
> **Status:** ✅ Instagram & Twitter nutzen persistente Profile

---

## 📋 Übersicht

Dieses System nutzt **persistente Browser-Profile** statt nur Cookies zu speichern.
Das bedeutet: Der komplette Browser-Zustand bleibt erhalten - wie ein echtes Chrome-Profil!

### Warum persistente Profile?

| Alte Methode (storageState) | Neue Methode (persistentContext) |
|----------------------------|----------------------------------|
| Nur Cookies | Alles: Cookies, LocalStorage, IndexedDB, Cache, Service Workers |
| Session ~2 Tage gültig | Session **Monate** gültig |
| Jeder Start = "neuer Browser" | Immer der **gleiche Browser** |
| Instagram/Twitter erkennen "Bot" | Sieht aus wie **echter User** |

---

## 🏗️ Architektur

```
data/browser-profiles/
├── instagram/          # Persistentes Instagram-Profil
│   ├── Default/        # Chrome-ähnliche Profilstruktur
│   ├── Cookies
│   ├── Local Storage/
│   └── ...             # Alle Browser-Daten
│
└── twitter/            # Persistentes Twitter-Profil
    ├── Default/
    ├── Cookies
    ├── Local Storage/
    └── ...
```

---

## 🔧 Technische Details

### Playwright persistentContext

```typescript
// VORHER (nur Cookies):
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    storageState: 'session.json'  // Nur Cookies!
});

// NACHHER (komplettes Profil):
const context = await chromium.launchPersistentContext('data/browser-profiles/instagram', {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
    locale: 'de-DE'
});
// Alles wird automatisch im Ordner gespeichert!
```

### Vorteile:
- ✅ **Keine manuelle Session-Speicherung** nötig
- ✅ **Browser-Fingerprint** bleibt identisch
- ✅ **Längere Session-Gültigkeit** (Monate statt Tage)
- ✅ **Weniger Bot-Erkennung** durch konsistenten Browser-Zustand

---

## 📁 Profil-Speicherorte

| Plattform | Profil-Ordner |
|-----------|--------------|
| Instagram | `data/browser-profiles/instagram/` |
| Twitter | `data/browser-profiles/twitter/` |

**⚠️ WICHTIG:** Diese Ordner NICHT in Git committen! Sie enthalten sensible Login-Daten.

---

## 🚀 Verwendung

### Instagram Session einrichten (einmalig über VNC)

```bash
# Über VNC verbinden und ausführen:
cd ~/InstaFollow
npx tsx scripts/auth/fix-instagram-session.ts
# 1. Browser öffnet sich
# 2. Bei Instagram einloggen
# 3. "Info speichern" klicken
# 4. Enter drücken im Terminal
```

### Twitter Session einrichten (einmalig über VNC)

```bash
# Über VNC verbinden und ausführen:
cd ~/InstaFollow
npx tsx scripts/auth/fix-twitter-vnc.ts
# 1. Browser öffnet sich
# 2. Bei Twitter einloggen
# 3. Enter drücken im Terminal
```

### Monitor starten (danach automatisch)

```bash
# Ohne VNC - mit xvfb:
export DISPLAY=:99
npx tsx scripts/monitors/smart-monitor-v4.ts morewatchez
```

---

## 🔄 Session-Lebensdauer

| Plattform | Geschätzte Gültigkeit |
|-----------|----------------------|
| Instagram | ~3-6 Monate |
| Twitter | ~1-3 Monate |

Die Session bleibt gültig solange:
- Der Browser nicht als Bot erkannt wird
- Keine manuellen Logouts stattfinden
- Die Plattform keine Sicherheitsprüfung anfordert

---

## 🐛 Troubleshooting

### Problem: "Nicht eingeloggt" nach kurzer Zeit

**Ursache:** Profil beschädigt oder Instagram/Twitter hat Session invalidiert

**Lösung:**
```bash
# Profil löschen und neu einloggen
rm -rf data/browser-profiles/instagram
npx tsx scripts/auth/fix-instagram-session.ts
```

### Problem: "Cannot open display"

**Ursache:** xvfb läuft nicht

**Lösung:**
```bash
sudo systemctl start xvfb
# oder
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99
```

### Problem: Browser startet nicht

**Ursache:** Profil-Ordner hat falsche Berechtigungen

**Lösung:**
```bash
chmod -R 755 data/browser-profiles/
```

---

## 📊 Vergleich: Cookie-Session vs. Persistent Profile

| Aspekt | Cookie-Session | Persistent Profile |
|--------|---------------|-------------------|
| Speicherort | `data/sessions/*.json` | `data/browser-profiles/` |
| Inhalt | Nur Cookies | Alles (Cache, Storage, etc.) |
| Größe | ~10 KB | ~50-100 MB |
| Gültigkeit | Tage | Monate |
| Browser-Fingerprint | Wechselt | Konstant |
| Bot-Erkennung | Höher | Niedriger |
| Setup-Aufwand | Gleich | Gleich |

---

## 🔐 Sicherheitshinweise

1. **Profil-Ordner schützen:**
   ```bash
   # Nicht in Git committen!
   echo "data/browser-profiles/" >> .gitignore
   ```

2. **Backup empfohlen:**
   ```bash
   # Falls Session wertvoll:
   tar -czf browser-profiles-backup.tar.gz data/browser-profiles/
   ```

3. **Bei VPS-Wechsel:**
   - Profil-Ordner mitnehmen oder neu einloggen
   - IP-Wechsel kann Session invalidieren

---

## 📝 Relevante Scripts

| Script | Beschreibung |
|--------|-------------|
| `scripts/auth/fix-instagram-session.ts` | Manueller Instagram-Login via VNC |
| `scripts/auth/fix-twitter-vnc.ts` | Manueller Twitter-Login via VNC |
| `scripts/auth/auto-instagram-login.ts` | Automatischer Instagram-Login (Fallback) |
| `scripts/setup/setup-xvfb.sh` | xvfb Setup für Server |

---

*Letzte Aktualisierung: 06.02.2026, 23:15*
