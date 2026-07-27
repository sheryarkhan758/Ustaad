import { defineConfig } from 'vitest/config';

/**
 * `NODE_ENV=test` disables the rate limiters for the suite as a whole (see
 * server/middleware/rate-limit.ts). The limiter has its own test that forces
 * them back on, so the behaviour is still covered.
 *
 * The auth secrets here are test fixtures. They are deliberately obvious
 * placeholders and never resemble a real value (NFR-4).
 */
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-jwt-secret-not-a-real-value',
      BCRYPT_COST: '10',
      COOKIE_SECURE: 'false',
      ADDRESS_ENCRYPTION_KEY:
        '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      CNIC_HASH_SALT: 'test-only-cnic-salt-not-a-real-value',
    },
    // Each file gets a fresh module registry, so the in-memory databases in
    // one suite cannot leak into another.
    isolate: true,
    /**
     * Well above the default 5 s.
     *
     * These are integration tests: each one boots the real Express app, hashes
     * passwords with bcrypt and makes a dozen HTTP round trips, and nineteen
     * files run in parallel on however many cores the machine has. Under that
     * contention a perfectly healthy test can take several seconds of wall
     * clock, and a timeout failure says nothing about the code.
     *
     * This weakens no assertion. The latency requirements — NFR-1's 500 ms
     * search and FR-9.3's 100 ms review submission — are asserted explicitly,
     * inside those tests, against a measured figure. A generous timeout is not
     * a performance budget and was never doing that job.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
