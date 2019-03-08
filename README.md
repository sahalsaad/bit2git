# Bitbucket server to github migration


## About

Script to migrate bitbucket server repository to github.
Use 100% github API for the migration.
This script will:
* Import the repo
* Import pull request by replay the PR activities

## How to use:
1. clone this repo
2. Install dependencies by running `yarn install`
3. Check `config.js` and fill the required params
4. Run `yarn start` to start the migration


## TODO:

* Support migration to organization github


