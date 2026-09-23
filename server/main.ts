import { DEFAULT_PORT } from '../src/net/protocol';
import { startMatchServer } from './index';

const port = Number(process.env.PORT ?? DEFAULT_PORT);

startMatchServer(port)
  .then((server) => {
    console.log(`101 match server listening on ws://localhost:${server.port}`);
    console.log('Open two local tabs with ?online=1. A later Render deploy can set PORT; N1 stays in memory.');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
