import { captureMrmProfondeur } from './server/modules/mrm.js';

const mrmCookies = [
    { "domain": ".myrankingmetrics.com", "expirationDate": 1772375066.461907, "hostOnly": false, "httpOnly": false, "name": "ci_rem", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "3040eb688abcdcc614ae6e7a59df9a352cc14becc88786c4d27a2c51124285334cf0fabe" },
    { "domain": ".myrankingmetrics.com", "expirationDate": 1772187328.07621, "hostOnly": false, "httpOnly": true, "name": "ci_session", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "bjo6jnlv4fvkfpuvbashcnkenvuobepv" },
    { "domain": "myrankingmetrics.com", "hostOnly": true, "httpOnly": false, "name": "TawkConnectionTime", "path": "/", "sameSite": "lax", "secure": true, "session": true, "storeId": null, "value": "1772180293901" },
    { "domain": "myrankingmetrics.com", "hostOnly": true, "httpOnly": false, "name": "twk_idm_key", "path": "/", "sameSite": "lax", "secure": true, "session": true, "storeId": null, "value": "-2vKzVoOCnznHBrRw3Yaz" },
    { "domain": ".myrankingmetrics.com", "expirationDate": 1787729659, "hostOnly": false, "httpOnly": false, "name": "twk_uuid_61d47f273d23fa26e871041d", "path": "/", "sameSite": "lax", "secure": true, "session": false, "storeId": null, "value": "%7B%22uuid%22%3A%221.AGK8HL3CemcaMX8gAkcUgrPexidq045HrUDgKkJ1udbZSDzxMISRKXoU1kX4fhbkYiHTvjkqx4vCEdzPIznMJqP1WNAFooHfAmvbdUSm98MKQYyoud5woh6LK9Rp3vUN%22%2C%22version%22%3A3%2C%22domain%22%3A%22myrankingmetrics.com%22%2C%22ts%22%3A1772177659938%7D" }
];

const auditId = 'test-mrm-FINAL-' + Date.now();
const mrmReportUrl = 'https://myrankingmetrics.com/seo/audit/report/3c1fffd7-fa2d-4dfd-9344-0efd77777835#profondeur';

async function runTests() {
    console.log("🧪 Testing MRM Final Scroll to Section 4...");
    const mrmRes = await captureMrmProfondeur(mrmReportUrl, auditId, mrmCookies);
    console.log("MRM Result:", JSON.stringify(mrmRes, null, 2));
    process.exit(0);
}

runTests().catch(err => {
    console.error("CRITICAL TEST ERROR:", err);
    process.exit(1);
});
