const { readClientConfig } = require('./scripts/auth-config.cjs');
const { readApiConfig } = require('./scripts/api-config.cjs');

module.exports = ({ config }) => ({
  ...config,
  extra: {
    memyDevelopmentAuth: readClientConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
    memyDevelopmentApi: readApiConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
  },
});
