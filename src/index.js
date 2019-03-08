import Bitbucket from './service/Bitbucket';
import Github from './service/Github';

(async () => {
  const bitBucket = new Bitbucket();

  const repos = await bitBucket.fetchRepos();

  repos.map(async ({slug, links: {clone}}) => {
    const cloneLink = clone.find(link => link.href.startsWith('http')).href;

    const github = new Github(slug);
    // Import the repo to github
    await github.importRepo(slug, cloneLink);

    // Fetch all pull request with the activities from bitbucket
    const prs = await bitBucket.fetchPullRequests(slug);
    const prsWithActivities = await Promise.all(prs.map(async pr => {
      const activities = await bitBucket.fetchActivities(slug, pr.id, pr.fromRef.latestCommit);
      return {...pr, activities};
    }));

    // Import all prs to github
    prsWithActivities.map(async pr => {
      const prContext = await github.importPr(pr);
      await github.importPrActivities(prContext, pr);
    })
  })
})();
