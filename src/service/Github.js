import Octokit from '@octokit/rest';
import NodeCache from 'node-cache';
import parse from 'parse-diff';
import {bitbucket, github} from '../../config';
const cache = new NodeCache();

const NotInlineCommentException = {
  name: 'Not Inline Comment'
};

const BASE_URL = 'https://api.github.com';

export default class Github {
  octokit;
  repoName;

  constructor(repoName) {
    this.octokit = new Octokit();
    this.octokit.authenticate({
      type: 'basic',
      username: github.username,
      password: github.password
    });
    this.repoName = repoName;
  }

  createRef = (ref, sha) => {
    return this.octokit.git.createRef({
      owner: github.username,
      repo: this.repoName,
      ref,
      sha
    })
  };

  createPr = (title, head, base) => {
    return this.octokit.pulls.create({
      owner: github.username,
      repo: this.repoName,
      title,
      head,
      base
    });
  };

  getInitialPrCommit = (latestSha, reScopes) => {
    if (reScopes.length === 0) {
      return latestSha;
    }

    const [last] = reScopes.slice(-1);
    return last.previousFromHash;
  };

  getPrDiff = async (number, commitId) => {
    const cacheKey = `${this.repoName}:${number}:${commitId}`;
    const diff = cache.get(cacheKey);

    if (diff) {
      return diff;
    }

    const {data} = await this.octokit.pulls.get({
      owner: github.username,
      repo: this.repoName,
      number,
      headers: {
        accept: 'application/vnd.github.v3.diff'
      }
    });

    cache.set(cacheKey, data);
    return data;
  };

  findLinePosition = async (number, commitId, commentAnchor) => {
    if (!commentAnchor) {
      throw NotInlineCommentException
    }

    const {path, line, lineType} = commentAnchor;
    if (lineType === 'CONTEXT') {
      return line;
    }

    const diff = await this.getPrDiff(number, commitId);
    const parsed = parse(diff);
    const fileDiff = parsed.find(file => file.to === path);
    if (!fileDiff) {
      throw NotInlineCommentException;
    }

    const changes = [].concat.apply([], fileDiff.chunks.map(chunk => [{}, ...chunk.changes]));
    const index = changes.findIndex(change => change.ln === line && change.type === 'add');
    return index !== -1 ? index : 0;
  };

  import = async (url) => {
    try {
      await this.octokit.repos.createForAuthenticatedUser({
        name: this.repoName,
        private: true,
        has_issues: false,
        has_wiki: false,
        auto_init: false
      });

      await this.octokit.migrations.startImport({
        owner: github.username,
        repo: this.repoName,
        vcs_url: url,
        vcs_username: bitbucket.username,
        vcs_password: bitbucket.password
      });
    } catch (e) {
      console.error(`[FAILED] Importing ${this.repoName} to github with error:`, e);
      throw e;
    }
  };

  importPr = async ({toRef, fromRef, title, id, activities}) => {
    // check import status.

    const initCommit = this.getInitialPrCommit(fromRef.latestCommit, activities.reScopes);

    // Create ref for pull request
    await this.createRef(fromRef.id, initCommit);
    await this.createRef(toRef.id + id, toRef.latestCommit);

    // Create pull request
    const {data: {number: prId}} = await this.createPr(title, fromRef.displayId, toRef.displayId + id);

    return {
      id: prId,
      initCommit: initCommit
    };
  };

  addCommentReplies = async (prId, commentId, replies) => {
    for (const reply of replies) {
      await this.octokit.pulls.createCommentReply({
        owner: github.username,
        repo: this.repoName,
        number: prId,
        body: `@${reply.author.name}: ${reply.text}`,
        in_reply_to: commentId
      })
    }
  };

  updatePrRef = async (commitId, ref) => {
    await this.octokit.git.updateRef({
      owner: github.username,
      repo: this.repoName,
      ref,
      sha: commitId,
      force: true
    })
  };

  addPrComment = async (prId, username, comment) => {
    const {id: commentId} = await this.octokit.issues.createComment({
      owner: github.username,
      repo: this.repoName,
      number: prId,
      body: `@${username}: ${comment.text}`
    });
    if (comment.comments.length) {
      await this.addCommentReplies(id, commentId, comment.comments);
    }
  };

  importPrActivities = async (prContext, {activities, fromRef}) => {
    const {id, initCommit} = prContext;
    let currentCommit = initCommit;

    for (const activity of activities.comments.reverse()) {
      const {user, comment, commentAnchor, commitId} = activity;

      try {
        if (commitId !== currentCommit) {
          await this.updatePrRef(commitId, fromRef.id.replace('refs/', ''));
          currentCommit = commitId;
        }

        const position = await this.findLinePosition(id, commitId, commentAnchor);
        const {data: {id: commentId}} = await this.octokit.pulls.createComment({
          owner: github.username,
          repo: this.repoName,
          number: id,
          body: `@${user.name}: ${comment.text}`,
          commit_id: commitId,
          path: commentAnchor.path,
          position
        });
        if (comment.comments.length) {
          await this.addCommentReplies(id, commentId, comment.comments);
        }
      } catch (e) {
        if (e.name === NotInlineCommentException.name) {
          await this.addPrComment(id, user.name, comment);
        } else {
          console.error(`[FAILED] Importing activities to github with error:`, e);
        }
      }
    }
    if (fromRef.latestCommit !== initCommit) {
      await this.updatePrRef(fromRef.latestCommit, fromRef.id.replace('refs/', ''));
    }
  }
}
