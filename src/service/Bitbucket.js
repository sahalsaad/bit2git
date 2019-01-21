import axios from 'axios';
import {bitbucket} from '../../config';

export default class Bitbucket {
  request;
  limit;
  projectKey;

  constructor() {
    const {baseURL, limit, projectKey, password, username} = bitbucket;
    this.limit = limit;
    this.projectKey = projectKey;

    this.request = axios.create({
      baseURL,
      auth: {username, password}
    })
  }

  reposApi = () => `/rest/api/1.0/projects/${this.projectKey}/repos`;

  prsApi = (slug) => `${this.reposApi()}/${slug}/pull-requests`;

  activitiesApi = (slug, prId) => `${this.prsApi(slug)}/${prId}/activities`;

  fetch = async (axiosConfig, start = 0) => {
    try {
      const result = await this.request(axiosConfig);
      const {values, isLastPage} = result.data;
      if (!isLastPage) {
        return {...values, ...await this.fetch(axiosConfig, start + this.limit)}
      }

      return values;
    } catch (e) {
      console.error(`[FAILED] Fetching ${axiosConfig.url} :`, e.message);
    }
  };

  fetchRepos = () => {
    return this.fetch({
      method: 'get',
      url: this.reposApi(),
      params: {
        limit: this.limit
      }
    });
  };

  fetchActivities = async (slug, prId, latestCommit) => {
    const activities = await this.fetch({
      method: 'get',
      url: this.activitiesApi(slug, prId),
      params: {
        limit: this.limit
      }
    });

    let commitId = latestCommit;
    let comments = [];
    let reScopes = [];
    activities.forEach(activity => {
      if (activity.action === 'COMMENTED' && activity.commentAction === 'ADDED') {
        comments.push({...activity, commitId});
      }

      if (activity.action === 'RESCOPED') {
        commitId = activity.previousFromHash;
        reScopes.push(activity);
      }
    });

    // const filterComment = (activity) => activity.action === 'COMMENTED' && activity.commentAction === 'ADDED';
    const flatCommentReplies = (comments) => {
      const replies = comments.map(comment=> {
        if (comment.comments.length) {
          return [...comments, ...flatCommentReplies(comment.comments)];
        }

        return comments
      });

      return [].concat.apply([], replies);
    };

    const processComment = (activity) => ({
      ...activity,
      comment: {
        ...activity.comment,
        comments: flatCommentReplies(activity.comment.comments)
      }
    });

    return {
      comments: comments.map(processComment),
      reScopes
    }
  };

  fetchPullRequests = (slug) => {
    return this.fetch({
      method: 'get',
      url: this.prsApi(slug),
      params: {
        limit: this.limit,
        state: 'ALL'
      }
    });
  };
}
