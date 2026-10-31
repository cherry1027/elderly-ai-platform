const { readClientConfig } = require('./scripts/auth-config.cjs');
const { readApiConfig } = require('./scripts/api-config.cjs');
const { readRealAiConfig } = require('./scripts/real-ai-config.cjs');

module.exports = ({ config }) => {
  const preview = process.env.MEMY_MOBILE_STORY_PREVIEW === '1' && process.env.MEMY_MOBILE_AUTH_MODE === 'verification';
  const realAi = readRealAiConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE);
  const realRequested = process.env.MEMY_MOBILE_AUTH_MODE === 'development' &&
    (process.env.MEMY_MOBILE_REAL_AI === '1' || realAi.enabled);
  return {
    ...config,
    // Change only the display name; retain slug, scheme and application storage keys.
    name: preview ? `${config.name} (Sample Stories)` : config.name,
    extra: {
      memyDevelopmentAuth: readClientConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
      memyDevelopmentApi: realRequested ? realAi.enabled ? { enabled: true, baseUrl: realAi.baseUrl } : { enabled: false }
        : readApiConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
      ...(realRequested ? { memyRealAiRequested: true } : {}),
      ...(realAi.enabled ? { memyRealAiApi: realAi } : {}),
      memyStoryPreviewEnabled: preview,
    },
  };
};
