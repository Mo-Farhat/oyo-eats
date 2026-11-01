import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
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
app.useGlobalFilters(new ApiErrorFilter());
app.enableShutdownHooks();
await app.listen(config.port);
