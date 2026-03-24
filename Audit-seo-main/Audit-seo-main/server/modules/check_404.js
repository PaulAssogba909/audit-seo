/**
 * check_404.js
 * Reads the "Erreurs 4xx et 5xx" tab from the audit Google Sheet via API,
 * filters rows with HTTP code = 404,
 * renders an HTML table (Google Sheets style), captures as PNG,
 * and extracts the first 404 link.
 */
import { google } from "googleapis";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import { uploadToCloudinary } from "../utils/cloudinary.js";

// ── Google Sheets helpers ──────────────────────────────────────────────────────
function sheetsClient() {
    const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    return google.sheets({ version: "v4", auth: oauth2 });
}

function extractSpreadsheetId(url) {
    if (!url) return null;
    const m = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
}

function norm(s) {
    return String(s ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s+/g, " ");
}

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ── Detect if a cell value looks like a URL ────────────────────────────────────
function isUrl(val) {
    return /^https?:\/\//i.test(String(val ?? "").trim());
}

// ── Render cell: make URLs blue like Google Sheets ─────────────────────────────
function renderCell(val) {
    const s = escapeHtml(String(val ?? ""));
    if (isUrl(val)) {
        return `<span style="color:#1155cc;">${s}</span>`;
    }
    return s;
}

// ── Build the HTML page (Google Sheets style) ──────────────────────────────────
function renderSheetsHtml(headers, rows, title) {
    const ths = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");
    const trs = rows.map(r => {
        const tds = headers.map((_, i) => `<td>${renderCell(r[i])}</td>`).join("");
        return `<tr>${tds}</tr>`;
    }).join("");

    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; }
  .wrap {
    display: inline-block;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
  }
  table {
    border-collapse: collapse;
  }
  thead th {
    background: #f3f3f3;
    border: 1px solid #e2e2e2;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 700;
    color: #333;
    text-align: left;
    white-space: nowrap;
  }
  tbody td {
    border: 1px solid #e2e2e2;
    padding: 2px 8px;
    font-size: 11px;
    color: #333;
    vertical-align: top;
    white-space: nowrap;
    max-width: 600px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody tr:nth-child(even) td { background: #f8f9fa; }
  tbody tr:nth-child(odd) td { background: #fff; }
</style>
</head>
<body>
  <div class="wrap" id="capture">
    <table>
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>
</body>
</html>`;
}

// ── Convert HTML → PNG (tight fit) ─────────────────────────────────────────────
async function htmlToPng(html, outPath) {
    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
        await page.setContent(html, { waitUntil: "load" });

        const el = page.locator("#capture");
        await el.waitFor({ state: "visible", timeout: 15000 });
        await el.screenshot({ path: outPath });

        // Trim any remaining whitespace around the table
        try {
            const buf = await sharp(outPath).trim({ threshold: 10 }).toBuffer();
            fs.writeFileSync(outPath, buf);
        } catch { /* trim may fail on very small images, keep as-is */ }
    } finally {
        await browser.close();
    }
}

// ── MAIN EXPORT ────────────────────────────────────────────────────────────────
export async function check404(sheetUrl, auditId) {
    const result = { statut: 'SKIP', capture: null, lien404: null };

    if (!sheetUrl) {
        result.details = 'Lien Google Sheet non fourni';
        return result;
    }

    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) {
        result.details = 'URL Google Sheet invalide';
        return result;
    }

    try {
        const sheets = sheetsClient();

        // Try to find the right tab name
        const tabCandidates = ['Erreurs 4xx et 5xx', 'Erreurs 4xx', 'Erreurs', 'Errors', '404'];
        let tabData = [];
        let usedTab = null;

        // Get all sheet names first
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
        console.log(`[404] Available tabs: ${sheetNames.join(', ')}`);

        for (const candidate of tabCandidates) {
            const match = sheetNames.find(n => norm(n).includes(norm(candidate)));
            if (match) {
                console.log(`[404] Found matching tab: "${match}"`);
                try {
                    const res = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range: `'${match.replace(/'/g, "''")}'!A1:ZZ`,
                        valueRenderOption: "FORMATTED_VALUE",
                    });
                    tabData = res?.data?.values || [];
                    usedTab = match;
                } catch (e) {
                    console.error(`[404] Error reading tab "${match}": ${e.message}`);
                }
                if (tabData.length > 0) break;
            }
        }

        if (tabData.length < 2) {
            result.details = `Onglet "Erreurs 4xx et 5xx" non trouvé ou vide (tabs: ${sheetNames.join(', ')})`;
            return result;
        }

        console.log(`[404] Read ${tabData.length} rows from tab "${usedTab}"`);

        // Find headers
        const headers = tabData[0];
        const dataRows = tabData.slice(1);

        // Find "Code HTTP" column
        const codeColIdx = headers.findIndex(h => {
            const n = norm(h);
            return n.includes('code http') || n.includes('code') || n.includes('status') || n.includes('http');
        });

        // Find "Page contenant le lien vers l'URL en erreur" column
        const pageColIdx = headers.findIndex(h => {
            const n = norm(h);
            return n.includes('page contenant') || n.includes('lien vers') || n.includes('page source') || n.includes('url');
        });

        if (codeColIdx === -1) {
            result.details = `Colonne "Code HTTP" introuvable (colonnes: ${headers.join(', ')})`;
            return result;
        }

        console.log(`[404] Code HTTP column: ${codeColIdx} ("${headers[codeColIdx]}"), Page column: ${pageColIdx} ("${headers[pageColIdx] || 'N/A'}")`);

        // Filter: keep only rows with Code HTTP = 404
        const rows404 = dataRows.filter(row => {
            const code = String(row[codeColIdx] ?? "").trim();
            return code === '404' || code.includes('404');
        });

        console.log(`[404] Found ${rows404.length} rows with Code 404 out of ${dataRows.length} total`);

        if (rows404.length === 0) {
            result.statut = 'SKIP';
            result.details = 'Aucune erreur 404 trouvée';
            return result;
        }

        // Extract first 404 link
        if (pageColIdx >= 0 && rows404.length > 0) {
            const firstLink = String(rows404[0][pageColIdx] ?? "").trim();
            if (firstLink) {
                result.lien404 = firstLink;
                console.log(`[404] First 404 link: ${firstLink}`);
            }
        }

        // Keep only the two key columns for the render
        const keepHeaders = [];
        const keepIndices = [];

        if (pageColIdx >= 0) {
            keepHeaders.push(headers[pageColIdx]);
            keepIndices.push(pageColIdx);
        }
        keepHeaders.push(headers[codeColIdx]);
        keepIndices.push(codeColIdx);

        const projectedRows = rows404
            .slice(0, 15) // Limit to 15 rows
            .map(r => keepIndices.map(i => r[i] ?? ""));

        // Render HTML table in Google Sheets style
        const html = renderSheetsHtml(keepHeaders, projectedRows, "Erreurs 404");

        const tmpDir = process.env.RAILWAY_ENVIRONMENT ? "/tmp" : ".";
        const pngPath = path.join(tmpDir, `temp_404_${uuidv4()}.png`);

        await htmlToPng(html, pngPath);

        const cloudRes = await uploadToCloudinary(pngPath, `audit-results/404-${auditId}`);
        if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);

        result.capture = cloudRes?.secure_url || cloudRes?.url || cloudRes;
        result.statut = 'SUCCESS';

    } catch (e) {
        result.details = e.message;
        console.error('[404] Error:', e.message);
    }

    return result;
}
