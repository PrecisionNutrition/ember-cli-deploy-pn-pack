/* jshint node: true */
'use strict';
var Promise = require('ember-cli/lib/ext/promise');

function sshToServer(username, domain) {
  return new Promise(function(resolve, reject) {
    var client = require('scp2');

    var options = {
      host: domain,
      username: username,
      path: '/home/'+ username + '/eternal-sledgehammer/shared/.env',
    };

    if (process.env.SSH_AUTH_SOCK) {
      options.agent = process.env.SSH_AUTH_SOCK;
    } else {
      options.privateKey = require('fs').readFileSync('/home/' + process.env.USER + '/.ssh/id_rsa');
    }

    var copy = client.scp(options, '.env.remote', function(result) {
      if (result === null) {
        resolve();
      } else {
        reject(result);
      }
    });
  });
}

module.exports = {
  name: 'ember-cli-deploy-pn-pack',
  getConfiguration: function(prefix, appName, deployTarget, pluginPackConfig) {
    var ENV = {};
    ENV.build = {};

    if (deployTarget === 'development-postbuild') {
      ENV.plugins = ['redis'];
      ENV.build = {
        environment: 'development'
      };
      ENV.redis = {
        revisionKey: '__development__',
        keyPrefix: prefix,
        allowOverwrite: true,
        host: 'localhost',
        port: 6379,
        distDir: function(context) {
          return context.commandOptions.buildDir;
        }
      };
      return ENV;

    } else {

      if (!pluginPackConfig.isValidTarget(deployTarget)) {
        throw new Error('Invalid deployTarget ' + deployTarget);
      }

      var domain = pluginPackConfig.domain(deployTarget);
      var username = pluginPackConfig.SSH_USERNAME;

      return sshToServer(username, domain).then(function() {
        require('dotenv').load({path: '.env.remote'});
      }).then(function() {
        ENV.build = {
          environment: pluginPackConfig.isProduction(deployTarget) ? 'production' : 'staging'
        };

        ENV['ssh-tunnel'] = {
          username: pluginPackConfig.SSH_USERNAME,
          host: domain
        };

        ENV["revision-data"] = {
          type: 'git-commit',
        };

        ENV.redis = {
          allowOverwrite: true,
          host: 'localhost',
          keyPrefix: prefix
        };

        ENV.s3 = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          bucket: process.env.AWS_ASSET_BUCKET,
          region: process.env.AWS_DEPLOYMENT_REGION,
          prefix: prefix
        };

        ENV.slack = {
          webhookURL: process.env.SLACK_DEPLOY_WEBHOOK_ENDPOINT,
          didDeploy: function(context) {
            return function(slack){
              var message;
              var revisionKey = context.revisionData.revisionKey;
              if (revisionKey && !context.revisionData.activatedRevisionKey) {
                message = "Deployed " + appName + " to " + process.env.DEPLOY_TARGET + " but did not activate it.\n"
                + "Preview: https://" + domain + "/" + prefix.replace(/-app/,'') + "?index_key=" + revisionKey + "\n"
                + "Activate: `ember deploy:activate " + process.env.DEPLOY_TARGET + ' --revision='+ revisionKey + "`\n";
              } else {
                message = 'Deployed and activated ' + appName + ' to ' + process.env.DEPLOY_TARGET + ' (revision ' + revisionKey + ')';
              }
              return slack.notify(message);
            };
          },
          didActivate: function(context) {
            if (context.commandOptions.revision) {
              return function(slack){
                var message = "Activated " + appName + " revision on " + process.env.DEPLOY_TARGET + ": " + context.revisionData.activatedRevisionKey + "\n";
                return slack.notify(message);
              };
            }
          }
        };

        ENV.redis.didDeployMessage = function(context) {
          if (context.revisionData.revisionKey && !context.revisionData.activatedRevisionKey) {
            var revisionKey = context.revisionData.revisionKey;
            return "Deployed but did not activate revision " + revisionKey + ".\n"
            + "Preview: https://" + domain + "/" + prefix.replace(/-app/,'') + "?index_key=" + revisionKey + "\n"
            + "To activate:\n"
            + "ember deploy:activate " + process.env.DEPLOY_TARGET + ' --revision='+ revisionKey + "\n";
          }
        };

        return ENV;
      });
    }
  }
};
