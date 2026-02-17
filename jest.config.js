module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js',
    '!server/db/migrations/**'
  ],
  coverageDirectory: 'coverage',
  testTimeout: 10000
};
