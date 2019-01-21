import Octokit from '@octokit/rest';
import parse from 'parse-diff';
import {bitbucket, github} from '../../config';

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

  findLinePosition = async (number, {path, line, lineType}) => {
    if (lineType === 'CONTEXT') {
      return line;
    }
    const diffResult = await this.octokit.pulls.get({
      owner: github.username,
      repo: this.repoName,
      number,
      headers: {
        accept: 'application/vnd.github.v3.diff'
      }
    });
    const parsed = parse(diffResult.data);
    const fileDiff = parsed.find(file => file.to === path);
    const changes = [].concat.apply([], fileDiff.chunks.map(chunk => chunk.changes));
    return changes.findIndex(change => change.ln === line && change.type === 'add') + fileDiff.chunks.length;
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
      console.error(`[FAILED] Importing ${repoName} to github with error:`, e);
      throw e;
    }
  };

  importPr = async ({toRef, fromRef, title, id, activities}) => {
    // check import status.

    const initCommit = this.getInitialPrCommit(fromRef.latestCommit, activities.reScopes);

    // Create ref for pull request
    // await this.createRef(fromRef.id, initCommit);
    // await this.createRef(toRef.id + id, toRef.latestCommit);

    // Create pull request
    // const {data: {number: prId}} = await this.createPr(repoName, title, fromRef.displayId, toRef.displayId + id);
    return {
      id: 2,
      initCommit: initCommit
    };
    // Update ref to keep the outdated commit in pr
    // if (activities.res.length !== 0) {
    //   for (const reScope of activities.reScopes.reverse()) {
    //     if (reScope.fromHash !== startSha) {
    //       await this.octokit.git.updateRef({
    //         owner: github.username,
    //         repo: this.repoName,
    //         ref: fromRef.id.replace('refs/', ''),
    //         sha: reScope.fromHash,
    //         force: true
    //       })
    //     }
    //   }
    // }

    // console.log('##### number', number);
  };

  importPrActivities = async (prContext, {activities}) => {
    const {id, initCommit} = prContext;

    for (const activity of activities.comments.reverse()) {
      try {
        const {user, comment, commentAnchor, commitId} = activity;
        if (commentAnchor && commitId === initCommit) {
          const position = await this.findLinePosition(id, commentAnchor);
          const {id: commentId} = await this.octokit.pulls.createComment({
            owner: github.username,
            repo: this.repoName,
            number: id,
            body: `@${user.name}: ${comment.text}`,
            commit_id: commitId,
            path: commentAnchor.path,
            position
          });
        }
        // else {
        // const {id: commentId} = await this.octokit.issues.createComment({
        //   owner: github.username,
        //   repo: this.repoName,
        //   number,
        //   body: `@${user.name}: ${comment.text}`
        // });
        //
        // replyTo = commentId;
        // }
      } catch (e) {
        console.error(`[FAILED] Importing activities to github with error:`, e.errors[0].message ? e.errors[0].message : e);
      }
    }
    // if (comment.comments.length) {
    //   comment.comments.map(async commentReplies => {
    //     await this.octokit.pulls.createCommentReply({
    //       owner: github.username,
    //       repo: this.repoName,
    //       number,
    //       body: `@${commentReplies.user.name}: ${commentReplies.comment.text}`,
    //       in_reply_to: replyTo
    //     })
    //   })
    // }
  }
}
