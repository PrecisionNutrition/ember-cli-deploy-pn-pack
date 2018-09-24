module.exports = {
  description: 'Generate config for ember-cli-deploy yapp pack',
  normalizeEntityName() {
    // this prevents an error when the entityName is
    // not specified (since that doesn't actually matter
    // to us
  },

  afterInstall() {
    return this.addPackageToProject('ember-cli-deploy-pn-pack-config', '@precision-nutrition/ember-cli-deploy-pn-pack-config');
  }
};
