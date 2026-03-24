import { Queue } from 'bullmq';
import dotenv from 'dotenv';

dotenv.config();

// Configuration Redis identique à celle du serveur
const redisOptions = {};
if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    redisOptions.host = url.hostname;
    redisOptions.port = url.port || 6379;
    redisOptions.password = url.password;
    if (process.env.REDIS_URL.includes('rediss://')) {
        redisOptions.tls = {};
    }
} else {
    redisOptions.host = 'localhost';
    redisOptions.port = 6379;
}

const auditQueue = new Queue('audit-jobs', { connection: redisOptions });

async function clearQueue() {
    try {
        console.log('🧹 Purge de la file d\'attente Redis...');

        // Vide les jobs en attente
        await auditQueue.drain(true);
        console.log('✅ Jobs en attente (wait) purgés.');

        // Nettoie les jobs actifs, échoués et terminés
        await auditQueue.clean(0, 0, 'active');
        await auditQueue.clean(0, 0, 'completed');
        await auditQueue.clean(0, 0, 'failed');
        await auditQueue.clean(0, 0, 'wait');
        await auditQueue.clean(0, 0, 'delayed');
        console.log('✅ Tous les anciens jobs (actifs, échoués, terminés) ont été supprimés.');

        console.log('🚀 La file Redis BullMQ est totalement vide ! Les nouveaux audits passeront en premier.');
    } catch (error) {
        console.error('❌ Erreur lors de la purge :', error);
    } finally {
        process.exit(0);
    }
}

clearQueue();
