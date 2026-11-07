const { readWebStagingConfig } = require('./scripts/web-staging-config.cjs');
const { readStagingConfig } = require('./scripts/staging-config.cjs');
const { readClientConfig } = require('./scripts/auth-config.cjs');
const { readApiConfig } = require('./scripts/api-config.cjs');
const { readRealAiConfig } = require('./scripts/real-ai-config.cjs');

module.exports = ({ config }) => {
  const webStaging = readWebStagingConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE);
  if (process.env.MEMY_MOBILE_AUTH_MODE === 'web-staging' && !webStaging) throw new Error('Approved web staging client configuration is required.');
  const staging = readStagingConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE);
  if (process.env.MEMY_MOBILE_AUTH_MODE === 'staging' && !staging) throw new Error('Approved staging client configuration is required.');
  const preview = process.env.MEMY_MOBILE_STORY_PREVIEW === '1' && process.env.MEMY_MOBILE_AUTH_MODE === 'verification';
  const realAi = readRealAiConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE);
  const realRequested = process.env.MEMY_MOBILE_AUTH_MODE === 'development' &&
    (process.env.MEMY_MOBILE_REAL_AI === '1' || realAi.enabled);
  return {
    ...config,
    ...(webStaging ? { platforms: ['web'], web: { ...config.web, output: 'single', name: 'Memy', lang: 'en', themeColor: '#345b46', backgroundColor: '#f7f4eb' } } : {}),
    // Change only the display name; retain slug, scheme and application storage keys.
    name: preview ? `${config.name} (Sample Stories)` : config.name,
    extra: {
      memyDevelopmentAuth: readClientConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
      memyDevelopmentApi: realRequested ? realAi.enabled ? { enabled: true, baseUrl: realAi.baseUrl } : { enabled: false }
        : readApiConfig(__dirname, process.env.MEMY_MOBILE_AUTH_MODE),
      ...(realRequested ? { memyRealAiRequested: true } : {}),
      ...(realAi.enabled ? { memyRealAiApi: realAi } : {}),
      memyStoryPreviewEnabled: preview,
      ...(webStaging ? {
        memyWebStaging: { webOrigin: webStaging.webOrigin, apiOrigin: webStaging.apiOrigin },
        memyStagingApiOrigin: webStaging.apiOrigin,
        memyDevelopmentAuth: { enabled: true, supabaseUrl: webStaging.supabaseUrl, publishableKey: webStaging.publishableKey },
        memyDevelopmentApi: { enabled: true, baseUrl: webStaging.apiOrigin },
        memyRealAiApi: { enabled: true, baseUrl: webStaging.apiOrigin, apiContract: 'real-v2' },
        memyRealAiRequested: true,
      } : {}),
      ...(staging ? {
        memyStagingApiOrigin: staging.apiOrigin,
        memyDevelopmentAuth: { enabled: true, supabaseUrl: staging.supabaseUrl, publishableKey: staging.publishableKey },
        memyDevelopmentApi: { enabled: true, baseUrl: staging.apiOrigin },
        memyRealAiApi: { enabled: true, baseUrl: staging.apiOrigin, apiContract: 'real-v2' },
        memyRealAiRequested: true,
      } : {}),
    },
  };
};
