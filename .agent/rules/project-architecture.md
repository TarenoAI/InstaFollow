# InstaFollow Project Setup & Architecture

## 📋 Kerninformationen
- **GitHub Repository**: [https://github.com/TarenoAI/InstaFollow](https://github.com/TarenoAI/InstaFollow)
- **Vercel Frontend**: [https://insta-follow-tau.vercel.app/](https://insta-follow-tau.vercel.app/)
- **Datenbank**: Turso Cloud (LibSQL) - Synchronisierter Status zwischen VPS und Vercel.

## 🏗️ Architektur: Hybrid Model
Das Projekt nutzt eine hybride Infrastruktur, um Instagram-Sperren zu umgehen und maximale Stabilität zu gewährleisten:

1.  **Vercel (Frontend/UI)**: 
    - Beherbergt die Next.js Web-App.
    - Dient der Verwaltung von Sets und Profilen.
    - Liest Daten direkt aus der **Turso Cloud DB**.
2.  **VPS (Playwright Worker)**:
    - Führt das ressourcenintensive Instagram-Scraping aus.
    - Nutzt **Playwright mit Mobile Emulation (iPhone 13 Pro)** für 100% Following-Erhalt.
    - Speichert Ergebnisse direkt in die **Turso Cloud DB**.
3.  **Turso (Shared Database)**:
    - Fungiert als "Single Source of Truth".
    - Ermöglicht dem VPS-Worker und dem Vercel-Frontend den Zugriff auf denselben Datenbestand.

## 🔄 Scraping & Monitoring Strategie
- **Mobile Emulation**: Umgehung des Desktop-Lazy-Loading-Limits (~75 User) durch Simulation eines iPhones.
- **Smart Monitoring Workflow**:
    1.  **Quick-Check (alle 30 Min)**: Lädt nur die Profilseite, um die Following-Anzahl zu prüfen.
    2.  **Full Scrape**: Wird nur ausgelöst, wenn sich die Anzahl geändert hat.
    3.  **Position-Tracking**: Speichert die Position jedes Users, um Unfollows präzise von Ladefehlern zu unterscheiden.
    4.  **n8n Integration**: Triggered Webhooks bei bestätigten Änderungen.

## 🛠️ Fachbegriffe für die Suche
- `Hybrid-Architektur`: Trennung von UI (Vercel) und Worker (VPS).
- `Mobile-Emulation-Scraping`: Nutzung von iPhone-Viewports für 100% Listen-Abdeckung.
- `Quick-Check-Logik`: Ressourcenoptimierte Prüfung der Following-Zahl vor dem Full-Scrape.
- `Turso-Cloud-Sync`: Datenbank-Zustand über mehrere Provider hinweg.
- `Playwright-Worker`: Der Hintergrund-Prozess auf dem VPS.
