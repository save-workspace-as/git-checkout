/**
 * The web page of a remote: `git@github.com:octo/app.git`, `ssh://git@host:2222/octo/app.git` and
 * `https://host/octo/app.git` all give `https://host/octo/app`. Undefined for a remote that is a folder or a file URL, which
 * has no page, or for one without a host. A login in the address is never carried over, and the port of an SSH or Git
 * address is dropped because it is not the port of the website.
 */
export function remoteWebUrl(remote: string): string | undefined {
  const text = remote.trim();
  if (!text) {
    return undefined;
  }
  const scp = /^(?:[^@/\s]+@)?([^:/\s]{2,}):(?!\/\/)(.+)$/.exec(text);
  if (scp && !/^[A-Za-z]:[\\/]/.test(text)) {
    return page('https:', scp[1], '', scp[2]);
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // A folder on this machine, or text that is not an address: there is no page for it.
    return undefined;
  }
  switch (url.protocol) {
    case 'https:':
    case 'http:':
      return page(url.protocol, url.hostname, url.port ? `:${url.port}` : '', url.pathname);
    case 'ssh:':
    case 'git:':
    case 'git+ssh:':
    case 'ssh+git:':
      return page('https:', url.hostname, '', url.pathname);
    default:
      return undefined;
  }
}

function page(protocol: string, host: string, port: string, path: string): string | undefined {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!host || !clean || clean.split('/').some((part) => part === '..' || part === '.')) {
    return undefined;
  }
  return `${protocol}//${host.toLowerCase()}${port}/${clean.split('/').map((part) => encodeURIComponent(decodeURIComponentSafe(part))).join('/')}`;
}

function decodeURIComponentSafe(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    // Not an escape after all, such as a lone percent sign; it is taken as it is.
    return part;
  }
}
