var pluginPack = require('ember-cli-deploy-pn-pack');
var pluginPackConfig = require('ember-cli-deploy-pn-pack-config');

module.exports = function(deployTarget) {
  return pluginPack.getConfiguration('[prefix]', '[humanAppName]', deployTarget, pluginPackConfig);
};
