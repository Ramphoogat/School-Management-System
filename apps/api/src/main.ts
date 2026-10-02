import './env'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { applySecurity, enforceSecrets } from './common/security'

async function bootstrap() {
  enforceSecrets() // in production, refuses to start with placeholder or short secrets
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }) // the payment webhook signature is checked against the exact bytes
  applySecurity(app)
  app.setGlobalPrefix('api')
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true, exposedHeaders: ['X-Total-Count'] })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(Number(process.env.PORT ?? 4000))
}
bootstrap()
