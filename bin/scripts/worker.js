const path = require('path');

const WORKER_TAGS = process.env.WORKER_TAGS || '';

// eslint-disable-next-line global-require, import/no-dynamic-require
const Workers = fs.readdirSync(path.join(__dirname, '../workers')).filter(a => /\.js$/i.test(a)).map(a => require(path.join(__dirname, '../workers', a)));

async function main() {
  Workers.forEach((Worker) => {
    if (!Worker.acceptsTag(WORKER_TAGS)) {
      return;
    }

    // execute workers that match configuration in process.env.WORKER_TAGS

    Worker.getInstance().run().catch(error => logger.error(`worker-${Worker.name}-error`, { error }));
  });
}

main().catch(console.error);
