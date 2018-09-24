'use strict';

function sshToServer(username, domain) {
  return new Promise(function(resolve, reject) {
    const client = require('scp2');

    let options = {
      host: domain,
      username: username,
      path: `/home/${username}/eternal-sledgehammer/shared/.env`,
    };

    if (process.env.SSH_AUTH_SOCK) {
      options.agent = process.env.SSH_AUTH_SOCK;
    } else {
      options.privateKey = require('fs').readFileSync(`/home/${process.env.USER}/.ssh/id_rsa`);
    }

    client.scp(options, '.env.remote', function(result) {
      if (result === null) {
        return resolve();
      } else {
        return reject(result);
      }
    });
  });
}

module.exports = {
  name: require('./package').name,

  getConfiguration(prefix, appName, deployTarget, pluginPackConfig) {
    let ENV = {};
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
        distDir(context) {
          return context.commandOptions.buildDir;
        }
      };
      return ENV;

    } else {

      ENV.plugins = ['ssh-tunnel', 'build', 'gzip', 'revision-data', 'manifest', 's3:s3-all', 's3:s3-source-maps', 'redis', 'display-revisions', 'slack', 'sentry'];

      if (!pluginPackConfig.isValidTarget(deployTarget)) {
        throw new Error('Invalid deployTarget ' + deployTarget);
      }

      let domain = pluginPackConfig.domain(deployTarget);
      let username = pluginPackConfig.SSH_USERNAME;
      let bastionHost = pluginPackConfig.bastionHost(deployTarget);

      return sshToServer(username, bastionHost || domain).then(function() {
        require('dotenv').load({path: '.env.remote'});
      }).then(function() {
        ENV.build = {
          environment: pluginPackConfig.isProduction(deployTarget) ? 'production' : 'staging'
        };

        if (deployTarget === 'aws-prod' || deployTarget === 'aws-qa') {
          ENV['ssh-tunnel'] = {
            username: pluginPackConfig.SSH_USERNAME,
            host: bastionHost,
            dstHost: domain,
          };
        } else {
          ENV['ssh-tunnel'] = {
            username: pluginPackConfig.SSH_USERNAME,
            host: domain,
          };
        }

        ENV["revision-data"] = {
          type: 'git-commit',
        };

        ENV.redis = {
          allowOverwrite: true,
          host: 'localhost',
          keyPrefix: prefix
        };

        ENV['s3-all'] = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          bucket: process.env.AWS_ASSET_BUCKET,
          region: process.env.AWS_DEPLOYMENT_REGION,
          prefix: `${deployTarget}/${prefix}`,
        };

        ENV['s3-source-maps'] = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          bucket: process.env.AWS_ASSET_BUCKET,
          region: process.env.AWS_DEPLOYMENT_REGION,
          prefix: `${deployTarget}/${prefix}`,
          manifestPath: null,
          filePattern: `**/+(vendor|${prefix}).map`,
          cacheControl: 'no-cache, no-store, must-revalidate',
          expires: 0
        };

        ENV.slack = {
          webhookURL: process.env.SLACK_DEPLOY_WEBHOOK_ENDPOINT,

          didDeploy(context) {
            return function(slack){
              var message;
              var revisionKey = context.revisionData.revisionKey;
              if (revisionKey && !context.revisionData.activatedRevisionKey) {
                message = "Deployed " + appName + " to " + process.env.DEPLOY_TARGET + " but did not activate it.\n"
                  + "Preview: https://" + domain + "/" + prefix.replace(/-app/,'') + "?index_key=" + revisionKey + "\n"
                  + "Activate: `ember deploy:activate " + process.env.DEPLOY_TARGET + ' --revision='+ revisionKey + "`\n";
              } else {
                message = `Deployed and activated ${appName} to ${process.env.DEPLOY_TARGET} (revision ${revisionKey})`;
              }
              return slack.notify(message);
            };
          },

          didActivate(context) {
            if (context.commandOptions.revision) {
              return function(slack){
                let message = `Activated ${appName} revision on ${process.env.DEPLOY_TARGET}: ${context.revisionData.activatedRevisionKey}\n`;
                return slack.notify(message);
              };
            }
          }
        };

        ENV.redis.didDeployMessage = function(context) {
          if (context.revisionData.revisionKey && !context.revisionData.activatedRevisionKey) {
            let revisionKey = context.revisionData.revisionKey;

            return "Deployed but did not activate revision " + revisionKey + ".\n"
              + "Preview: https://" + domain + "/" + prefix.replace(/-app/,'') + "?index_key=" + revisionKey + "\n"
              + "To activate:\n"
              + "ember deploy:activate " + process.env.DEPLOY_TARGET + ' --revision='+ revisionKey + "\n";
          }
        };

        ENV.sentry = {
          // the URL or CDN your js assets are served from
          // the sentry install you're using, https://sentry.io for hosted accounts
          sentryUrl: 'https://sentry.io',
          sentryOrganizationSlug: pluginPackConfig.sentryOrg(deployTarget),
          sentryProjectSlug: prefix,
          publicUrl: `${process.env.EMBER_CLI_ASSET_HOST}/${deployTarget}/${prefix}`,

          sentryApiKey: process.env.SENTRY_API_KEY,
          sentryBearerApiKey: process.env.SENTRY_API_KEY,
        };

        return ENV;
      });
    }
  }
};
