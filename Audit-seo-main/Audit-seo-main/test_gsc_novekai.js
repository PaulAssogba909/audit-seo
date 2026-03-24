import { captureGscSitemaps, captureGscHttps, captureGscPerformance } from './server/modules/google_search_console.js';

const gscCookies = [
    { "domain": ".google.com", "expirationDate": 1806516901.237265, "hostOnly": false, "httpOnly": false, "name": "SAPISID", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "4DzhK19iNls28n5A/A8Go1fcgIwqxOj_WA" },
    { "domain": ".google.com", "expirationDate": 1806516901.237527, "hostOnly": false, "httpOnly": false, "name": "__Secure-3PAPISID", "path": "/", "sameSite": "no_restriction", "secure": true, "session": false, "storeId": null, "value": "4DzhK19iNls28n5A/A8Go1fcgIwqxOj_WA" },
    { "domain": ".google.com", "expirationDate": 1784966843.170502, "hostOnly": false, "httpOnly": true, "name": "AEC", "path": "/", "sameSite": "lax", "secure": true, "session": false, "storeId": null, "value": "AaJma5vWx2iH4YvxfoyZceA5j3-1zEUfTdVyEAqvCVWBKDh0IEbslAYMSYc" },
    { "domain": ".google.com", "expirationDate": 1806738248.797868, "hostOnly": false, "httpOnly": false, "name": "_ga", "path": "/search-console", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "GA1.2-2.73012669.1771429270" },
    { "domain": ".google.com", "expirationDate": 1787918565.076423, "hostOnly": false, "httpOnly": true, "name": "NID", "path": "/", "sameSite": "no_restriction", "secure": true, "session": false, "storeId": null, "value": "529=JMQlEURnaqbJKLZPC-uKBOCR5nA4eLUZF865Xx3Y43jfsBNQncv_5dUWdQQmjHW4VwIMXLBb-Mw4XDd-GeEgI1Pe2onVNACYcaBvtpB-oLDB5jBxORYBksYPz_cI2MO8BmeAoMeULZyZsevKAg6b9kF_eMHkPck8HdojttunUbleUDlsMuQjwutFig1srp9wxLMvwZhrq601n2hXaojqY1m-0BgP_oNnkYI2Uk4-Lk413N69byULVotuTYa6kmzb0c-GZcUl6mncB6MJo55BYIGg1UmyNH5fEKU5nek4yK9ARS2odZWiDJv4UMY9rL5ugPePZ0seUctlG9tzI9ZJG1mbTkeGKoZVWejdPlLIsR2S8P9KJ-3gOunEG4km_OZWCzGgLjIl9ax3zdZeLmwqhB_B5RSD7zcWZHq5vJ64SSk3mcnJJg0mBotRBdYO1E2SMAI5RhEsN3Rpo6kn93VXkkw9bFpUawgDe0ztRgouXRPH7CP63agoPJRifJNNQonx2qUcVCRt0DNhibTP0QKGxN7kSAtbhoVK-CCFcRGUWiGF3JWFEPkS0hKGOe_yagO4wOu0fdBTG5nV-il2OOUg2B78qQzVWkbSZqztU9aasjuLjPzHGTzq0PceosKQ3A8L5ySgpN584OIGyjfqcAWAB_B-MhQPCf4eqmV_R0OEAlwhTsf-tnm3P6_ipyRqL-JcMTp-OAJokWuIQEW7wqzW9q1rK-PaornEQxnOAq_eR_jCULHqcw" },
    { "domain": ".google.com", "expirationDate": 1806516901.237111, "hostOnly": false, "httpOnly": false, "name": "APISID", "path": "/", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "E2dDyX1gtc3WKbxl/ADG-q7J9jtSL2Aj0C" },
    { "domain": ".google.com", "expirationDate": 1803716082.568444, "hostOnly": false, "httpOnly": true, "name": "__Secure-1PSIDTS", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "sidts-CjcBBj1CYgTnOhWP2OpLVS6kxMd3YRskHOVRGwjAFUz-Kgc35Q3pBiwoUIfcOVY8rFBu4qC6EupNEAA" },
    { "domain": ".google.com", "expirationDate": 1806516901.237387, "hostOnly": false, "httpOnly": false, "name": "__Secure-1PAPISID", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "4DzhK19iNls28n5A/A8Go1fcgIwqxOj_WA" },
    { "domain": ".google.com", "expirationDate": 1772264648, "hostOnly": false, "httpOnly": false, "name": "_gid", "path": "/search-console", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "GA1.2-2.1795627088.1772016729" },
    { "domain": ".google.com", "expirationDate": 1806516901.238995, "hostOnly": false, "httpOnly": true, "name": "__Secure-3PSID", "path": "/", "sameSite": "no_restriction", "secure": true, "session": false, "storeId": null, "value": "g.a0007AhJ6J4xEXDcNJGiId-bxARWNUbBEypNDy_tIaVlbFTs8I-N_MaW3fbgPkp8OfxSIN9bCgACgYKAWgSARUSFQHGX2Mi0qIZ3RenwbqkVXVJOG123BoVAUF8yKqhaoI1WxODjF_37Jxb6sut0076" },
    { "domain": ".google.com", "expirationDate": 1806516901.238866, "hostOnly": false, "httpOnly": true, "name": "__Secure-1PSID", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "g.a0007AhJ6J4xEXDcNJGiId-bxARWNUbBEypNDy_tIaVlbFTs8I-NVLwk7bfAaWpTFajZ2e9JrwACgYKAWISARUSFQHGX2MiF2kKmMVBhGKj9RO2BBI5sxoVAUF8yKp3cmx1IBx_D4_W0_WLxikN0076" },
    { "domain": ".google.com", "expirationDate": 1803716247.767317, "hostOnly": false, "httpOnly": true, "name": "__Secure-1PSIDCC", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "AKEyXzUfAGC3Gst-XPHZyfBwLRzRFT-xfxq6j9N_omrSrRMEpph2b4owgfX9ifr1wjf4e9uXP-k" },
    { "domain": ".google.com", "expirationDate": 1772180682.568838, "hostOnly": false, "httpOnly": true, "name": "__Secure-1PSIDRTS", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "sidts-CjcBBj1CYgTnOhWP2OpLVS6kxMd3YRskHOVRGwjAFUz-Kgc35Q3pBiwoUIfcOVY8rFBu4qC6EupNEAA" },
    { "domain": ".google.com", "expirationDate": 1803716247.767462, "hostOnly": false, "httpOnly": true, "name": "__Secure-3PSIDCC", "path": "/", "sameSite": "no_restriction", "secure": true, "session": false, "storeId": null, "value": "AKEyXzU0pa0dAC5I3IEIS8pF4yj4B_qhAr86ExnDDCFGR5XhGz9cOy8G1CvPD8jJXRT3SQ6CfDk" },
    { "domain": ".google.com", "expirationDate": 1772180682.569137, "hostOnly": false, "httpOnly": true, "name": "__Secure-3PSIDRTS", "path": "/", "sameSite": "no_restriction", "secure": true, "session": false, "storeId": null, "value": "sidts-CjcBBj1CYgTnOhWP2OpLVS6kxMd3YRskHOVRGwjAFUz-Kgc35Q3pBiwoUIfcOVY8rFBu4qC6EupNEAA" },
    { "domain": ".google.com", "expirationDate": 1803716082.568995, "hostOnly": false, "httpOnly": true, "name": "__Secure-3PSIDTS", "path": "/", "sameSite": "no_restriction", "secure": true, "session": false, "storeId": null, "value": "sidts-CjcBBj1CYgTnOhWP2OpLVS6kxMd3YRskHOVRGwjAFUz-Kgc35Q3pBiwoUIfcOVY8rFBu4qC6EupNEAA" },
    { "domain": ".google.com", "expirationDate": 1784966841.39934, "hostOnly": false, "httpOnly": true, "name": "__Secure-BUCKET", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "CL0F" },
    { "domain": ".search.google.com", "expirationDate": 1806738247.269937, "hostOnly": false, "httpOnly": false, "name": "_ga", "path": "/", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "GA1.1.73012669.1771429270" },
    { "domain": ".search.google.com", "expirationDate": 1806738248.373798, "hostOnly": false, "httpOnly": false, "name": "_ga_QX2LK1FZEG", "path": "/", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "GS2.1.s1772178247$o14$g1$t1772178248$j59$l0$h0" },
    { "domain": ".google.com", "expirationDate": 1806516901.236649, "hostOnly": false, "httpOnly": true, "name": "HSID", "path": "/", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "AaT7xWkFkKHV2lxbc" },
    { "domain": "search.google.com", "expirationDate": 1774021271, "hostOnly": true, "httpOnly": false, "name": "OTZ", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "8485421_52_52__52_" },
    { "domain": ".google.com", "expirationDate": 1784966841.399068, "hostOnly": false, "httpOnly": false, "name": "SEARCH_SAMESITE", "path": "/", "sameSite": "strict", "secure": false, "session": false, "storeId": null, "value": "CgQI_58B" },
    { "domain": ".google.com", "expirationDate": 1806516901.238728, "hostOnly": false, "httpOnly": false, "name": "SID", "path": "/", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "g.a0007AhJ6J4xEXDcNJGiId-bxARWNUbBEypNDy_tIaVlbFTs8I-NMpIAih8iCCasK1hkVMSWmAACgYKAZISARUSFQHGX2MiMoAZSRbzNFVPkgD_49ZgtxoVAUF8yKqyJWuJTB4bFJK2UaQYKnH-0076" },
    { "domain": ".google.com", "expirationDate": 1803716247.767009, "hostOnly": false, "httpOnly": false, "name": "SIDCC", "path": "/", "sameSite": null, "secure": false, "session": false, "storeId": null, "value": "AKEyXzUHJzB9Uk1YGo2UB5w67bxzOosEEI_2mvgBY55FFQuhksbl1yhA4-aCZ_CzfUkvxNHWjIY" },
    { "domain": ".google.com", "expirationDate": 1806516901.236852, "hostOnly": false, "httpOnly": true, "name": "SSID", "path": "/", "sameSite": null, "secure": true, "session": false, "storeId": null, "value": "AerDXc-6_yHLgi_vd" }
];

const auditId = 'test-novekai-agency-' + Date.now();
const siteUrl = 'https://novekai.agency';

async function runTests() {
    console.log("🧪 Testing GSC for novekai.agency...");

    console.log("\n1. Sitemaps...");
    const gscSit = await captureGscSitemaps(siteUrl, auditId, gscCookies);
    console.log("GSC Sitemaps:", JSON.stringify(gscSit, null, 2));

    console.log("\n2. Performance...");
    const gscPerf = await captureGscPerformance(siteUrl, auditId, gscCookies);
    console.log("GSC Performance:", JSON.stringify(gscPerf, null, 2));

    console.log("\n3. HTTPS...");
    const gscHttps = await captureGscHttps(siteUrl, auditId, gscCookies);
    console.log("GSC HTTPS:", JSON.stringify(gscHttps, null, 2));

    process.exit(0);
}

runTests().catch(err => {
    console.error("TEST ERROR:", err);
    process.exit(1);
});
