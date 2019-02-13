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

class PnConfiguration {
  constructor(prefix, appName, deployTarget, pluginPackConfig) {
    this.prefix = prefix;
    this.appName = appName;
    this.deployTarget = deployTarget;
    this.pluginPackConfig = pluginPackConfig;
    this.ENV = {};
  }

  async getConfig() {
    if (this.deployTarget === 'development-postbuild') {
      return this.getDevConfig();
    } else {
      return this.getStandardConfig();
    }
  }

  async getDevConfig() {
    this.ENV.plugins = ['redis'];

    this.ENV.build = {
      environment: 'development'
    };

    this.ENV.redis = {
      revisionKey: '__development__',
      keyPrefix: this.prefix,
      allowOverwrite: true,
      maxRecentUploads: 100,
      host: 'localhost',
      port: 6379,
      distDir(context) {
        return context.commandOptions.buildDir;
      }
    };

    return this.ENV;
  }

  async getStandardConfig() {
    this.ENV.plugins = ['ssh-tunnel', 'build', 'gzip', 'revision-data', 'manifest', 's3:s3-all', 's3:s3-source-maps', 'redis', 'display-revisions', 'slack', 'sentry'];

    let domain = this.pluginPackConfig.domain(this.deployTarget);
    let username = this.pluginPackConfig.SSH_USERNAME;
    let bastionHost = this.pluginPackConfig.bastionHost(this.deployTarget);

    return sshToServer(username, bastionHost || domain).then(function() {
      require('dotenv').load({path: '.env.remote'});
    }).then(() => {
      this.accessKeyId = process.env[`AWS_ACCESS_KEY_ID`];
      this.secretAccessKey = process.env[`AWS_SECRET_ACCESS_KEY`];

      this.ENV.build = {
        environment: this.pluginPackConfig.isProduction(this.deployTarget) ? 'production' : 'staging'
      };

      if (this.deployTarget === 'aws-prod' || this.deployTarget === 'aws-qa') {
        this.ENV['ssh-tunnel'] = {
          username: this.pluginPackConfig.SSH_USERNAME,
          host: bastionHost,
          dstHost: domain,
        };
      } else {
        this.ENV['ssh-tunnel'] = {
          username: this.pluginPackConfig.SSH_USERNAME,
          host: domain,
        };
      }

      this.build();

      this.revisionData();

      this.redis();

      this.s3Assets();

      this.slack();

      this.sentry();

      return this.ENV;
    });
  }

  async getNoeConfig() {
    this.ENV.pipeline = {
      alias: {
        s3: {
          as: ['s3-all', 's3-source-maps']
        }
      },

      disabled: {
        build: false,
        gzip: false,
        'revision-data': false,
        manifest: false,
        's3-all': false,
        's3-source-maps': false,
        's3-index': false,
        'display-revisions': false,
        slack: false,
        sentry: false,
        redis: true,
        'ssh-tunnel': true,
      },
    },

    this.accessKeyId = process.env[`${this.deployTarget.toUpperCase()}_AWS_ACCESS_KEY_ID`];
    this.secretAccessKey = process.env[`${this.deployTarget.toUpperCase()}_AWS_SECRET_ACCESS_KEY`];

    this.build();

    this.revisionData();

    this.s3Index();

    this.s3Assets();

    this.slack();

    this.sentry();

    return this.ENV;
  }

  build() {
    this.ENV.build = {
      environment: this.pluginPackConfig.isProduction(this.deployTarget) ? 'production' : 'staging'
    };
  }

  revisionData() {
    this.ENV["revision-data"] = {
      type: 'git-commit',
    };
  }

  redis() {
    this.ENV.redis = {
      allowOverwrite: true,
      host: 'localhost',
      keyPrefix: this.prefix
    };
  }

  s3Index() {
    this.ENV['s3-index'] = {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      bucket: process.env.AWS_ASSET_BUCKET,
      region: process.env.AWS_DEPLOYMENT_REGION,
      prefix: `${this.deployTarget}/${this.prefix}/revisions`,
      allowOverwrite: true,
    };
  }

  s3Assets() {
    this.ENV['s3-all'] = {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      bucket: process.env.AWS_ASSET_BUCKET,
      region: process.env.AWS_DEPLOYMENT_REGION,
      prefix: `${this.deployTarget}/${this.prefix}`,
    };

    this.ENV['s3-source-maps'] = {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      bucket: process.env.AWS_ASSET_BUCKET,
      region: process.env.AWS_DEPLOYMENT_REGION,
      prefix: `${this.deployTarget}/${this.prefix}`,
      manifestPath: null,
      filePattern: `**/+(vendor|${this.prefix}).map`,
      cacheControl: 'no-cache, no-store, must-revalidate',
      expires: 0
    };
  }

  slack() {
    this.ENV.slack = {
      webhookURL: process.env.SLACK_DEPLOY_WEBHOOK_ENDPOINT,

      didDeploy(context) {
        return function(slack){
          var message;
          var revisionKey = context.revisionData.revisionKey;
          if (revisionKey && !context.revisionData.activatedRevisionKey) {
            message = "Deployed " + this.appName + " to " + process.env.DEPLOY_TARGET + " but did not activate it.\n";
          } else {
            message = `Deployed and activated ${this.appName} to ${process.env.DEPLOY_TARGET} (revision ${revisionKey})`;
          }
          return slack.notify(message);
        };
      },

      didActivate(context) {
        if (context.commandOptions.revision) {
          return function(slack){
            let message = `Activated ${this.appName} revision on ${process.env.DEPLOY_TARGET}: ${context.revisionData.activatedRevisionKey}\n`;                                                                                                                 return slack.notify(message);
          };
        }
      },
    };
  }

  sentry() {
    this.ENV.sentry = {
      // the URL or CDN your js assets are served from
      // the sentry install you're using, https://sentry.io for hosted accounts
      sentryUrl: 'https://sentry.io',
      sentryOrganizationSlug: this.pluginPackConfig.sentryOrg(this.deployTarget),
      sentryProjectSlug: this.prefix,
      publicUrl: `${process.env.EMBER_CLI_ASSET_HOST}/${this.deployTarget}/${this.prefix}`,

      sentryApiKey: process.env.SENTRY_API_KEY,
      sentryBearerApiKey: process.env.SENTRY_API_KEY,
    };
  }

}

module.exports = {
  name: require('./package').name,

  getConfiguration(prefix, appName, deployTarget, pluginPackConfig) {
    let config = new PnConfiguration(prefix, appName, deployTarget, pluginPackConfig);
    return config.getConfig();
  },

  getNoeConfiguration(prefix, appName, deployTarget, pluginPackConfig) {
    let config = new PnConfiguration(prefix, appName, deployTarget, pluginPackConfig);
    return config.getNoeConfig();
  },
};
