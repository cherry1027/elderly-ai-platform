const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Keep the app root explicit while retaining normal lookup inside dependencies.
// Router's own nested dependencies must remain resolvable.
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
module.exports = config;
