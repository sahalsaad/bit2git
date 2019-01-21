import Bitbucket from './service/Bitbucket';
import Github from './service/Github';

const repoName = 'server-setup';

(async () => {
  const bitBucket = new Bitbucket();

  const repos = await bitBucket.fetchRepos();
  const repoToMigrate = repos.filter(repo => repo.slug === repoName);

  repoToMigrate.map(async ({slug, links: {clone}}) => {
    const cloneLink = clone.find(link => link.href.startsWith('http')).href;

    const github = new Github(slug);
    // Import the repo to github
    // await github.import(slug, cloneLink);

    // Fetch all pull request with the activities
    const prs = await bitBucket.fetchPullRequests(slug);
    const prsWithActivities = await Promise.all(prs.filter(pr => pr.id === 3).map(async pr => {
      const activities = await bitBucket.fetchActivities(slug, pr.id, pr.fromRef.latestCommit);
      return {...pr, activities};
    }));


    prsWithActivities.map(async pr => {
      const prContext = await github.importPr(pr);
      await github.importPrActivities(prContext, pr);
    })
  })
})();
