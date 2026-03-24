import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { uploadToCloudinary } from '../utils/cloudinary.js';
import { analyzeImage } from '../utils/openai.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function cropWithAI(imagePath, prompt) {
    try {
        const response = await analyzeImage(imagePath, prompt);
        const match = response.match(/CROP:\s*x=(\d+),\s*y=(\d+),\s*width=(\d+),\s*height=(\d+)/i);
        if (!match) return imagePath;
        const [, x, y, w, h] = match.map(Number);
        const meta = await sharp(imagePath).metadata();
        const left = Math.min(x, meta.width - 10);
        const top = Math.min(y, meta.height - 10);
        const width = Math.min(w, meta.width - left);
        const height = Math.min(h, meta.height - top);
        if (width < 20 || height < 20) return imagePath;
        const croppedPath = imagePath.replace('.png', '_cropped.png');
        await sharp(imagePath).extract({ left, top, width, height }).toFile(croppedPath);
        fs.unlinkSync(imagePath);
        return croppedPath;
    } catch (e) { return imagePath; }
}

// ── SEMRUSH — Authority Score ─────────────────────────────────────────────────
export async function captureSemrush(siteUrl, auditId) {
    const result = { statut: 'ERROR', capture: null };
    const domain = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`).hostname;

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        userAgent: UA,
        locale: 'fr-FR'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(90000);

    try {
        await page.goto('https://fr.semrush.com/free-tools/website-authority-checker/', {
            waitUntil: 'domcontentloaded', timeout: 60000
        });
        await page.waitForTimeout(4000);

        // Dismiss cookie banner
        try {
            const cookieBtn = page.locator('#onetrust-accept-btn-handler');
            if (await cookieBtn.count() > 0) { await cookieBtn.click(); await page.waitForTimeout(1000); }
        } catch { }

        // Dismiss popups via JS
        await page.evaluate(() => {
            document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"], [id*="onetrust"]')
                .forEach(el => { el.style.display = 'none'; });
        });

        // Close X buttons
        for (const sel of ['button[aria-label="Close"]', 'button[aria-label="Fermer"]', '[data-test="close-button"]', '.srf-popup__close']) {
            try {
                const btn = page.locator(sel).first();
                if (await btn.count() > 0 && await btn.isVisible()) { await btn.click({ force: true }); await page.waitForTimeout(500); }
            } catch { }
        }

        // Enter domain
        const input = page.locator('input[type="text"], input[name="url"], input[placeholder]').first();
        await input.click();
        await input.fill(domain);
        await page.waitForTimeout(500);

        // Submit
        try {
            const btn = page.locator('button').filter({ hasText: /autorité|authority|vérifier/i }).first();
            if (await btn.count() > 0) await btn.click();
            else await page.keyboard.press('Enter');
        } catch { await page.keyboard.press('Enter'); }

        try {
            await page.waitForLoadState('networkidle', { timeout: 60000 });
        } catch {
            console.log('[SEMRUSH] networkidle timeout — continuing with available results');
        }
        await page.waitForTimeout(8000);

        // Post-submit popup cleanup
        try { await page.keyboard.press('Escape'); } catch { }
        await page.evaluate(() => {
            document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"]')
                .forEach(el => { el.style.display = 'none'; });
        });
        await page.waitForTimeout(2000);

        const tmpPath = path.resolve(`temp_semrush_${uuidv4()}.png`);
        await page.screenshot({ path: tmpPath, fullPage: false });

        const prompt = `Cette image est une capture de Semrush Authority Checker.
Identifie et rogne pour garder uniquement :
- La grande carte "Authority Score" centrale
- Les deux petites cartes au-dessus nommées "Authority Score" et "Backlinks"
CROP: x=[left], y=[top], width=[largeur], height=[hauteur]`;

        const croppedPath = await cropWithAI(tmpPath, prompt);
        const uploaded = await uploadToCloudinary(croppedPath, `audit-results/semrush-${auditId}`);
        if (fs.existsSync(croppedPath)) fs.unlinkSync(croppedPath);
        if (fs.existsSync(tmpPath) && tmpPath !== croppedPath) fs.unlinkSync(tmpPath);

        result.capture = uploaded?.secure_url || uploaded?.url || uploaded;
        result.statut = 'SUCCESS';
    } catch (e) {
        result.details = e.message;
        console.error('[SEMRUSH] Error:', e.message);
    } finally { await browser.close(); }
    return result;
}

// ── AHREFS — Domain Rating + URL Rating ───────────────────────────────────────
export async function captureAhrefs(siteUrl, auditId) {
    const result = { statut: 'ERROR', capture: null };
    const domain = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`).hostname;

    // Use Chromium headless with anti-detection flags (Chrome channel not available on Railway)
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage'
        ]
    });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        userAgent: UA,
        locale: 'fr-FR'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(90000);

    try {
        console.log('[AHREFS] Navigating to authority checker...');
        await page.goto('https://ahrefs.com/fr/website-authority-checker', {
            waitUntil: 'domcontentloaded', timeout: 60000
        });
        await page.waitForTimeout(5000);

        // ── Handle Cloudflare Turnstile ──────────────────────────────────────
        async function handleTurnstile() {
            for (let attempt = 0; attempt < 3; attempt++) {
                for (const frame of page.frames()) {
                    if (frame.url().includes('turnstile') || frame.url().includes('challenges.cloudflare.com')) {
                        try {
                            console.log('[AHREFS] Turnstile iframe found, clicking...');
                            const checkbox = frame.locator('input[type="checkbox"], .cb-i, .mark').first();
                            if (await checkbox.count() > 0) await checkbox.click({ force: true });
                            else await frame.locator('body').first().click({ force: true });
                        } catch { }
                        await page.waitForTimeout(4000);
                    }
                }
                try {
                    const humain = page.locator('text=humain').first();
                    if (await humain.count() > 0 && await humain.isVisible()) {
                        console.log('[AHREFS] "humain" text found, clicking...');
                        await humain.click({ force: true });
                        await page.waitForTimeout(3000);
                    }
                } catch { }
            }
        }

        await handleTurnstile();

        // ── Dismiss cookie banner ────────────────────────────────────────────
        for (const txt of ['Tout rejeter', 'Reject all', 'Refuser', 'OK']) {
            try {
                const btn = page.locator('button').filter({ hasText: txt }).first();
                if (await btn.count() > 0 && await btn.isVisible()) {
                    await btn.click(); await page.waitForTimeout(1000);
                    console.log(`[AHREFS] Dismissed: ${txt}`);
                }
            } catch { }
        }
        await page.evaluate(() => {
            document.querySelectorAll('[class*="cookie"], [class*="consent"], [id*="cookie"]')
                .forEach(el => { el.style.display = 'none'; });
        });

        // ── Enter domain ─────────────────────────────────────────────────────
        console.log(`[AHREFS] Entering domain: ${domain}`);
        const input = page.locator('input[type="text"], input[name="url"], input[placeholder*="domain"], input[placeholder*="site"], input[placeholder*="exemple"]').first();
        await input.click();
        await input.fill('');
        await input.type(domain, { delay: 50 });
        await page.waitForTimeout(1000);

        // ── Submit — click the orange "Vérifier l'autorité" button ───────────
        console.log('[AHREFS] Looking for submit button...');
        let submitted = false;

        // Strategy 1: find the orange CTA button by text
        for (const txt of ["Vérifier l'autorité", "Check Authority", "Vérifier"]) {
            try {
                const btn = page.locator('button, a, span').filter({ hasText: txt }).first();
                if (await btn.count() > 0 && await btn.isVisible()) {
                    await btn.click();
                    console.log(`[AHREFS] Clicked button: "${txt}"`);
                    submitted = true;
                    break;
                }
            } catch { }
        }

        // Strategy 2: CSS selectors for submit buttons
        if (!submitted) {
            for (const sel of ['button[type="submit"]', 'form button', 'button.css-1c4k1lp']) {
                try {
                    const btn = page.locator(sel).first();
                    if (await btn.count() > 0 && await btn.isVisible()) {
                        await btn.click();
                        console.log(`[AHREFS] Clicked selector: ${sel}`);
                        submitted = true;
                        break;
                    }
                } catch { }
            }
        }

        // Strategy 3: Enter key
        if (!submitted) {
            console.log('[AHREFS] No button found, pressing Enter...');
            await page.keyboard.press('Enter');
        }

        console.log('[AHREFS] Waiting for results to load...');

        // Wait for results - look for Domain Rating card
        let resultsLoaded = false;
        try {
            await page.waitForSelector('text=Domain Rating, text=Rang du domaine, text=Authority Score, .css-1jv9nkd', {
                timeout: 30000
            });
            resultsLoaded = true;
            console.log('[AHREFS] Results loaded!');
        } catch {
            console.warn('[AHREFS] Results did not load (probable CAPTCHA). Re-trying Turnstile...');
            await handleTurnstile();
            await page.waitForTimeout(10000);

            // 2nd attempt: check again
            try {
                const dr = await page.locator('text=Domain Rating, text=Rang du domaine').first();
                if (await dr.count() > 0) resultsLoaded = true;
            } catch { }
        }

        if (!resultsLoaded) {
            console.warn('[AHREFS] ⚠️ Results still not visible. Capturing page as-is.');
        }
        await page.waitForTimeout(3000);

        // ── Screenshot and crop ──────────────────────────────────────────────
        const tmpDir = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : '.';
        const tmpPath = path.join(tmpDir, `temp_ahrefs_${uuidv4()}.png`);
        await page.screenshot({ path: tmpPath, fullPage: false });
        console.log('[AHREFS] Screenshot taken');

        const prompt = `Cette image est une capture d'Ahrefs Website Authority Checker.
Identifie et rogne pour garder uniquement:
- La carte "Domain Rating" (ou "Rang du domaine")  
- La carte "URL Rating" (ou "Rang d'URL")
Supprime tout le reste: header, barre de recherche, footer.
CROP: x=[left], y=[top], width=[largeur], height=[hauteur]`;

        const croppedPath = await cropWithAI(tmpPath, prompt);
        const uploaded = await uploadToCloudinary(croppedPath, `audit-results/ahrefs-${auditId}`);
        if (fs.existsSync(croppedPath)) fs.unlinkSync(croppedPath);
        if (fs.existsSync(tmpPath) && tmpPath !== croppedPath) fs.unlinkSync(tmpPath);

        result.capture = uploaded?.secure_url || uploaded?.url || uploaded;
        result.statut = 'SUCCESS';
    } catch (e) {
        result.details = e.message;
        console.error('[AHREFS] Error:', e.message);
    } finally { await browser.close(); }
    return result;
}
