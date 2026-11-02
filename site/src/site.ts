/** Where the extension and its sources are. */
export const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=rkonit.gitcheckout';
export const GITHUB = 'https://github.com/save-workspace-as/git-checkout';

/** A path on this site, which depends on where it is served from. */
export const href = (path: string): string => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
