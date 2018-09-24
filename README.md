# ember-cli-deploy-pn-pack

> An ember-cli-deploy plugin pack to implement a deployment pattern for PrecisonNutrition's Ember apps

<hr/>
**WARNING: This plugin pack is only compatible with ember-cli-deploy versions >= 0.6.0**
<hr/>

This plugin pack is prepared for internal use by PN and is open-sourced for educational
purposes but will not be supported for shared community use.

This package bundles ember-cli-deploy-lightning-pack, ember-cli-deploy-slack and ember-cli-deploy-ssh-tunnel
and a util method to minimize duplicated config code between apps.

Finally as part of the config step this build pack uses *scp* to copy the `ENV` configuration from the deployTarget server.

It also has a blueprint for your `config/deploy.js` file to get you started.

Installation
------------------------------------------------------------------------------

```
ember install ember-cli-deploy
ember install ember-cli-deploy-pn-pack
```

The necessary set of plugins will be available to ember-cli-deploy and an example `deploy/config.js` file will be generated for you to customize with information about your app.

The generated blueprint will add a requirement for `ember-cli-deploy-pn-pack-config` in `package.json`.

This is **private** npm module that exposes the basic config needed to boostrap the build process and download the remote `ENV` file.

### Dev workflow config

If you want to use the [Dev Workflow](http://ember-cli.com/ember-cli-deploy/docs/v0.5.x/development-workflow/) just add

```diff
+    emberCLIDeploy: {
+      runOnPostBuild: (env === 'development') ? 'development-postbuild' : false,
+      shouldActivate: true
+    },
```

to your `ember-cli-build.js` file.

## What is a plugin pack?

A "plugin pack" is a concept supported by ember-cli-deploy that allows a single addon to make multiple plugins available by adding a single direct depedency to your project.

## What plugins are made available?

* Via [ember-cli-deploy-lightning-pack](https://github.com/ember-cli-deploy/ember-cli-deploy-lightning-pack)
  * [ember-cli-deploy-build](https://github.com/ember-cli-deploy/ember-cli-deploy-build)
  * [ember-cli-deploy-gzip](https://github.com/ember-cli-deploy/ember-cli-deploy-gzip)
  * [ember-cli-deploy-redis](https://github.com/ember-cli-deploy/ember-cli-deploy-redis)
  * [ember-cli-deploy-s3](https://github.com/ember-cli-deploy/ember-cli-deploy-s3)
  * [ember-cli-deploy-manifest](https://github.com/ember-cli-deploy/ember-cli-deploy-manifest)
  * [ember-cli-deploy-revision-data](https://github.com/ember-cli-deploy/ember-cli-deploy-revision-data)
* [ember-cli-deploy-slack](https://github.com/ember-cli-deploy/ember-cli-deploy-slack)
* [ember-cli-deploy-ssh-tunnel](https://github.com/ember-cli-deploy/ember-cli-deploy-ssh-tunnel)

## Required api for config module

The private config module is expected to return an object with 3 methods and 1 property

```
* pluginPackConfig.isValidTarget(deployTarget)
* pluginPackConfig.domain(deployTarget)
* pluginPackConfig.isProduction(deployTarget)
* pluginPackConfig.SSH_USERNAME
```

## Credits

This pack is heavily inspired by [Yapp's plugin pack](https://github.com/yappbox/ember-cli-deploy-yapp-pack)
thanks [@lukemelia](https://github.com/lukemelia) and team for doing the hard work :)
