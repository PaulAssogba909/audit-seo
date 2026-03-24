import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { uploadToCloudinary } from '../utils/cloudinary.js';
import { analyzeImage } from '../utils/openai.js';

// ── AI crop helper ────────────────────────────────────────────────────────────
async function cropWithAI(imagePath, prompt) {
    try {
        const response = await analyzeImage(imagePath, prompt);
        const match = response.match(/CROP:\s*x=(\d+),\s*y=(\d+),\s*width=(\d+),\s*height=(\d+)/i);
        if (!match) return imagePath;
        const [, x, y, w, h] = match.map(Number);
        const sharp = (await import('sharp')).default;
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
    } catch (e) {
        console.warn(`[MAJESTIC] AI crop failed: ${e.message}`);
        return imagePath;
    }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Majestic SEO Backlink Analyzer
 * 
 * Process (mimics the Chrome extension workflow):
 * 1. Navigate to majestic.com/reports/site-explorer
 * 2. Enter the domain
 * 3. Extract: TrustFlow, CitationFlow, Backlinks count, Referring Domains
 * 4. Capture screenshot of the summary section
 * 
 * Returns: { statut, capture, trustFlow, citationFlow, backlinks, referringDomains }
 */
export async function captureMajesticBacklinks(siteUrl, auditId) {
    const result = { statut: 'ERROR', capture: null, trustFlow: null, citationFlow: null, backlinks: null, referringDomains: null };

    const domain = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`).hostname;

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
        // ── Navigate to Majestic site explorer ──────────────────────────────
        console.log(`[MAJESTIC] Navigating to Majestic for ${domain}...`);

        // Direct URL with the domain pre-filled
        const majesticUrl = `https://majestic.com/reports/site-explorer?q=${encodeURIComponent(domain)}&oq=${encodeURIComponent(domain)}&IndexDataSource=F`;
        await page.goto(majesticUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        // ── Handle cookie consent ───────────────────────────────────────────
        for (const txt of ['Accept', 'Accepter', 'OK', 'I agree', 'Tout accepter']) {
            try {
                const btn = page.locator('button, a').filter({ hasText: txt }).first();
                if (await btn.count() > 0 && await btn.isVisible()) {
                    await btn.click();
                    await page.waitForTimeout(1000);
                    console.log(`[MAJESTIC] Dismissed: ${txt}`);
                    break;
                }
            } catch { }
        }

        // ── Check if we need to submit the form ────────────────────────────
        // If the URL didn't auto-submit, try to enter domain and submit
        const hasResults = await page.locator('text=Trust Flow, text=Citation Flow').first().count() > 0;

        if (!hasResults) {
            console.log('[MAJESTIC] No results yet, trying to submit domain...');
            try {
                const input = page.locator('input[name="q"], input[type="text"], input[placeholder*="domain"], input[placeholder*="URL"]').first();
                if (await input.count() > 0) {
                    await input.fill('');
                    await input.type(domain, { delay: 30 });
                    await page.waitForTimeout(500);

                    // Submit
                    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Search"), button:has-text("Rechercher"), button:has-text("Go")').first();
                    if (await submitBtn.count() > 0) {
                        await submitBtn.click();
                    } else {
                        await page.keyboard.press('Enter');
                    }
                    console.log('[MAJESTIC] Form submitted');
                    await page.waitForTimeout(8000);
                }
            } catch (e) {
                console.warn('[MAJESTIC] Form submit error:', e.message);
            }
        }

        // Wait for results
        await page.waitForTimeout(5000);

        // ── Extract metrics ─────────────────────────────────────────────────
        const metrics = await page.evaluate(() => {
            const data = {};
            const allText = document.body.innerText;

            // Look for Trust Flow value
            const tfMatch = allText.match(/Trust\s*Flow\s*[:\s]*(\d+)/i);
            if (tfMatch) data.trustFlow = tfMatch[1];

            // Look for Citation Flow value  
            const cfMatch = allText.match(/Citation\s*Flow\s*[:\s]*(\d+)/i);
            if (cfMatch) data.citationFlow = cfMatch[1];

            // Look for backlinks count
            const blMatch = allText.match(/(?:External\s*)?Backlinks?\s*[:\s]*([\d,. ]+)/i);
            if (blMatch) data.backlinks = blMatch[1].trim();

            // Look for referring domains
            const rdMatch = allText.match(/(?:Referring\s*)?Domains?\s*[:\s]*([\d,. ]+)/i);
            if (rdMatch) data.referringDomains = rdMatch[1].trim();

            return data;
        });

        console.log(`[MAJESTIC] Metrics extracted:`, JSON.stringify(metrics));

        if (metrics.trustFlow) result.trustFlow = metrics.trustFlow;
        if (metrics.citationFlow) result.citationFlow = metrics.citationFlow;
        if (metrics.backlinks) result.backlinks = metrics.backlinks;
        if (metrics.referringDomains) result.referringDomains = metrics.referringDomains;

        // ── Screenshot ──────────────────────────────────────────────────────
        const tmpDir = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : '.';
        const tmpPath = path.join(tmpDir, `temp_majestic_${uuidv4()}.png`);
        await page.screenshot({ path: tmpPath, fullPage: false });
        console.log('[MAJESTIC] Screenshot taken');

        const prompt = `Cette image est une capture de Majestic SEO montrant les métriques de backlinks.
Rogne pour ne garder que la section résumé avec:
- Trust Flow (score de confiance)
- Citation Flow (score de citation)  
- Le nombre de backlinks
- Le nombre de domaines référents
Supprime le header Majestic, le menu latéral, et tout le contenu en dessous.
CROP: x=[left], y=[top], width=[largeur], height=[hauteur]`;

        const croppedPath = await cropWithAI(tmpPath, prompt);
        const uploaded = await uploadToCloudinary(croppedPath, `audit-results/majestic-${auditId}`);
        if (fs.existsSync(croppedPath)) fs.unlinkSync(croppedPath);
        if (fs.existsSync(tmpPath) && tmpPath !== croppedPath) fs.unlinkSync(tmpPath);

        result.capture = uploaded?.secure_url || uploaded?.url || uploaded;
        result.statut = 'SUCCESS';

    } catch (e) {
        result.details = e.message;
        console.error('[MAJESTIC] Error:', e.message);
    } finally {
        await browser.close();
    }

    return result;
}
