/**
 * Test d'audit complet — Appelle l'API locale pour lancer un audit
 * Usage: node test-audit-complet.js
 */
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const TEST_EMAIL = `audit-test-${Date.now()}@novek.ai`;
const TEST_PASS = 'TestAudit123!';

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  SMART AUDIT — Test Complet');
    console.log('═══════════════════════════════════════════════\n');

    // 1. Register
    console.log(`[1/3] Inscription (${TEST_EMAIL})...`);
    const regRes = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS })
    });
    const regData = await regRes.json();
    if (regRes.ok) {
        console.log('  ✅ Compte créé');
    } else {
        console.log(`  ❌ Erreur: ${regData.error}`);
        process.exit(1);
    }

    // 2. Login — Token is in Set-Cookie header (httpOnly)
    console.log('[2/3] Connexion...');
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS })
    });
    if (!loginRes.ok) {
        const err = await loginRes.json();
        console.error('  ❌ Login échoué:', err);
        process.exit(1);
    }

    // Extract token from Set-Cookie header
    const setCookies = loginRes.headers.getSetCookie?.() || [loginRes.headers.get('set-cookie')].filter(Boolean);
    let cookieHeader = setCookies.join('; ');

    // Also try to get from response body (some versions put token in body)
    const loginData = await loginRes.json();
    let authHeader = {};
    if (loginData.token) {
        authHeader = { 'Authorization': `Bearer ${loginData.token}` };
        console.log('  ✅ Connecté (token dans body)');
    } else if (cookieHeader) {
        console.log('  ✅ Connecté (token dans cookie)');
    } else {
        console.error('  ❌ Pas de token trouvé');
        process.exit(1);
    }

    // 3. Lancer l'audit
    console.log('[3/3] Lancement de l\'audit complet...');
    const headers = {
        'Content-Type': 'application/json',
        ...authHeader
    };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const auditRes = await fetch(`${BASE}/api/audits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            siteName: 'Notion Audit Complet',
            siteUrl: 'https://www.notion.so',
            auditSheetUrl: 'https://docs.google.com/spreadsheets/d/119SxL31wtYHjkeNLH28mGHuy4-lkp91SKHHbxyrYJHk/edit?gid=941263829#gid=941263829',
            actionPlanSheetUrl: 'https://docs.google.com/spreadsheets/d/1Q2TBUUW1YI0Eg8tu6WzobqZvregOdGDlvJiyCYQHRoM/edit?gid=1094454912#gid=1094454912',
            mrmReportUrl: 'https://myrankingmetrics.com/seo/audit/report/3c1fffd7-fa2d-4dfd-9344-0efd77777835#profondeur'
        })
    });

    const auditData = await auditRes.json();
    if (!auditRes.ok) {
        console.error('  ❌ Audit échoué:', auditData);
        process.exit(1);
    }

    console.log('  ✅ AUDIT LANCÉ !');
    console.log(`  📋 Audit ID: ${auditData.audit?.id || auditData.id || JSON.stringify(auditData)}`);
    console.log(`  🔗 Airtable ID: ${auditData.audit?.airtable_record_id || 'N/A'}`);
    console.log('\n═══════════════════════════════════════════════');
    console.log('  L\'audit tourne en background (~20-25 min)');
    console.log('  Les résultats seront envoyés à Airtable');
    console.log('  Suivez les logs serveur pour le détail');
    console.log('═══════════════════════════════════════════════');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
