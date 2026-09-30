import './env'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }) // the payment webhook signature is checked against the exact bytes
  app.setGlobalPrefix('api')
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true, exposedHeaders: ['X-Total-Count'] })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(Number(process.env.PORT ?? 4000))
}
bootstrap()
