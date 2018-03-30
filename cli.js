#!/usr/bin/env node

'use strict';

const meow = require('meow');
const AWS = require('aws-sdk');
const cognitoIsp = new AWS.CognitoIdentityServiceProvider();
const bluebird = require('bluebird');
const fs = require('fs');
const sanitizeFilename = require('sanitize-filename');
const JSONStream = require('JSONStream');
const debug = require('debug')('cognito-tool');
const mkdirp = bluebird.promisify(require('mkdirp'));
const assert = require('assert');

const cli = meow(`
    Usage
      $ cognito-tool backup-users <user-pool-id> <options>  Backup all users in a single user pool
      $ cognito-tool backup-all-users <options>  Backup all users in all user pools for this account

      AWS_ACCESS_KEY_ID , AWS_SECRET_ACCESS_KEY and AWS_REGION (optional for assume role: AWS_SESSION_TOKEN)
      is specified in env variables or ~/.aws/credentials

    Options
      --dir Path to export all pools, all users to (defaults to current dir)
`);

const methods = {
    'backup-users': backupUsersCli,
    'backup-all-users': backupAllUsersCli,
};

const method = methods[cli.input[0]] || cli.showHelp();

bluebird.resolve(method.call(undefined, cli))
    .catch(err => {
        console.error(err.stack);
        process.exit(1);
    });


function backupUsersCli(cli) {
    const userPoolId = cli.input[1];
    const file = sanitizeFilename(getFilename(userPoolId));

    if (!userPoolId) {
        console.error('user-pool-id is required');
        cli.showHelp();
    }

    return backupUsers(cognitoIsp, userPoolId, file);
}

function backupAllUsersCli(cli) {
    const dir = cli.flags.dir || '.';

    return mkdirp(dir)
        .then(() => bluebird.mapSeries(listUserPools(), userPoolId => {
            const file = sanitizeFilename(getFilename(userPoolId));
            console.error(`Exporting ${userPoolId} to ${file}`);
            return backupUsers(cognitoIsp, userPoolId, file);
        }));
}

function getFilename(userPoolId) {
    return `${userPoolId}.json`;
}

function listUserPools() {
    return cognitoIsp.listUserPools({
            MaxResults: 60
        }).promise()
        .then(data => {
            assert(!data.NextToken, 'More than 60 user pools is not yet supported');
            const userPools = data.UserPools;
            debug({
                userPools
            });
            return userPools.map(p => p.Id);
        });
}

function backupUsers(cognitoIsp, userPoolId, file) {
    const writeStream = fs.createWriteStream(file);
    const stringify = JSONStream.stringify();

    stringify.pipe(writeStream);

    const params = {
        UserPoolId: userPoolId
    };
    cognitoIsp.listUsers(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else {
            data.Users.forEach(item => stringify.write(item));
        }
    });
}
