const { readClientConfig } = require('./scripts/auth-config.cjs');
const { readApiConfig } = require('./scripts/api-config.cjs');

module.exports = ({ config }) => {
  const preview = process.env.MEMY_MOBILE_STORY_PREVIEW === '1' && process.env.MEMY_MOBILE_AUTH_MODE === 'verification';
  return {
    ...config,
    // Change only the display name; retain slug, scheme and application storage keys.
    name: preview ? `${config.name} (Sample Stories)` : config.name,
    extra: {
      memyDevelopmentAuth: readClientConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
      memyDevelopmentApi: readApiConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
      memyStoryPreviewEnabled: preview,
    },
  };
};
