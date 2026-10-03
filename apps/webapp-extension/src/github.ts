import { Registry } from '@web-relay/core';
import type { TabContext } from '@web-relay/protocol';
export function repositoryUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://github.com') return;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo || !/^[a-z0-9-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo)) return;
    const reserved = ['settings','orgs','organizations','users','search','topics','collections','marketplace','features','enterprise','sponsors','login','signup','notifications','pulls','issues','explore','account','codespaces','new','sessions','apps'];
    if (reserved.includes(owner.toLowerCase())) return;
    return `https://github.com/${owner}/${repo}`;
  } catch { return; }
}
export function githubRegistry(context: () => TabContext | undefined, navigate: (url: string, tabId?: number) => Promise<void>) {
  const registry = new Registry('github', 'extension', context);
  registry.register({ id: 'github.open-project', title: 'Open Web Relay repository', description: 'Open the project repository in a new tab', run: async () => {
    await navigate('https://github.com/web-relay/web-relay'); return { message: 'Opened Web Relay repository.' };
  } });
  for (const [id, title, suffix] of [
    ['github.repo-home','Open current repository',''],
    ['github.repo-issues','Open repository issues','/issues'],
    ['github.repo-pulls','Open repository pull requests','/pulls'],
  ]) {
    registry.register({ id: id!, title: title!, description: 'Uses the repository in the active GitHub tab',
      when: ctx => !!ctx && !!repositoryUrl(ctx.url),
      run: async ctx => {
        await navigate(repositoryUrl(ctx!.url)! + suffix, ctx!.tabId);
        return { message: 'Navigated to the repository page.' };
      },
    });
  }
  return registry;
}
