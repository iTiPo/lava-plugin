import { configDotenv } from 'dotenv';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

configDotenv();

const pluginDir = process.env.LAVA_PLUGIN_DIR;
if (!pluginDir) {
    console.error('LAVA_PLUGIN_DIR is required for npm run copy');
    process.exit(1);
}

const outDir = path.resolve(pluginDir);
mkdirSync(outDir, { recursive: true });
copyFileSync('manifest.json', path.join(outDir, 'manifest.json'));
copyFileSync('styles.css', path.join(outDir, 'styles.css'));
