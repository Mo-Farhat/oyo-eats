import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

const config = loadConfig();
const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
app.set('trust proxy', config.trustProxy);
// The phone app doesn't need CORS; the Expo web preview does, in development only.
if (config.env === 'development') app.enableCors();
// Live updates over Socket.IO, with the same development-only CORS for the web preview.
class LiveAdapter extends IoAdapter {
  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: config.env === 'development' ? { origin: true } : undefined,
    } as ServerOptions);
  }
}
app.useWebSocketAdapter(new LiveAdapter(app));
app.useGlobalFilters(new ApiErrorFilter());
app.enableShutdownHooks();
await app.listen(config.port);
