import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { uploadToCloudinary } from '../utils/cloudinary.js';

/**
 * Audit SSL Labs via Official API
 * @param {string} domain - Domain to audit (e.g. google.com)
 * @param {string} auditId - Internal audit ID
 */
export async function auditSslLabs(domain, auditId) {
    let result = {
        statut: 'FAILED',
        capture: null,
        grade: null
    };

    try {
        console.log(`[MODULE-SSL] Checking v4 info for ${domain}...`);
        try {
            await axios.get('https://api.ssllabs.com/api/v4/info', {
                headers: { email: 'contact@novekai.agency' }
            });
        } catch (infoErr) {
            console.warn(`[MODULE-SSL] api/v4/info warning: ${infoErr.message}`);
        }

        // 1. Initialise scan (can take a few minutes if not cached)
        let data = null;
        let attempts = 0;
        let retries529 = 0;
        const maxAttempts = 40; // 40 * 15s = 10 mins max

        while (attempts < maxAttempts) {
            attempts++;
            console.log(`[MODULE-SSL] Polling API v4... Attempt ${attempts}/${maxAttempts}`);

            try {
                const response = await axios.get(`https://api.ssllabs.com/api/v4/analyze?host=${domain}&all=done`, {
                    headers: { email: 'contact@novekai.agency' }
                });
                data = response.data;

                if (data.status === 'READY') {
                    break;
                } else if (data.status === 'ERROR') {
                    throw new Error(`SSL Labs API Error: ${data.statusMessage || 'Unknown error'}`);
                }
            } catch (err) {
                if (err.response && err.response.status === 429) {
                    console.log(`[MODULE-SSL] Rate limit 429 hit. Waiting 30s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    continue;
                } else if (err.response && err.response.status === 529) {
                    retries529++;
                    if (retries529 > 3) {
                        console.log(`[MODULE-SSL] API overloaded (529) for too long, skipping module...`);
                        return { statut: 'SKIP', grade: 'SSL Labs surchargé', capture: null };
                    }
                    console.log(`[MODULE-SSL] API overloaded (529), waiting 60s before retry (${retries529}/3)...`);
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    continue;
                } else if (err.response && err.response.status >= 500) {
                    console.log(`[MODULE-SSL] Server error (${err.response.status}), waiting 15s before retry...`);
                } else {
                    throw err;
                }
            }

            // Wait 15 seconds before polling again
            await new Promise(resolve => setTimeout(resolve, 15000));
        }

        if (!data || data.status !== 'READY') {
            throw new Error('SSL Labs analysis timed out API side.');
        }

        // 2. Extract best grade from endpoints
        let bestGrade = 'N/A';
        let ipAddress = 'N/A';
        let serverName = 'N/A';
        let statusMessage = data.statusMessage || 'OK';

        if (data.endpoints && data.endpoints.length > 0) {
            // Find the highest grade (A+ is best)
            const validEndpoints = data.endpoints.filter(e => e.grade);
            if (validEndpoints.length > 0) {
                // Simplistic sort: A+, A, A-, B, etc.
                validEndpoints.sort((a, b) => a.grade.localeCompare(b.grade));
                bestGrade = validEndpoints[0].grade;
                ipAddress = validEndpoints[0].ipAddress;
                serverName = validEndpoints[0].serverName || 'Unknown Server';
                if (validEndpoints[0].statusMessage) {
                    statusMessage = validEndpoints[0].statusMessage;
                }
            } else if (data.endpoints[0].statusMessage) {
                statusMessage = data.endpoints[0].statusMessage;
            }
        }

        console.log(`[MODULE-SSL] Grade found: ${bestGrade} for ${ipAddress} | msg: ${statusMessage}`);

        // Calculate scores visually based on grade
        const scores = { cert: 100, proto: 100, key: 100, cipher: 100 };
        const g = bestGrade ? bestGrade.charAt(0).toUpperCase() : 'A';
        if (g === 'A') { scores.key = 90; scores.cipher = 90; }
        else if (g === 'B') { scores.proto = 90; scores.key = 80; scores.cipher = 80; }
        else if (g === 'C') { scores.proto = 80; scores.key = 70; scores.cipher = 70; }
        else if (g === 'D') { scores.proto = 70; scores.key = 60; scores.cipher = 60; }
        else if (g === 'E') { scores.proto = 60; scores.key = 50; scores.cipher = 50; }
        else if (g === 'F') { scores.proto = 50; scores.key = 40; scores.cipher = 40; }

        let color = '#5cb85c'; // Green
        if (['B', 'C'].includes(g)) color = '#f0ad4e'; // Orange
        if (['D', 'E', 'F'].includes(g)) color = '#d9534f'; // Red

        // 3. Generate a clean SVG summary image mimicking SSL Labs
        const svgContent = `
        <svg width="800" height="380" xmlns="http://www.w3.org/2000/svg">
            <style>
                .bg { fill: #ffffff; }
                .text { font-family: Arial, sans-serif; fill: #000000; }
                .border { stroke: #cccccc; stroke-width: 1; fill: none; }
                .header-bg { fill: #f5f5f5; }
                .header-line { stroke: #cccccc; stroke-width: 1; }
                .grade-box { fill: ${color}; rx: 8; ry: 8; }
                .grade-text { font-family: Arial, sans-serif; font-size: 90px; font-weight: bold; fill: #ffffff; text-anchor: middle; dominant-baseline: central; }
                .bar-fg { fill: ${color}; }
                .bar-label { font-family: Arial, sans-serif; font-size: 13px; fill: #000000; font-weight: bold; text-anchor: end; }
                .axis-label { font-family: Arial, sans-serif; font-size: 11px; fill: #999999; text-anchor: middle; }
                .grid-line { stroke: #cccccc; stroke-width: 1; }
                .overall-rating { font-family: Arial, sans-serif; font-size: 14px; fill: #555555; text-anchor: middle; }
            </style>
            
            <rect width="100%" height="100%" class="bg" />
            
            <!-- Main Box -->
            <rect x="20" y="20" width="760" height="340" class="border" />
            
            <!-- Header -->
            <rect x="20" y="20" width="760" height="50" class="header-bg" />
            <line x1="20" y1="70" x2="780" y2="70" class="header-line" />
            <text x="40" y="52" class="text" font-size="22" font-weight="bold" fill="#333333">SSL Report: ${domain} <tspan fill="#666666" font-size="16">(${ipAddress})</tspan></text>
            
            <text x="40" y="95" font-family="Arial" font-size="14" font-weight="bold" fill="#666666">Summary</text>
            
            <!-- Grade section -->
            <text x="210" y="115" class="overall-rating">Overall Rating</text>
            <rect x="130" y="130" width="160" height="160" class="grade-box" />
            <text x="210" y="215" class="grade-text">${bestGrade}</text>
            
            <!-- Bar charts Grid -->
            <!-- 0 to 100 -->
            <line x1="450" y1="120" x2="450" y2="290" class="grid-line" />
            <line x1="512.5" y1="120" x2="512.5" y2="290" class="grid-line" />
            <line x1="575" y1="120" x2="575" y2="290" class="grid-line" />
            <line x1="637.5" y1="120" x2="637.5" y2="290" class="grid-line" />
            <line x1="700" y1="120" x2="700" y2="290" class="grid-line" />
            <line x1="762.5" y1="120" x2="762.5" y2="290" class="grid-line" />
            
            <text x="450" y="310" class="axis-label">0</text>
            <text x="512.5" y="310" class="axis-label">20</text>
            <text x="575" y="310" class="axis-label">40</text>
            <text x="637.5" y="310" class="axis-label">60</text>
            <text x="700" y="310" class="axis-label">80</text>
            <text x="762.5" y="310" class="axis-label">100</text>

            <!-- Bars -->
            <text x="430" y="145" class="bar-label">Certificate</text>
            <rect x="450" y="130" width="${(scores.cert / 100) * 312.5}" height="22" class="bar-fg" />

            <text x="430" y="185" class="bar-label">Protocol Support</text>
            <rect x="450" y="170" width="${(scores.proto / 100) * 312.5}" height="22" class="bar-fg" />

            <text x="430" y="225" class="bar-label">Key Exchange</text>
            <rect x="450" y="210" width="${(scores.key / 100) * 312.5}" height="22" class="bar-fg" />

            <text x="430" y="265" class="bar-label">Cipher Strength</text>
            <rect x="450" y="250" width="${(scores.cipher / 100) * 312.5}" height="22" class="bar-fg" />
        </svg>
        `;

        const imagePath = path.resolve(`temp_ssl_summary_${uuidv4()}.png`);

        // Convert SVG to PNG
        console.log(`[MODULE-SSL] Saving summary image to ${imagePath}...`);
        await sharp(Buffer.from(svgContent))
            .png()
            .toFile(imagePath);

        console.log('[MODULE-SSL] Uploading summary to Cloudinary...');
        const cloudRes = await uploadToCloudinary(imagePath, `audit-results/ssl-${auditId}`);

        console.log(`[MODULE-SSL] Cloudinary Response:`, cloudRes);

        result.capture = cloudRes;
        result.statut = 'SUCCESS';
        result.grade = bestGrade;

        // Cleanup
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    } catch (e) {
        console.error('[MODULE-SSL] FATAL:', e.message);
        result.statut = 'FAILED';
    }

    return result;
}
