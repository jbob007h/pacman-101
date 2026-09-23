import { DEFAULT_PORT } from '../src/net/protocol';
import { startMatchServer } from './index';

const port = Number(process.env.PORT ?? DEFAULT_PORT);

startMatchServer(port)
  .then((server) => {
    console.log(`101 match server listening on 0.0.0.0:${server.port}`);
    console.log(`Local clients use ws://localhost:${server.port}`);
    console.log('PORT is honored. GET / returns 200. The room stays in memory and clears on restart.');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
