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
    this.ENV.plugins = ['ssh-tunnel', 'build', 'gzip', 'revision-data', 'manifest', 's3:s3-all', 's3:s3-source-maps', 'redis', 'display-revisions', 'slack'];

    let domain = this.pluginPackConfig.domain(this.deployTarget);
    let username = this.pluginPackConfig.SSH_USERNAME;
    let bastionHost = this.pluginPackConfig.bastionHost(this.deployTarget);

    return sshToServer(username, bastionHost || domain).then(function() {
      require('dotenv').load({path: '.env.remote'});
    }).then(() => {
      this.accessKeyId = process.env[`AWS_ACCESS_KEY_ID`];
      this.secretAccessKey = process.env[`AWS_SECRET_ACCESS_KEY`];

      this.ENV.build = {
        environment: 'production'
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

      return this.ENV;
    });
  }

  async getNoeConfig(masterBuild = false) {
    this.ENV.pipeline = {
      alias: {
        s3: {
          as: ['s3-all', 's3-source-maps']
        },
      },

      disabled: {
        build: false,
        gzip: false,
        'revision-data': false,
        manifest: false,
        's3-all': false,
        's3-source-maps': false,
        's3-index': false,
        's3-index-latest': false,
        'display-revisions': false,
        slack: false,
        redis: true,
        'ssh-tunnel': true,
      },
    }

    if (masterBuild) {
      this.ENV.pipeline.alias['s3-index'] = {
        as: ['s3-index-latest']
      }

      this.ENV.pipeline.disabled['s3-index'] = true;
      this.ENV.pipeline.disabled['s3-index-latest'] = false;
    }

    const targetPrefix = this.deployTarget.toUpperCase().replace('-', '_');

    this.accessKeyId = process.env[`${targetPrefix}_AWS_ACCESS_KEY_ID`];
    this.secretAccessKey = process.env[`${targetPrefix}_AWS_SECRET_ACCESS_KEY`];
    this.awsRegion = process.env[`${targetPrefix}_AWS_REGION`];

    if (this.pluginPackConfig.isProduction(this.deployTarget)) {
      this.environment = 'production';
      this.citadelEnvironment = 'production';
    } else {
      this.environment = 'staging';
      this.citadelEnvironment = 'cd';
    }
    this.citadelBucket = `precisionnutrition-${this.citadelEnvironment}-citadel`;

    // for compatibility with s3Index(), s3Assets()
    process.env['AWS_DEPLOYMENT_REGION'] = this.awsRegion;
    process.env['AWS_ASSET_BUCKET'] = `precisionnutrition-${this.environment}-ember-deploy`;

    await this.populateEnv();

    this.build();

    this.revisionData();

    if (masterBuild) {
      this.s3IndexLatest();
    } else {
      this.s3Index();
    }

    this.s3Assets();

    this.slack();

    return this.ENV;
  }

  async populateEnv() {
    let AWS = require('aws-sdk');

    let s3client = new AWS.S3({
        region: this.awsRegion,
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey
    });

    let keys = (process.env['DEPLOY_ENV_KEYS'] || '').split(',');
    let application_settings = JSON.parse(await this.getObjectContents(s3client, 'application_settings'));

    for (const k of keys) {
      await this.setEnvKey(k, application_settings[k]);
    }
  }

  async setEnvKey(key, value) {
    try {
      process.env[key] = value;
    } catch (err) {
      console.error(`Error loading key: ${key} (${err.message})`);
      throw err;
    }
  }

  getObjectContents(s3client, name) {
    return new Promise((resolve, reject) => {
      const params = { Bucket: this.citadelBucket, Key: `keys/${this.citadelEnvironment}/${name}` };
      s3client.getObject(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.Body.toString().trim());
        }
      });
    });
  }

  build() {
    this.ENV.build = {
      environment: 'production'
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

  s3IndexLatest() {
    this.ENV['s3-index-latest'] = {
      revisionKey: '__latest__',
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
    let appName = this.appName;
    this.ENV.slack = {
      webhookURL: process.env.SLACK_DEPLOY_WEBHOOK_ENDPOINT,

      didDeploy(context) {
        return (slack) =>{
          var message;
          var revisionKey = context.revisionData.revisionKey;
          if (revisionKey && context.revisionData.activatedRevisionKey) {
            message = `Deployed and activated ${appName} to ${process.env.DEPLOY_TARGET} (revision ${revisionKey})`;
            return slack.notify(message);
          }
        };
      },

      didActivate(context) {
        if (context.commandOptions.revision) {
          return (slack) => {
            let message = `Activated ${appName} revision on ${process.env.DEPLOY_TARGET}: ${context.revisionData.activatedRevisionKey}\n`;                                                                                                                 return slack.notify(message);
          };
        }
      },
    };
  }
}

module.exports = {
  name: require('./package').name,

  getConfiguration(prefix, appName, deployTarget, pluginPackConfig) {
    let config = new PnConfiguration(prefix, appName, deployTarget, pluginPackConfig);
    return config.getConfig();
  },

  getNoeConfiguration(prefix, appName, deployTarget, pluginPackConfig, masterBuild = false) {
    let config = new PnConfiguration(prefix, appName, deployTarget, pluginPackConfig);
    return config.getNoeConfig(masterBuild);
  },
};
