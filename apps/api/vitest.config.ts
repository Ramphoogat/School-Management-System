import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests run against a separate database so real data is never touched.
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://school:school@localhost:5432/school_test'

// The global setup runs in the main process before test.env applies, so set the URL here too.
process.env.DATABASE_URL = TEST_DB

// Each run compiles the app into its own folder (see test/run.mjs); the tests import it through the @dist alias.
const DIST = process.env.TEST_DIST_DIR ?? 'dist-test'

export default defineConfig({
  resolve: { alias: { '@dist': resolve(__dirname, DIST) } },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false, // files share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The app is loaded from the compiled dist-test/ (built by tsc in the test script, separate from dist/ so a dev server rebuilding dist/ cannot break a test run; it keeps the decorator
    // metadata NestJS injection needs) and run by plain Node, not transformed.
    server: { deps: { external: [/dist-test[^\/]*[\/]/] } },
    env: {
      DATABASE_URL: TEST_DB,
      JWT_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      WEB_ORIGIN: 'http://localhost:3000',
      NOTIFICATIONS_WORKER: 'off',
      FEE_REMINDERS: 'off',
      EMAIL_HOST: '',
      WHATSAPP_PHONE_NUMBER_ID: '',
      WHATSAPP_ACCESS_TOKEN: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      UPLOAD_DIR: '.test-uploads',
    },
  },
})
