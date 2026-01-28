# 🎯 InstaFollows - Implementierungsplan

## Überblick

Ein System zum Monitoring von Instagram-Following-Listen für Fußballvereine und deren Spieler. Erkennt automatisch wenn Profile jemandem folgen oder entfolgen und sendet Benachrichtigungen via n8n Webhook.

---

## 📊 Architektur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM ARCHITEKTUR                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐       ┌─────────────┐       ┌─────────────┐          │
│   │   VERCEL    │       │   TURSO     │       │    VPS      │          │
│   │   (Next.js) │◄─────►│  (Cloud DB) │◄─────►│ (Playwright)│          │
│   │   Frontend  │       │   LibSQL    │       │   Worker    │          │
│   └─────────────┘       └─────────────┘       └─────────────┘          │
│         │                                            │                  │
│         │              ┌─────────────┐               │                  │
│         └─────────────►│    n8n      │◄──────────────┘                  │
│                        │  (Webhooks) │                                  │
│                        └─────────────┘                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Komponenten

| Komponente | Technologie | Hosting | Funktion |
|------------|-------------|---------|----------|
| **Frontend** | Next.js 15 | Vercel | Web-UI für Sets und Profile |
| **Datenbank** | Turso (LibSQL) | Cloud | Speichert alle Daten |
| **Worker** | Node.js + Playwright | VPS | Instagram Scraping |
| **Automation** | n8n | Self-hosted | Webhooks & Benachrichtigungen |

---

## 🔄 Workflow

### Phase 1: Setup (Manuell via UI)

```
1. Set anlegen
   └── Name: "Bayern"
   
2. Profile hinzufügen
   ├── @fcbayern (Verein)
   ├── @jamalmusiala10
   ├── @harrykane
   ├── @joshua.kimmich
   └── ... weitere Spieler
```

### Phase 2: Initial Scan

```
┌──────────────────────────────────────────────────────────────┐
│ INITIAL SCAN (einmalig pro neuem Profil)                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Für jedes Profil im Set:                                    │
│    1. Warte 60-120 Sekunden (zufällig)                       │
│    2. Öffne Profil in Mobile-Emulation                       │
│    3. Scrape ALLE Following (100%)                           │
│    4. Speichere in Turso mit Position                        │
│    5. Markiere als "initial_scan_complete"                   │
│                                                              │
│  Dauer: ~5-10 Minuten pro Profil (je nach Following-Anzahl)  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Phase 3: Smart Monitoring (Cron Job)

```
┌──────────────────────────────────────────────────────────────┐
│ SMART CRON JOB (alle 30 Minuten)                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  QUICK CHECK (2-3 Sekunden pro Profil):                      │
│    1. Öffne Profilseite                                      │
│    2. Lese nur Following-ZAHL                                │
│    3. Vergleiche mit gespeicherter Zahl                      │
│                                                              │
│  Wenn Zahl GLEICH:                                           │
│    └── Weiter zum nächsten Profil                            │
│                                                              │
│  Wenn Zahl ANDERS:                                           │
│    └── FULL SCRAPE auslösen                                  │
│    └── Änderungen erkennen (Neu/Entfolgt)                    │
│    └── n8n Webhook triggern                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Phase 4: Webhook Benachrichtigung

```
┌──────────────────────────────────────────────────────────────┐
│ n8n WEBHOOK PAYLOAD                                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  {                                                           │
│    "event": "FOLLOW" | "UNFOLLOW",                           │
│    "profile": {                                              │
│      "username": "jamalmusiala10",                           │
│      "fullName": "Jamal Musiala",                            │
│      "set": "Bayern"                                         │
│    },                                                        │
│    "target": {                                               │
│      "username": "fcbayern",                                 │
│      "fullName": "FC Bayern München"                         │
│    },                                                        │
│    "detectedAt": "2026-01-28T14:45:00Z"                      │
│  }                                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Technische Details

### Mobile Emulation (Anti-Detection)

```typescript
// Playwright mit iPhone 13 Pro Emulation
const iPhone = devices['iPhone 13 Pro'];

const context = await browser.newContext({
    ...iPhone,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    storageState: SESSION_PATH
});
```

**Vorteile:**
- ✅ 100% der Following werden geladen (kein Lazy-Loading-Limit)
- ✅ Sieht aus wie echtes Handy
- ✅ Session bleibt persistent
- ✅ Bisher kein Ban

### Menschliches Verhalten

```typescript
// Zufällige Delays
async function humanDelay(minMs: number, maxMs: number) {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise(r => setTimeout(r, delay));
}

// Zwischen Profilen: 60-120 Sekunden
// Zwischen Scrolls: 1.5-2.5 Sekunden
// Zwischen Sets: 5-10 Minuten
```

### Cron Schedule

```
# Quick Check alle 30 Minuten
*/30 * * * * node /app/quick-check.js

# Full Sync einmal täglich um 3 Uhr nachts
0 3 * * * node /app/full-sync.js
```

---

## 📁 Datenbank Schema

```prisma
model ProfileSet {
  id        String   @id
  name      String   @unique  // "Bayern"
  isActive  Boolean  @default(true)
  profiles  MonitoredProfile[]
}

model MonitoredProfile {
  id             String   @id
  username       String   // "jamalmusiala10"
  fullName       String?
  followingCount Int?     // Für Quick-Check
  lastCheckedAt  DateTime?
  setId          String
  set            ProfileSet @relation(...)
  followingList  FollowingEntry[]
  changes        ChangeEvent[]
}

model FollowingEntry {
  id         String   @id
  username   String
  position   Int      // Position in Liste
  lastSeenAt DateTime
  missedScans Int     @default(0)
  profileId  String
}

model ChangeEvent {
  id             String   @id
  type           String   // "FOLLOW" | "UNFOLLOW"
  targetUsername String
  detectedAt     DateTime
  isConfirmed    Boolean
  processed      Boolean  // Webhook gesendet?
}
```

---

## 🚀 VPS Setup

### Empfohlener Anbieter: Hetzner

| Spec | Wert |
|------|------|
| **Server** | CX21 |
| **vCPU** | 2 |
| **RAM** | 4 GB |
| **SSD** | 40 GB |
| **Preis** | ~4,85€/Monat |
| **Region** | Falkenstein (DE) |

### Installation auf VPS

```bash
# 1. Server erstellen bei Hetzner
# 2. SSH Zugang einrichten

# 3. Node.js installieren
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Playwright Dependencies
sudo npx playwright install-deps chromium

# 5. Code deployen
git clone <repo>
cd insta-follows
npm install
npx playwright install chromium

# 6. Environment Variables setzen
cp .env.example .env
nano .env  # Credentials eintragen

# 7. PM2 für Process Management
npm install -g pm2
pm2 start worker.js --name "insta-worker"
pm2 startup
pm2 save

# 8. Cron Jobs einrichten
crontab -e
# */30 * * * * cd /app && node quick-check.js
```

---

## ✅ Implementierungs-Schritte

### Phase 1: Lokale Entwicklung ✅
- [x] Playwright Scraping funktioniert
- [x] Mobile Emulation (100% Following)
- [x] Turso Datenbank verbunden
- [x] Session Persistenz
- [x] Anti-Detection Maßnahmen

### Phase 2: VPS Worker 🔲
- [ ] VPS bei Hetzner erstellen
- [ ] Node.js + Playwright installieren
- [ ] Worker-Script deployen
- [ ] Cron Jobs einrichten
- [ ] PM2 Process Manager

### Phase 3: Quick-Check Logik 🔲
- [ ] Nur Following-Zahl prüfen (schnell)
- [ ] Bei Änderung: Full-Scrape triggern
- [ ] Änderungen erkennen (Diff)
- [ ] ChangeEvent in DB speichern

### Phase 4: n8n Integration 🔲
- [ ] Webhook Endpoint erstellen
- [ ] Payload definieren
- [ ] n8n Workflow bauen
- [ ] Benachrichtigungen (Telegram/Discord/etc.)

### Phase 5: UI Verbesserungen 🔲
- [ ] Sets anlegen in UI
- [ ] Profile hinzufügen
- [ ] Change-Log anzeigen
- [ ] Status Dashboard

---

## 🔐 Sicherheit

| Maßnahme | Beschreibung |
|----------|--------------|
| **Session-Cookies** | Werden lokal gespeichert, nie in Git |
| **Rate Limiting** | Max 1 Profil pro Minute beim Full-Scan |
| **VPN (optional)** | Kann auf VPS installiert werden |
| **IP Rotation** | Hetzner IPs sind "sauber" |
| **User-Agent** | Echter iPhone User-Agent |

---

## 📊 Kosten

| Service | Kosten/Monat |
|---------|--------------|
| Vercel (Frontend) | 0€ (Free Tier) |
| Turso (Datenbank) | 0€ (Free Tier, 9GB) |
| Hetzner VPS | ~5€ |
| n8n (Self-hosted) | 0€ |
| **GESAMT** | **~5€/Monat** |

---

## 🎯 Risiko-Minimierung

### Instagram Detection vermeiden:

1. **Menschliche Delays** - Keine maschinellen Muster
2. **Mobile Emulation** - Wie echtes iPhone
3. **Session Persistenz** - Kein häufiges Login
4. **Quick-Check First** - Nur bei Änderung scrapen
5. **Pausen zwischen Sets** - 5-10 Minuten
6. **Nacht-Scans** - Hauptaktivität nachts (3-6 Uhr)
7. **Established Account** - Alter Account mit Historie

---

## 📝 Nächste Aktionen

1. **VPS bestellen** (Hetzner CX21) → 5 Minuten
2. **Server einrichten** → 30 Minuten
3. **Worker deployen** → 15 Minuten
4. **Cron Jobs aktivieren** → 5 Minuten
5. **n8n Webhook bauen** → 20 Minuten

**Geschätzte Zeit bis Go-Live: ~1-2 Stunden**
