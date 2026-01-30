/**
 * Simple Screenshot Server für VPS
 * Liefert Screenshots über HTTP aus
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.SCREENSHOT_PORT || 3001;
const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');

// CORS erlauben für Vercel
app.use(cors({
    origin: ['https://insta-follow-tau.vercel.app', 'http://localhost:3000'],
    methods: ['GET']
}));

// Serve screenshots
app.get('/screenshot/:filename', (req, res) => {
    const filename = req.params.filename;

    // Security: nur Dateien aus screenshots/ erlauben
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(403).json({ error: 'Invalid filename' });
    }

    const filepath = path.join(SCREENSHOTS_DIR, filename);

    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filepath);
});

// Liste aller Screenshots
app.get('/screenshots', (req, res) => {
    try {
        const files = fs.readdirSync(SCREENSHOTS_DIR);
        res.json({ files, count: files.length });
    } catch {
        res.json({ files: [], count: 0 });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', screenshotsDir: SCREENSHOTS_DIR });
});

app.listen(PORT, () => {
    console.log(`📸 Screenshot Server läuft auf Port ${PORT}`);
    console.log(`   Screenshots-Verzeichnis: ${SCREENSHOTS_DIR}`);
    console.log(`   URL: http://localhost:${PORT}/screenshot/[filename]`);
});
