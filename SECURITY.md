# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Include the extension version, your VS Code version and operating system, and the steps to reproduce.

You can expect an acknowledgement within a few days. Fixes ship in the next release, and the advisory credits the reporter unless they prefer otherwise.

## Scope

Git Checkout runs the `git` executable on your machine, in the repositories you open. It sends no data to any server of its own. The only network requests are the ones Git makes to your remotes, and, if you allow it, avatar images from Gravatar.

## Supported versions

Only the latest release receives fixes.
