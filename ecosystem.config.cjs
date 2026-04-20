const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env.production');
const envFromFile = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath))
  : {};

module.exports = {
  apps: [
    {
      name: 'lablayer-app',
      cwd: __dirname,
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        ...envFromFile,
      },
    },
  ],
};
