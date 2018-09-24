const pluginPack = require('ember-cli-deploy-pn-pack');
const pluginPackConfig = require('ember-cli-deploy-pn-pack-config');

module.exports = function(deployTarget) {
  return pluginPack.getConfiguration('[prefix]', '[humanAppName]', deployTarget, pluginPackConfig);
};
