import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
    if (process.env.RAILWAY_STATIC_URL || process.env.PORT) {
        console.error('❌ [REDIS] FATAL: REDIS_URL is missing on Railway!');
    } else {
        console.warn('⚠️ [REDIS] REDIS_URL not found, using default localhost');
    }
}

const finalRedisUrl = REDIS_URL || 'redis://localhost:6379';
console.log(`[REDIS] Initializing connection to: ${finalRedisUrl.substring(0, 15)}...`);

const redisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 50, 2000)
};

if (finalRedisUrl.startsWith('rediss://')) {
    redisOptions.tls = { rejectUnauthorized: false };
}

const connection = new IORedis(finalRedisUrl, redisOptions);

connection.on('error', (err) => {
    console.error(`❌ [REDIS ERROR] ${err.message}`);
});

export const auditQueue = new Queue('audit-jobs', {
    connection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
    }
});

console.log('BullMQ Queue initialized');
