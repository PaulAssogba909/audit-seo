import OpenAI from 'openai';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

let _openai = null;

function getOpenAI() {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) {
            console.error('[OPENAI] Missing OPENAI_API_KEY in environment.');
            throw new Error('OPENAI_API_KEY is not configured.');
        }
        _openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return _openai;
}

/**
 * Analyze image with GPT-4o Vision
 * @param {string} imageInput - Public URL or local file path
 * @param {string} prompt - Vision prompt
 */
export async function analyzeImage(imageInput, prompt) {
    try {
        const client = getOpenAI();
        let finalImageUrl = imageInput;

        // Convert local path to base64 if it's not a URL
        if (!imageInput.startsWith('http')) {
            if (fs.existsSync(imageInput)) {
                const imageBuffer = fs.readFileSync(imageInput);
                const base64Image = imageBuffer.toString('base64');
                const ext = path.extname(imageInput).slice(1) || 'png';
                finalImageUrl = `data:image/${ext};base64,${base64Image}`;
            } else {
                console.warn(`[OPENAI] Image path not found, sending as-is: ${imageInput}`);
            }
        }

        const response = await client.chat.completions.create({
            model: "gpt-4o-2024-05-13",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            image_url: {
                                "url": finalImageUrl,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 500,
        });

        return response.choices[0].message.content;
    } catch (err) {
        console.error('[OPENAI] Vision analysis error:', err.message || err);
        throw err;
    }
}
