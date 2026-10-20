const { readClientConfig } = require('./scripts/auth-config.cjs');

module.exports = ({ config }) => ({
  ...config,
  extra: {
    memyDevelopmentAuth: readClientConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
  },
});
