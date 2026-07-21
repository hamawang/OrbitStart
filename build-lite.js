import { execSync } from 'child_process';

process.env.VITE_APP_LITE = 'true';
execSync('npm run build', { stdio: 'inherit' });
