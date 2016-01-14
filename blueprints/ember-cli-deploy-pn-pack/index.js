module.exports = {
  description: 'Generate config for ember-cli-deploy yapp pack',
  normalizeEntityName: function() {
    // this prevents an error when the entityName is
    // not specified (since that doesn't actually matter
    // to us
  },

  afterInstall: function() {
    return this.addPackageToProject('ember-cli-deploy-pn-pack-config', "git+ssh://git@github.com/PrecisionNutrition/ember-cli-deploy-pn-pack-config.git#master");
  }
};
