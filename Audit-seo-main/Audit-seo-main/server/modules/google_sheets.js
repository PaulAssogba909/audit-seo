import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { uploadToCloudinary } from '../utils/cloudinary.js';
import { analyzeImage } from '../utils/openai.js';

// ── CSS to hide Google Sheets UI chrome ──────────────────────────────────────
const SHEETS_HIDE_CSS = `
  .grid-bottom-bar, .docs-sheet-tab-bar, #docs-header,
  #docs-chrome, .docs-titlebar-badges, .waffle-chip-container,
  #docs-menubar, .docs-butterbar-container, .docs-offline-indicator,
  .docs-gm3-topbar, .notranslate[role="banner"] { display: none !important; }
`;

// ── AI crop helper ────────────────────────────────────────────────────────────
async function cropWithAI(imagePath, prompt) {
    try {
        const response = await analyzeImage(imagePath, prompt);
        const match = response.match(/CROP:\s*x=(\d+),\s*y=(\d+),\s*width=(\d+),\s*height=(\d+)/i);
        if (!match) return imagePath;
        const [, x, y, w, h] = match.map(Number);
        const meta = await sharp(imagePath).metadata();
        // Clamp values
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
        console.warn(`[SHEETS] AI crop failed: ${e.message}`);
        return imagePath;
    }
}

// ── Navigate to a sheet and select a specific tab by name ────────────────────
async function navigateToTab(page, tabName) {
    console.log(`[SHEETS] Navigating to tab: "${tabName}"`);

    // Temporarily show the tab bar (our CSS hides it)
    await page.evaluate(() => {
        const tabBar = document.querySelector('.docs-sheet-tab-bar') ||
            document.querySelector('.grid-bottom-bar');
        if (tabBar) tabBar.style.display = 'block';
    });
    await page.waitForTimeout(2000);

    const result = await page.evaluate((name) => {
        // Try multiple selectors for tab names (different in logged-in vs public view)
        const tabSelectors = [
            '.docs-sheet-tab-name',
            '.docs-sheet-tab .docs-sheet-tab-caption',
            '[data-tab-name]',
            '.docs-sheet-tab span'
        ];

        let tabs = [];
        for (const sel of tabSelectors) {
            tabs = Array.from(document.querySelectorAll(sel));
            if (tabs.length > 0) break;
        }

        if (tabs.length === 0) {
            return { found: false, noTabs: true, available: [] };
        }

        const target = tabs.find(t =>
            t.innerText.trim().toLowerCase() === name.toLowerCase() ||
            t.innerText.trim().toLowerCase().includes(name.toLowerCase())
        );
        if (!target) return { found: false, available: tabs.map(t => t.innerText.trim()) };

        const parent = target.closest('.docs-sheet-tab');
        const isActive = parent && parent.classList.contains('docs-sheet-active-tab');

        let gid = null;
        if (parent && parent.id && parent.id.startsWith('sheet-button-')) {
            gid = parent.id.replace('sheet-button-', '');
        }
        // Try data attribute fallback
        if (!gid && parent) {
            const dataId = parent.getAttribute('data-id');
            if (dataId) gid = dataId;
        }

        return { found: true, gid, isActive, name: target.innerText.trim() };
    }, tabName);

    if (!result.found) {
        // Re-hide tabs
        await page.evaluate(() => {
            const b = document.querySelector('.grid-bottom-bar'); if (b) b.style.display = 'none';
        });
        if (result.noTabs) {
            console.warn(`[SHEETS] No tab bar found at all.`);
        } else {
            console.warn(`[SHEETS] Tab "${tabName}" not found. Available: ${(result.available || []).join(', ')}`);
        }
        return false;
    }

    if (result.isActive) {
        console.log(`[SHEETS] Tab "${result.name}" is already active.`);
        await page.evaluate(() => {
            const b = document.querySelector('.grid-bottom-bar'); if (b) b.style.display = 'none';
        });
        return true;
    }

    if (result.gid) {
        // Navigate by URL (most reliable)
        const url = new URL(page.url());
        url.hash = `gid=${result.gid}`;
        console.log(`[SHEETS] Switching to gid=${result.gid}`);
        await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 });
        await page.addStyleTag({ content: SHEETS_HIDE_CSS });
    } else {
        // No gid available — click the tab via JavaScript (works even if visually hidden)
        console.log(`[SHEETS] No gid found, clicking tab "${result.name}" via JS...`);
        const clicked = await page.evaluate((name) => {
            const tabSelectors = ['.docs-sheet-tab-name', '.docs-sheet-tab span'];
            for (const sel of tabSelectors) {
                const tabs = Array.from(document.querySelectorAll(sel));
                const target = tabs.find(t =>
                    t.innerText.trim().toLowerCase() === name.toLowerCase() ||
                    t.innerText.trim().toLowerCase().includes(name.toLowerCase())
                );
                if (target) {
                    // Click the parent tab container (which handles the tab switch)
                    const parent = target.closest('.docs-sheet-tab') || target;
                    parent.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    parent.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    parent.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, result.name);

        if (!clicked) {
            console.warn(`[SHEETS] JS click failed for "${result.name}".`);
            await page.evaluate(() => {
                const b = document.querySelector('.grid-bottom-bar'); if (b) b.style.display = 'none';
            });
            return false;
        }

        // Wait for the sheet to load after the click
        await page.waitForTimeout(4000);

        // Re-hide tab bar and apply CSS
        await page.evaluate(() => {
            const b = document.querySelector('.grid-bottom-bar'); if (b) b.style.display = 'none';
        });
    }

    await page.waitForTimeout(3000);
    return true;
}

// ── Open a Google Sheet with injected Google cookies ─────────────────────────
async function openSheet(sheetUrl, googleCookies) {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
        viewport: { width: 1600, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'fr-FR'
    });
    if (googleCookies && googleCookies.length) {
        await context.addCookies(googleCookies);
    }
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    await page.goto(sheetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for spreadsheet grid to appear
    try {
        await page.waitForSelector('#waffle-grid-container', { state: 'visible', timeout: 20000 });
    } catch {
        await page.waitForSelector('body', { state: 'visible', timeout: 5000 });
    }
    await page.addStyleTag({ content: SHEETS_HIDE_CSS });
    return { browser, context, page };
}

// ── Screenshot, AI crop, upload to Cloudinary ────────────────────────────────
async function captureAndUpload(page, promptText, cloudinaryFolder) {
    const tmpDir = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : '.';
    const tmpPath = path.join(tmpDir, `temp_sheet_${uuidv4()}.png`);
    console.log(`[SHEETS] Taking screenshot → ${tmpPath}`);
    await page.screenshot({ path: tmpPath, fullPage: false });
    console.log(`[SHEETS] Sending to AI for crop...`);
    const croppedPath = await cropWithAI(tmpPath, promptText);
    console.log(`[SHEETS] Uploading to Cloudinary → ${cloudinaryFolder}`);
    const result = await uploadToCloudinary(croppedPath, cloudinaryFolder);
    if (fs.existsSync(croppedPath)) fs.unlinkSync(croppedPath);
    if (fs.existsSync(tmpPath) && tmpPath !== croppedPath) fs.unlinkSync(tmpPath);
    return result?.secure_url || result?.url || result;
}

const SHEET_CROP_PROMPT = `Tu es un expert en rognage d'images.
Cette image est une capture d'écran d'un Google Sheet.
Tu DOIS rogner pour ne garder STRICTEMENT que le tableau de données visibles.

RÈGLES STRICTES :
1. Supprime TOUT en haut : barre de menus, barre d'outils, barre de formule, en-tête du document
2. Supprime TOUT en bas : barre d'onglets, barre de défilement, pied de page
3. Supprime TOUTES les marges vides à droite et en bas du tableau
4. Supprime les colonnes de lettres (A, B, C...) et les numéros de lignes (1, 2, 3...)
5. Le résultat doit être un tableau SERRÉ sans aucun espace vide autour
6. NE COUPE AUCUNE donnée du tableau. Tu DOIS ABSOLUMENT CONSERVER la première ligne d'en-tête contenant les noms des colonnes (ex: URL, Destination, H1...). Ne la rogne surtout pas.

Réponds UNIQUEMENT avec : CROP: x=[left], y=[top], width=[largeur], height=[hauteur]`;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT SHEET TABS
// ─────────────────────────────────────────────────────────────────────────────

export async function captureSheetImages(sheetUrl, auditId, googleCookies) {
    const result = { statut: 'ERROR', capture: null };
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, 'Images');
        if (!found) { result.statut = 'SKIP'; result.details = 'Onglet Images introuvable'; return result; }

        await page.evaluate(() => {
            const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
            let allRows = [];
            for (const sel of tableSelectors) {
                const elts = Array.from(document.querySelectorAll(sel));
                // Exclude rows that belong to the header or tab bar
                allRows = elts.filter(el => !el.closest('#docs-header') && !el.closest('.grid-bottom-bar') && !el.closest('.docs-sheet-tab-bar') && !el.closest('.docs-titlebar-buttons'));
                if (allRows.length > 1) break;
            }
            if (!allRows.length) return;

            // Find real header row (skip Google Finance overlay)
            const knownHeaders = ['url', 'destination', 'taille', 'image', 'poids', 'format', 'type', 'octets'];
            let headerRowIdx = 0;
            for (let i = 0; i < Math.min(allRows.length, 5); i++) {
                const texts = Array.from(allRows[i].children).map(c => c.innerText.trim().toLowerCase());
                if (texts.some(t => knownHeaders.some(kw => t.includes(kw)))) {
                    headerRowIdx = i;
                    break;
                }
            }

            const rows = allRows.slice(headerRowIdx);
            const headers = Array.from(rows[0].children);
            const headerTexts = headers.map(h => h.innerText.trim().toLowerCase());

            // Find "Destination" and "Taille (octets)" columns by exact match
            let destIdx = headerTexts.findIndex(h => h.includes('destination'));
            let tailleIdx = headerTexts.findIndex(h => h.includes('taille'));
            if (destIdx === -1) destIdx = 0; // fallback to first column
            if (tailleIdx === -1) tailleIdx = 1; // fallback to second column

            const tbody = rows[0]?.parentElement || document.querySelector('.waffle tbody');
            if (!tbody) return;
            const dataRows = rows.slice(1);

            // Parse values and hide rows where taille < 100ko (100000 bytes)
            dataRows.forEach(tr => {
                const cell = tr.children[tailleIdx];
                if (!cell) return;
                const text = (cell.innerText || '').replace(/\s/g, '').replace(',', '.');
                let val = parseFloat(text) || 0;
                // If value contains "Mo" or "MB", convert to bytes
                if (text.toLowerCase().includes('mo') || text.toLowerCase().includes('mb')) val *= 1024 * 1024;
                else if (text.toLowerCase().includes('ko') || text.toLowerCase().includes('kb')) val *= 1024;
                // Otherwise assume value is already in bytes (octets)
                tr.dataset.val = val;
                if (val < 100000) tr.style.display = 'none';
            });

            // Sort descending by taille
            dataRows.sort((a, b) => parseFloat(b.dataset.val || 0) - parseFloat(a.dataset.val || 0));
            dataRows.forEach(tr => tbody.appendChild(tr));

            // Hide overlay rows before real header
            for (let i = 0; i < headerRowIdx; i++) allRows[i].style.display = 'none';

            // Keep ONLY "Destination" and "Taille (octets)" columns — hide all others
            const keepIdx = [destIdx, tailleIdx];
            rows.forEach(tr => {
                Array.from(tr.children).forEach((td, idx) => {
                    if (!keepIdx.includes(idx)) td.style.display = 'none';
                });
            });
        });
        await page.waitForTimeout(1000);

        const url = await captureAndUpload(page, SHEET_CROP_PROMPT + '\nVérifie que les lignes visibles ont toutes une taille ≥ 100Ko. Exclure toute ligne vide ou avec taille < 100Ko.', `audit-results/sheet-images-${auditId}`);
        result.capture = url;
        result.statut = 'SUCCESS';
    } catch (e) {
        result.statut = 'ERROR';
        result.details = e.message;
    } finally { await browser.close(); }
    return result;
}

export async function captureSheetSimpleTab(sheetUrl, tabName, auditId, googleCookies, airtableField) {
    const result = { statut: 'ERROR', capture: null, field: airtableField };
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, tabName);
        if (!found) { result.statut = 'SKIP'; result.details = `Onglet "${tabName}" introuvable`; return result; }
        await page.waitForTimeout(2000);
        const url = await captureAndUpload(page, SHEET_CROP_PROMPT, `audit-results/sheet-${airtableField.toLowerCase()}-${auditId}`);
        result.capture = url;
        result.statut = 'SUCCESS';
    } catch (e) {
        result.statut = 'ERROR';
        result.details = e.message;
    } finally { await browser.close(); }
    return result;
}

export async function captureSheetH1H6(sheetUrl, auditId, googleCookies) {
    const results = {};
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, 'Balises H1-H6');
        if (!found) return results;

        // CRITICAL: Wait for the grid to fully render after tab navigation
        try {
            await page.waitForSelector('.waffle tbody tr', { state: 'attached', timeout: 20000 });
            console.log('[SHEETS] H1-H6 grid loaded successfully');
        } catch (e) {
            console.log('[SHEETS] H1-H6: .waffle grid not found after tab navigation, aborting');
            return results;
        }

        // Each sub-capture: check if column has 'oui' values, then filter & capture
        const columns = [
            { col: 'H1 absente', field: 'Img_balise_h1_absente', sort: 'asc' },
            { col: 'que des H1 vides', field: 'Img_que des H1 vides', sort: 'asc' },
            { col: 'au moins une H1 vide', field: 'Img_au moins une H1 vide', sort: 'asc' },
            { col: "1ère balise Hn n'est pas H1", field: "Img_1ère balise Hn n'est pas H1", sort: 'asc' },
            { col: 'Sauts de niveau entre les Hn', field: 'Img_Sauts de niveau entre les Hn', sort: 'desc' },
            { col: 'Hn trop longue', field: 'Img_Hn trop longue', sort: 'desc' },
        ];

        for (const { col, field, sort } of columns) {
            // Re-show all rows and columns instead of doing a full page reload!
            await page.evaluate(() => {
                const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
                for (const sel of tableSelectors) {
                    const rows = Array.from(document.querySelectorAll(sel));
                    if (rows.length > 0) {
                        rows.forEach(tr => {
                            tr.style.display = '';
                            Array.from(tr.children).forEach(td => td.style.display = '');
                        });
                        break;
                    }
                }
            });
            // Re-apply CSS to hide toolbars etc.
            await page.addStyleTag({ content: SHEETS_HIDE_CSS });
            await page.waitForTimeout(1000);

            // We must wait for the grid to rebuild after tab click/reload
            try { await page.waitForSelector('.waffle tbody tr', { state: 'attached', timeout: 15000 }); } catch (e) { console.log('[SHEETS] .waffle not found, proceeding anyway'); }

            const hasRelevantData = await page.evaluate(({ colName }) => {
                // Try multiple selectors for public + private views
                const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
                let allRows = [];
                for (const sel of tableSelectors) {
                    const elts = Array.from(document.querySelectorAll(sel));
                    // Exclude rows that belong to the header or tab bar
                    allRows = elts.filter(el => !el.closest('#docs-header') && !el.closest('.grid-bottom-bar') && !el.closest('.docs-sheet-tab-bar') && !el.closest('.docs-titlebar-buttons'));
                    if (allRows.length > 1) break;
                }
                if (allRows.length <= 1) return { found: false, reason: `No table rows (tried ${tableSelectors.join(', ')})` };

                // CRITICAL FIX: Find the REAL header row by looking for known column names
                // Skip rows that are Google Finance disclaimers or other overlay content
                const knownHeaders = ['url', 'h1', 'hn', 'balise', 'absente', 'vide', 'sauts', 'longue', 'destination'];
                let headerRowIdx = -1;

                for (let i = 0; i < Math.min(allRows.length, 5); i++) {
                    const cellTexts = Array.from(allRows[i].children).map(c => c.innerText.trim().toLowerCase());
                    // Check if this row looks like a header (contains at least one known column keyword)
                    const isHeader = cellTexts.some(text => knownHeaders.some(kw => text.includes(kw)));
                    if (isHeader) {
                        headerRowIdx = i;
                        break;
                    }
                }

                if (headerRowIdx === -1) {
                    // Log what we found for debugging
                    const firstRowText = Array.from(allRows[0]?.children || []).map(c => c.innerText.trim().substring(0, 50));
                    return { found: false, reason: `No valid header row found. First row content: [${firstRowText.join(' | ')}]` };
                }

                const rows = allRows.slice(headerRowIdx); // Start from the real header row
                const headers = Array.from(rows[0]?.children || []);
                const headerTexts = headers.map(h => h.innerText.trim().toLowerCase());
                const colIdx = headerTexts.findIndex(h => h.includes(colName.toLowerCase()));
                if (colIdx === -1) return { found: false, reason: `Column "${colName}" not found in headers: [${headerTexts.join(', ')}]` };

                const hasData = rows.slice(1).some(tr => {
                    const val = (tr.children[colIdx]?.innerText || '').toLowerCase().trim();
                    if (colName === 'Sauts de niveau entre les Hn') {
                        const n = parseFloat(val); return !isNaN(n) && n !== 0;
                    } else if (colName === 'Hn trop longue') {
                        const n = parseFloat(val); return !isNaN(n) && n >= 1;
                    } else {
                        return val === 'oui';
                    }
                });
                return { found: true, hasData, rowCount: rows.length - 1, headerRowIdx };
            }, { colName: col });

            console.log(`[SHEETS] H1-H6 "${col}": ${JSON.stringify(hasRelevantData)}`);

            if (!hasRelevantData.found || !hasRelevantData.hasData) {
                const reason = hasRelevantData.reason || `Aucun "oui" dans ${col} (${hasRelevantData.rowCount || 0} lignes)`;
                console.log(`[SHEETS] Skipping ${col}: ${reason}`);
                results[field] = { statut: 'SKIP', details: reason };
                continue;
            }

            await page.evaluate(({ colName, sortDir }) => {
                const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
                let allRows = [];
                for (const sel of tableSelectors) {
                    const elts = Array.from(document.querySelectorAll(sel));
                    // Exclude rows that belong to the header or tab bar
                    allRows = elts.filter(el => !el.closest('#docs-header') && !el.closest('.grid-bottom-bar') && !el.closest('.docs-sheet-tab-bar') && !el.closest('.docs-titlebar-buttons'));
                    if (allRows.length > 1) break;
                }

                // Find the REAL header row (skip Google Finance disclaimers)
                const knownHeaders = ['url', 'h1', 'hn', 'balise', 'absente', 'vide', 'sauts', 'longue', 'destination'];
                let headerRowIdx = 0;
                for (let i = 0; i < Math.min(allRows.length, 5); i++) {
                    const cellTexts = Array.from(allRows[i].children).map(c => c.innerText.trim().toLowerCase());
                    if (cellTexts.some(text => knownHeaders.some(kw => text.includes(kw)))) {
                        headerRowIdx = i;
                        break;
                    }
                }

                const rows = allRows.slice(headerRowIdx);
                const headers = Array.from(rows[0]?.children || []);
                const colIdx = headers.findIndex(h => h.innerText.trim().toLowerCase().includes(colName.toLowerCase()));
                if (colIdx === -1) return;

                const tbody = rows[0]?.parentElement || document.querySelector('.waffle tbody');
                if (!tbody) return;
                const dataRows = rows.slice(1);

                dataRows.forEach(tr => {
                    const val = (tr.children[colIdx]?.innerText || '').toLowerCase().trim();
                    const numeric = parseFloat(val);
                    tr.dataset.val = isNaN(numeric) ? 0 : numeric;
                    tr.dataset.textVal = val === 'oui' ? 1 : 0;
                    let show;
                    if (colName === 'Sauts de niveau entre les Hn') {
                        show = !isNaN(numeric) && numeric !== 0;
                    } else if (colName === 'Hn trop longue') {
                        show = !isNaN(numeric) && numeric >= 1;
                    } else {
                        show = val === 'oui';
                    }
                    tr.style.display = show ? '' : 'none';
                });

                if (sortDir === 'desc') {
                    dataRows.sort((a, b) => parseFloat(b.dataset.val) - parseFloat(a.dataset.val));
                } else {
                    dataRows.sort((a, b) => parseInt(b.dataset.textVal) - parseInt(a.dataset.textVal));
                }
                dataRows.forEach(tr => tbody.appendChild(tr));

                // Hide overlay rows (those before the real header)
                for (let i = 0; i < headerRowIdx; i++) {
                    allRows[i].style.display = 'none';
                }

                // Keep only URL column (0) + the checked column
                const keepIdx = [0, colIdx];
                rows.forEach(tr => {
                    Array.from(tr.children).forEach((td, idx) => {
                        if (!keepIdx.includes(idx)) td.style.display = 'none';
                    });
                });
            }, { colName: col, sortDir: sort });

            await page.waitForTimeout(1000);
            const tmpDir = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : '.';
            const tmpPath = path.join(tmpDir, `temp_sheet_h1_${uuidv4()}.png`);
            await page.screenshot({ path: tmpPath, fullPage: false });

            const prompt = `${SHEET_CROP_PROMPT}
Vérifie qu'aucune ligne contenant "non" n'apparaît dans la colonne "${col}". Si des "non" sont visibles en bas, rogne pour les exclure.`;
            const croppedPath = await cropWithAI(tmpPath, prompt);
            const cloudUrl = await uploadToCloudinary(croppedPath, `audit-results/sheet-h1-${auditId}`);
            if (fs.existsSync(croppedPath)) fs.unlinkSync(croppedPath);
            if (fs.existsSync(tmpPath) && tmpPath !== croppedPath) fs.unlinkSync(tmpPath);

            results[field] = { statut: 'SUCCESS', capture: cloudUrl?.secure_url || cloudUrl?.url || cloudUrl };
        }
    } catch (e) {
        console.error('[SHEETS] H1-H6 error:', e.message);
    } finally { await browser.close(); }
    return results;
}

export async function captureSheetMotsBody(sheetUrl, auditId, googleCookies) {
    const result = { statut: 'ERROR', capture: null };
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, 'Nb mots body');
        if (!found) { result.statut = 'SKIP'; result.details = 'Onglet Nb mots body introuvable'; return result; }

        // Sort Gravité décroissant, keep top 10
        await page.evaluate(() => {
            const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
            let allRows = [];
            for (const sel of tableSelectors) {
                const elts = Array.from(document.querySelectorAll(sel));
                allRows = elts.filter(el => !el.closest('#docs-header') && !el.closest('.grid-bottom-bar') && !el.closest('.docs-sheet-tab-bar') && !el.closest('.docs-titlebar-buttons'));
                if (allRows.length > 1) break;
            }
            if (!allRows.length) return;

            const knownHeaders = ['url', 'mots', 'body', 'gravité', 'liens', 'titre', 'h1', 'destination'];
            let headerRowIdx = 0;
            for (let i = 0; i < Math.min(allRows.length, 5); i++) {
                const texts = Array.from(allRows[i].children).map(c => c.innerText.trim().toLowerCase());
                if (texts.some(t => knownHeaders.some(kw => t.includes(kw)))) {
                    headerRowIdx = i;
                    break;
                }
            }

            const rows = allRows.slice(headerRowIdx);
            const headers = Array.from(rows[0]?.children || []);
            const gravIdx = headers.findIndex(h => h.innerText.includes('Gravité'));
            if (gravIdx === -1) return;

            const tbody = rows[0]?.parentElement || document.querySelector('.waffle tbody');
            if (!tbody) return;
            const dataRows = rows.slice(1).filter(tr => tr.style.display !== 'none');

            dataRows.sort((a, b) => {
                const va = parseFloat((a.children[gravIdx]?.innerText || '0').replace(',', '.')) || 0;
                const vb = parseFloat((b.children[gravIdx]?.innerText || '0').replace(',', '.')) || 0;
                return vb - va;
            });

            // Re-append sequentially and show only top 10
            let visibleCount = 0;
            dataRows.forEach(tr => {
                tbody.appendChild(tr);
                if (visibleCount < 10) {
                    tr.style.display = '';
                    visibleCount++;
                } else {
                    tr.style.display = 'none';
                }
            });

            for (let i = 0; i < headerRowIdx; i++) allRows[i].style.display = 'none';
        });

        await page.waitForTimeout(1000);
        const url = await captureAndUpload(page, SHEET_CROP_PROMPT + '\nGarde uniquement les 10 premières lignes de données.', `audit-results/sheet-mots-body-${auditId}`);
        result.capture = url;
        result.statut = 'SUCCESS';
    } catch (e) { result.details = e.message; }
    finally { await browser.close(); }
    return result;
}

export async function captureSheetMetaDesc(sheetUrl, auditId, googleCookies) {
    const result = { statut: 'ERROR', capture: null };
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, 'Meta desc');
        if (!found) { result.statut = 'SKIP'; result.details = 'Onglet Meta desc introuvable'; return result; }

        // We must wait for the grid
        try { await page.waitForSelector('.waffle tbody tr', { state: 'attached', timeout: 10000 }); } catch (e) { }

        // Sort ascending — 0s come to top, hide non-zero rows
        await page.evaluate(() => {
            const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
            let allRows = [];
            for (const sel of tableSelectors) {
                const elts = Array.from(document.querySelectorAll(sel));
                allRows = elts.filter(el => !el.closest('#docs-header') && !el.closest('.grid-bottom-bar') && !el.closest('.docs-sheet-tab-bar') && !el.closest('.docs-titlebar-buttons'));
                if (allRows.length > 1) break;
            }
            if (!allRows.length) return;
            const knownHeaders = ['url', 'destination', 'meta', 'description', 'caractère', 'nb', 'longueur'];
            let headerIdx = 0;
            for (let i = 0; i < Math.min(allRows.length, 5); i++) {
                const texts = Array.from(allRows[i].children).map(c => c.innerText.trim().toLowerCase());
                if (texts.some(t => knownHeaders.some(kw => t.includes(kw)))) { headerIdx = i; break; }
            }
            const rows = allRows.slice(headerIdx);
            const headers = Array.from(rows[0]?.children || []);
            const colIdx = headers.findIndex(h => h.innerText.toLowerCase().includes('nb de caractères') || h.innerText.toLowerCase().includes('caractère'));
            if (colIdx === -1) return;

            const tbody = rows[0]?.parentElement || document.querySelector('.waffle tbody');
            if (!tbody) return;
            const dataRows = rows.slice(1);

            dataRows.forEach(tr => {
                const v = parseFloat(tr.children[colIdx]?.innerText || '999');
                tr.dataset.val = isNaN(v) ? 999 : v;
                // If there are zero values, hide non-zero, but we'll show at least 5 rows if there are NO 0s to prove it's clean
            });

            const zeroCount = dataRows.filter(tr => parseFloat(tr.dataset.val) === 0).length;

            dataRows.forEach((tr, i) => {
                if (zeroCount > 0) {
                    tr.style.display = parseFloat(tr.dataset.val) === 0 ? '' : 'none';
                } else {
                    // NO 0s found! Show the first 5 rows to provide proof
                    tr.style.display = i < 5 ? '' : 'none';
                }
            });

            dataRows.sort((a, b) => parseFloat(a.dataset.val) - parseFloat(b.dataset.val));
            dataRows.forEach(tr => tbody.appendChild(tr));

            // Hide overlay rows
            for (let i = 0; i < headerIdx; i++) allRows[i].style.display = 'none';
        });

        await page.waitForTimeout(1000);
        const prompt = `${SHEET_CROP_PROMPT}\nNe garde que les lignes où le nombre de caractères dans la balise meta description est 0. Rogne tout ce qui est en-dessous.`;
        const url = await captureAndUpload(page, prompt, `audit-results/sheet-meta-desc-${auditId}`);
        result.capture = url;
        result.statut = 'SUCCESS';
    } catch (e) { result.details = e.message; }
    finally { await browser.close(); }
    return result;
}

export async function captureSheetBaliseTitle(sheetUrl, auditId, googleCookies) {
    const result = { statut: 'ERROR', capture: null };
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, 'Balise title');
        if (!found) { result.statut = 'SKIP'; result.details = 'Onglet Balise title introuvable'; return result; }

        // We must wait for the grid
        try { await page.waitForSelector('.waffle tbody tr', { state: 'attached', timeout: 10000 }); } catch (e) { }

        // Keeps and sorts 'trop longue' values
        await page.evaluate(() => {
            const tableSelectors = ['.waffle tbody tr', '.waffle tr', '#sheets-viewport table tr', '.grid-container table tr'];
            let allRows = [];
            for (const sel of tableSelectors) {
                const elts = Array.from(document.querySelectorAll(sel));
                allRows = elts.filter(el => !el.closest('#docs-header') && !el.closest('.grid-bottom-bar') && !el.closest('.docs-sheet-tab-bar') && !el.closest('.docs-titlebar-buttons'));
                if (allRows.length > 1) break;
            }
            if (!allRows.length) return;
            const knownHeaders = ['url', 'destination', 'title', 'balise', 'état', 'longueur'];
            let headerIdx = 0;
            for (let i = 0; i < Math.min(allRows.length, 5); i++) {
                const texts = Array.from(allRows[i].children).map(c => c.innerText.trim().toLowerCase());
                if (texts.some(t => knownHeaders.some(kw => t.includes(kw)))) { headerIdx = i; break; }
            }
            const rows = allRows.slice(headerIdx);
            const headers = Array.from(rows[0]?.children || []);
            const colIdx = headers.findIndex(h => h.innerText.toLowerCase().includes('état') || h.innerText.toLowerCase().includes('balise title'));
            if (colIdx === -1) return;

            const tbody = rows[0]?.parentElement || document.querySelector('.waffle tbody');
            if (!tbody) return;
            const dataRows = rows.slice(1);

            dataRows.forEach(tr => {
                const v = (tr.children[colIdx]?.innerText || '').toLowerCase();
                const match = v.includes('trop longue');
                tr.dataset.match = match ? 1 : 0;
            });

            const matchCount = dataRows.filter(tr => parseInt(tr.dataset.match) === 1).length;

            dataRows.forEach((tr, i) => {
                if (matchCount > 0) {
                    tr.style.display = parseInt(tr.dataset.match) === 1 ? '' : 'none';
                } else {
                    // Provide proof that everything is fine (show 5 first rows)
                    tr.style.display = i < 5 ? '' : 'none';
                }
            });

            dataRows.sort((a, b) => parseInt(b.dataset.match) - parseInt(a.dataset.match));
            dataRows.forEach(tr => tbody.appendChild(tr));

            // Hide overlay rows
            for (let i = 0; i < headerIdx; i++) allRows[i].style.display = 'none';
        });

        await page.waitForTimeout(1000);
        const url = await captureAndUpload(page, SHEET_CROP_PROMPT + '\nNe garde que les lignes avec le statut "trop longue".', `audit-results/sheet-balise-title-${auditId}`);
        result.capture = url;
        result.statut = 'SUCCESS';
    } catch (e) { result.details = e.message; }
    finally { await browser.close(); }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN D'ACTION SHEET TABS (simple captures)
// ─────────────────────────────────────────────────────────────────────────────

export async function capturePlanTab(sheetUrl, tabName, auditId, googleCookies, cloudinarySlug) {
    const result = { statut: 'ERROR', capture: null };
    const { browser, page } = await openSheet(sheetUrl, googleCookies);
    try {
        const found = await navigateToTab(page, tabName);
        if (!found) { result.statut = 'SKIP'; result.details = `Onglet "${tabName}" introuvable`; return result; }
        await page.waitForTimeout(2000);
        const url = await captureAndUpload(page,
            `${SHEET_CROP_PROMPT}\nRogne pour ne garder que le tableau. Supprime tous les menus et marges Sheets.`,
            `audit-results/${cloudinarySlug}-${auditId}`
        );
        result.capture = url;
        result.statut = 'SUCCESS';
    } catch (e) { result.details = e.message; }
    finally { await browser.close(); }
    return result;
}
