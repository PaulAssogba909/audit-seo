import { v2 as cloudinary } from 'cloudinary';

const ensureConfig = () => {
    const config = {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    };

    if (!config.cloud_name || !config.api_key || !config.api_secret) {
        console.error('[CLOUDINARY] MISSING CREDENTIALS! cloud_name:', !!config.cloud_name, 'key:', !!config.api_key);
        throw new Error('Cloudinary credentials are not configured in environment variables');
    }

    // Only update if not already set correctly or forced
    const current = cloudinary.config();
    if (!current.cloud_name || !current.api_key) {
        console.log('[CLOUDINARY] Applying configuration...');
        cloudinary.config(config);
    }
};

export async function uploadToCloudinary(filePath, folder = 'audits') {
    ensureConfig();
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: folder
        });
        return result.secure_url;
    } catch (err) {
        console.error('[CLOUDINARY] Upload error:', err);
        throw err;
    }
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

export async function uploadBufferToCloudinary(buffer, fileName, folder = 'audits') {
    ensureConfig();
    const tempDir = os.tmpdir();
    const tempPath = path.join(tempDir, `${uuidv4()}-${fileName}`);

    try {
        console.log(`[CLOUDINARY] Writing buffer to temp file: ${tempPath}`);
        fs.writeFileSync(tempPath, buffer);

        console.log(`[CLOUDINARY] Uploading temp file to folder: ${folder}`);
        const result = await cloudinary.uploader.upload(tempPath, {
            folder: folder,
            public_id: fileName.split('.')[0]
        });

        console.log(`[CLOUDINARY] Upload SUCCESS: ${result.secure_url}`);
        return result.secure_url;
    } catch (err) {
        console.error('[CLOUDINARY] Buffer upload ERROR:', err);
        throw err;
    } finally {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
                console.log(`[CLOUDINARY] Cleaned up temp file: ${tempPath}`);
            }
        } catch (e) {
            console.error('[CLOUDINARY] Cleanup ERROR:', e.message);
        }
    }
}
