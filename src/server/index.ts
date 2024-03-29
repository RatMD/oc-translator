import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import Localizer from './lib/localizer';

// Server Configuration
const options: any = { value: null };
const config: { [key: string]: any } = { 
    mode: process.argv[1].includes(`${path.sep}src${path.sep}server${path.sep}`) ? 'dev' : 'prod',
    port: 3005
};

// Parse Arguments
const args: string[] = process.argv.slice(2) ?? [];
while (args.length > 0) {
    let key = (args as any).shift().trim();
    if (!key.startsWith('-')) {
        continue;
    }

    let val: string|boolean = true;
    if (key.startsWith('--')) {
        key = key.slice(2);
        [key, val] = key.split('=');
    } else {
        key = key.slice(1);
        if (args.length > 0 && !args[0].startsWith('-')) {
            val = args.shift() as string;
        }
    }

    config[key] = val;
}
Object.freeze(config);

/**
 * Resolve root directory path
 * @param {string} dirname 
 */
function rootPath(pathname: string = '/') {
    let publicPath = path.resolve(process.cwd());
    return path.join(publicPath, pathname);
}

/**
 * Resolve public directory path
 * @param {string} pathname
 */
function publicPath(pathname: string = '/') {
    if (config.mode === 'dev') {
        let publicPath = path.resolve(process.cwd(), 'src/client');
        return path.join(publicPath, pathname);
    } else {
        let executePath = process.argv[1];
        if (executePath.endsWith(`bin${path.sep}translator.js`)) {
            executePath = path.join(path.dirname(path.dirname(executePath)), 'dist');
        } else {
            executePath = path.dirname(executePath);
        }

        let publicPath = path.resolve(executePath, 'public');
        return path.join(publicPath, pathname);
    }
}

// Create fastify server
const fastify = Fastify({
    logger: {
        transport: {
            target: '@fastify/one-line-logger'
        }
    }
});

// Set no-cache Hook
fastify.addHook('onRequest', (request, reply, done) => {
    reply.headers({
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Expires': '0',
        'Pragma': 'no-cache',
        'Surrogate-Control': 'no-store',
        'X-Powered-By': 'OCTranslator @ fastify',
    });
    done();
});

// Set Localizer
fastify.decorate('localizer', async () => {
    if (Localizer.hasInstance()) {
        return Localizer.getInstance();
    } else {
        const localizer = new Localizer(options.value);
        await localizer.readLocales();
        await localizer.readSources();
        return localizer;
    }
})

// Register Static-File plugin
if (config.mode != 'dev') {
    fastify.register(fastifyStatic, {
        root: publicPath('/'),
        prefix: '/'
    });
}

// Home Route
fastify.get('/', async (request, reply) => {
    let file = path.resolve(publicPath('index.html'));
    let content = (await fs.promises.readFile(file)).toString();
    content = content.replace(/{{ NAME }}/g, options.value.theme.name);
    content = content.replace(/{{ LOGO }}/g, '/assets/logo');

    reply.status(200).type('text/html').send(content);
});

fastify.get('/assets/logo', async (request, reply) => {
    const logoPath = path.resolve(process.cwd(), options.value.theme.logo);
    if (!fs.existsSync(logoPath)) {
        reply.status(404);
    } else {
        const mimes: any = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
        };
        const extension = path.extname(logoPath).toLowerCase();

        const logo = fs.readFileSync(logoPath);
        reply.status(200).type(mimes[extension] as string).send(logo);
    }
});

// GET known locales
fastify.get('/locales', async (request, reply) => {
    try {
        const localizer = await (fastify as any).localizer();
        reply.status(200).send({ status: 'success', result: localizer.locales });
    } catch (err) {
        console.error(err);
        reply.status(500).send({ status: 'error', message: (err as Error).message });
    }
});

// GET Dashboard translation states
fastify.get('/stats/:locale', async (request, reply) => {
    try {
        const localizer = await (fastify as any).localizer();
        const result = await localizer.stats((request as any).params.locale.toLowerCase());
        reply.status(200).send({ status: 'success', result });
    } catch (err) {
        console.error(err);
        reply.status(500).send({ status: 'error', message: (err as Error).message });
    }
});

// GET Strings
fastify.get('/strings/:locale', async (request, reply) => {
    try {
        const localizer = await (fastify as any).localizer();
        const result = await localizer.fetchStrings((request as any).params.locale.toLowerCase());
        reply.status(200).send({ status: 'success', result });
    } catch (err) {
        console.error(err);
        reply.status(500).send({ status: 'error', message: (err as Error).message });
    }
});

// POST String
fastify.post('/save/:locale/:file/:key', async (request, reply) => {
    try {
        const localizer = await (fastify as any).localizer();
        const result = await localizer.updateString(
            ((request as any).params.locale || '').toLowerCase(),
            ((request as any).params.file || ''),
            ((request as any).params.key || ''),
            request.body,
        );
        reply.status(200).send({ status: 'success', result });
    } catch (err) {
        console.error(err);
        reply.status(500).send({ status: 'error', message: (err as Error).message });
    }
});

// Run the server
async function main() {
    if (!fs.existsSync(path.join(process.cwd(), 'localizer.config.js'))) {
        throw new Error('No localizer.config.js file found in root directory.');
    }
    options.value = (await import('file:///' + path.join(process.cwd(), 'localizer.config.js'))).default;

    try {
        await fastify.listen({ port: config.port });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}
main();
