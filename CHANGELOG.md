# Changelog

## [0.12.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.11.0...git-checkout-v0.12.0) (2026-11-07)


### Features

* **branches:** filter branches to yours, active, or stale ([#83](https://github.com/save-workspace-as/git-checkout/issues/83)) ([7a49992](https://github.com/save-workspace-as/git-checkout/commit/7a4999222c78a0e2ef3042ffc31ba5b41fceb542))
* **forms:** ask for bisect, housekeeping, and stash files in one form ([#96](https://github.com/save-workspace-as/git-checkout/issues/96)) ([220fe20](https://github.com/save-workspace-as/git-checkout/commit/220fe20ddd3741cc394869cc6644cd74c36f9b55))
* **panel:** remember the last folder used in save and open dialogs ([#93](https://github.com/save-workspace-as/git-checkout/issues/93)) ([c0c1655](https://github.com/save-workspace-as/git-checkout/commit/c0c1655264ef20065fdd7843fb7961312ce510ae))
* **pull-requests:** create a stack of pull requests from one branch ([#84](https://github.com/save-workspace-as/git-checkout/issues/84)) ([195cd57](https://github.com/save-workspace-as/git-checkout/commit/195cd577b1ccb6f1a9d6846123280e5a8ef656b5))
* **pull-requests:** end a stack on GitHub ([#92](https://github.com/save-workspace-as/git-checkout/issues/92)) ([729f74a](https://github.com/save-workspace-as/git-checkout/commit/729f74a3083f12b6dde93dbf30cc20f453b01fbe))
* **pull-requests:** group pull requests by what each needs next ([#81](https://github.com/save-workspace-as/git-checkout/issues/81)) ([ea29246](https://github.com/save-workspace-as/git-checkout/commit/ea29246e01d55b604015e42a4ec78b1fcd633d3f))
* **pull-requests:** list stacks of pull requests in the sidebar ([#85](https://github.com/save-workspace-as/git-checkout/issues/85)) ([33df3be](https://github.com/save-workspace-as/git-checkout/commit/33df3be3cb2849497bce64b22736250a813e7c80))
* **pull-requests:** merge a stack through the chosen pull request ([#91](https://github.com/save-workspace-as/git-checkout/issues/91)) ([dc728b8](https://github.com/save-workspace-as/git-checkout/commit/dc728b848814a15b3f547306eb3b89bed3992855))
* **pull-requests:** move through a stack and check out a layer ([#87](https://github.com/save-workspace-as/git-checkout/issues/87)) ([b9bfa61](https://github.com/save-workspace-as/git-checkout/commit/b9bfa6149265e3dac7554198c53f744499d84196))
* **pull-requests:** push a stack in one atomic push ([#88](https://github.com/save-workspace-as/git-checkout/issues/88)) ([c7c41e7](https://github.com/save-workspace-as/git-checkout/commit/c7c41e735aab4207dce8db800e1c6b4741ab879b))
* **pull-requests:** rebase each layer of a stack onto the one below ([#89](https://github.com/save-workspace-as/git-checkout/issues/89)) ([2caeddf](https://github.com/save-workspace-as/git-checkout/commit/2caeddfd47327d84dae2cdf913ffbc0befaf228d))
* **pull-requests:** sync a stack with its pull requests ([#90](https://github.com/save-workspace-as/git-checkout/issues/90)) ([659c705](https://github.com/save-workspace-as/git-checkout/commit/659c705feae01d5c481fbad9406f995a9d020bbd))


### Bug Fixes

* **forms:** space operation forms with vertical groups ([#94](https://github.com/save-workspace-as/git-checkout/issues/94)) ([013e8d2](https://github.com/save-workspace-as/git-checkout/commit/013e8d2b5053a8213331ec2dff3ac56ee2a99029))
* **graph:** keep the checked-out branch readable in every theme ([#97](https://github.com/save-workspace-as/git-checkout/issues/97)) ([7fd6076](https://github.com/save-workspace-as/git-checkout/commit/7fd6076411440f9d3f2425d2c5ffee41f74e3ece))
* **pull-requests:** reject an empty stack title and the base branch name ([#95](https://github.com/save-workspace-as/git-checkout/issues/95)) ([3ee8c9a](https://github.com/save-workspace-as/git-checkout/commit/3ee8c9a86c1cc67a0732af7d3881659d79c4adc8))

## [0.11.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.10.0...git-checkout-v0.11.0) (2026-11-06)


### Features

* **diff:** scroll each side of a side-by-side diff on its own ([#55](https://github.com/save-workspace-as/git-checkout/issues/55)) ([6eb5ebc](https://github.com/save-workspace-as/git-checkout/commit/6eb5ebc38e368182ed6e4ebc46c605695f772f88))
* **graph:** compare a commit with HEAD, the merge base, upstream, or another ref ([#69](https://github.com/save-workspace-as/git-checkout/issues/69)) ([b183fe3](https://github.com/save-workspace-as/git-checkout/commit/b183fe343ff8147ab6e889a23836ce716264b756))
* **graph:** hide a branch and the commits only it reaches ([#57](https://github.com/save-workspace-as/git-checkout/issues/57)) ([65591cb](https://github.com/save-workspace-as/git-checkout/commit/65591cb98e7ebe40a08154dff6b486cb578eb808))
* **history:** fix up a commit and squash it into its parent ([#70](https://github.com/save-workspace-as/git-checkout/issues/70)) ([92adafb](https://github.com/save-workspace-as/git-checkout/commit/92adafb41c3063d11a3df8a8fa3d7a6aa348723a))
* **history:** split a commit by stopping the rebase with its changes unstaged ([#72](https://github.com/save-workspace-as/git-checkout/issues/72)) ([bb5061b](https://github.com/save-workspace-as/git-checkout/commit/bb5061bb8bc3c686b715ebd79e9773c7f129e136))
* **stash:** create a branch from a stash ([#73](https://github.com/save-workspace-as/git-checkout/issues/73)) ([250cd25](https://github.com/save-workspace-as/git-checkout/commit/250cd25aeed5db83481f8558ccadffae061ebb63))


### Bug Fixes

* **git:** keep other reads free while a read takes input ([#76](https://github.com/save-workspace-as/git-checkout/issues/76)) ([126cbb4](https://github.com/save-workspace-as/git-checkout/commit/126cbb438e9ccd1ab071b487d115b9159bffe36b))
* **merge:** scroll the three merge panes sideways together ([#71](https://github.com/save-workspace-as/git-checkout/issues/71)) ([18a8c2b](https://github.com/save-workspace-as/git-checkout/commit/18a8c2bb6c5b28ca30985a9c9b7c6597a851a42b))


### Performance Improvements

* **graph:** load later history in larger pages and search beside its filters ([#74](https://github.com/save-workspace-as/git-checkout/issues/74)) ([2680e90](https://github.com/save-workspace-as/git-checkout/commit/2680e90adba29794599122bafff23da0d8a2fb8e))
* **graph:** write a commit-graph file for a large repository ([#77](https://github.com/save-workspace-as/git-checkout/issues/77)) ([9ab2a33](https://github.com/save-workspace-as/git-checkout/commit/9ab2a3387c00d08de315805c0da5b00ead89fa42))

## [0.10.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.9.0...git-checkout-v0.10.0) (2026-11-04)


### Features

* **branches:** ask what to do with local changes and fast-forward when checking out ([#54](https://github.com/save-workspace-as/git-checkout/issues/54)) ([be4e33e](https://github.com/save-workspace-as/git-checkout/commit/be4e33e37d9fec42c3bd59780c7a6242be857bb9))
* **changes:** review the staged changes with AI ([#47](https://github.com/save-workspace-as/git-checkout/issues/47)) ([6768bfc](https://github.com/save-workspace-as/git-checkout/commit/6768bfcf5c91ab009821f0bbb975e045a08f98b7))
* **changes:** stage part of a new file, stash selected lines, and key shortcuts ([#44](https://github.com/save-workspace-as/git-checkout/issues/44)) ([ffca90f](https://github.com/save-workspace-as/git-checkout/commit/ffca90fba878fc26e41b15c6d8b728d3be581c02))
* **conflicts:** AI on/off setting, review before staging, and one retry ([#49](https://github.com/save-workspace-as/git-checkout/issues/49)) ([0343143](https://github.com/save-workspace-as/git-checkout/commit/0343143114434b7b1169a9b6b78d56c9dc401255))
* **conflicts:** resolve merge conflicts with AI ([#41](https://github.com/save-workspace-as/git-checkout/issues/41)) ([cdb9e51](https://github.com/save-workspace-as/git-checkout/commit/cdb9e51851c13727ab3c93e104d24a5e6310e581))
* **graph:** ask which branch when a commit has several ([#50](https://github.com/save-workspace-as/git-checkout/issues/50)) ([c0308ca](https://github.com/save-workspace-as/git-checkout/commit/c0308caa89d54e709da3b782b62220df2dbf888f))
* **graph:** dim commits outside the checked-out branch and bold its label ([#51](https://github.com/save-workspace-as/git-checkout/issues/51)) ([169e6c4](https://github.com/save-workspace-as/git-checkout/commit/169e6c4fd710f8e98e4262fc17430616d611136e))
* **graph:** stream commit search from a single git log ([#40](https://github.com/save-workspace-as/git-checkout/issues/40)) ([89ef245](https://github.com/save-workspace-as/git-checkout/commit/89ef2455eee7b6827812679d83ce40c0ce12dfa6))
* **history:** explain a commit with AI ([#46](https://github.com/save-workspace-as/git-checkout/issues/46)) ([4758087](https://github.com/save-workspace-as/git-checkout/commit/4758087f7c62e3337c20b0b5e522089f758e8465))
* **pull-requests:** open a pull request with an AI-written description ([#45](https://github.com/save-workspace-as/git-checkout/issues/45)) ([9f08e99](https://github.com/save-workspace-as/git-checkout/commit/9f08e995c025b85c240c3748485745aa90f72f3c))


### Bug Fixes

* **diff:** use the editor's line height, tab width and font features in code views ([#52](https://github.com/save-workspace-as/git-checkout/issues/52)) ([5ca2b1f](https://github.com/save-workspace-as/git-checkout/commit/5ca2b1fd321031a9ae21e1123aa69f2ac49b30c6))

## [0.9.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.8.0...git-checkout-v0.9.0) (2026-11-03)


### Features

* **perf:** refresh only the views that are on screen ([#36](https://github.com/save-workspace-as/git-checkout/issues/36)) ([964c54b](https://github.com/save-workspace-as/git-checkout/commit/964c54bd7d94a46f6644c122ed31781d279b4f7a))
* **selection:** implement pickFromSelection function and integrate with NativeFileList ([#38](https://github.com/save-workspace-as/git-checkout/issues/38)) ([7524925](https://github.com/save-workspace-as/git-checkout/commit/75249258fb16401f16c45a38cda650c6f41c96c4))

## [0.8.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.7.0...git-checkout-v0.8.0) (2026-11-02)


### Features

* implement concurrent fetch and status updates for improved performance ([#33](https://github.com/save-workspace-as/git-checkout/issues/33)) ([52f2de3](https://github.com/save-workspace-as/git-checkout/commit/52f2de35163bfee973313796f4b09a7c16ad7e1c))
* initialize site with Astro framework and essential components ([#31](https://github.com/save-workspace-as/git-checkout/issues/31)) ([14ecffe](https://github.com/save-workspace-as/git-checkout/commit/14ecffe7c00a62fe5223fd64856e6d0d5533f1f2))


### Bug Fixes

* **changes:** update changes titles logic and improve documentation ([#34](https://github.com/save-workspace-as/git-checkout/issues/34)) ([659ed33](https://github.com/save-workspace-as/git-checkout/commit/659ed337f175706d6afaca5e0b34c431c9d763da))

## [0.7.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.6.0...git-checkout-v0.7.0) (2026-11-02)


### Features

* implement concurrent fetch and status updates for improved performance ([#33](https://github.com/save-workspace-as/git-checkout/issues/33)) ([52f2de3](https://github.com/save-workspace-as/git-checkout/commit/52f2de35163bfee973313796f4b09a7c16ad7e1c))
* initialize site with Astro framework and essential components ([#31](https://github.com/save-workspace-as/git-checkout/issues/31)) ([14ecffe](https://github.com/save-workspace-as/git-checkout/commit/14ecffe7c00a62fe5223fd64856e6d0d5533f1f2))
* **pr:** add pull request management features ([#26](https://github.com/save-workspace-as/git-checkout/issues/26)) ([200922a](https://github.com/save-workspace-as/git-checkout/commit/200922ac006ea2822a22e00005360b8e3562ccf7))
* **screenshots:** enhance Git Checkout functionality and documentation ([#30](https://github.com/save-workspace-as/git-checkout/issues/30)) ([66e63c0](https://github.com/save-workspace-as/git-checkout/commit/66e63c07906dd5a92f9e4208aeef3b84eca48aa8))

## [0.6.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.5.0...git-checkout-v0.6.0) (2026-10-30)


### Features

* Add GitHub link functionalities and remote management ([#25](https://github.com/save-workspace-as/git-checkout/issues/25)) ([616dead](https://github.com/save-workspace-as/git-checkout/commit/616dead0ce3b4c1203761d7a6f206409c52a666b))
* **blame:** add autolink support for GitHub links and enhance blame functionality ([#24](https://github.com/save-workspace-as/git-checkout/issues/24)) ([975ac99](https://github.com/save-workspace-as/git-checkout/commit/975ac99c3d42ab55fbc1e852996fc3e7642c7a6c))
* **blame:** implement line blame hover functionality with markdown support ([#21](https://github.com/save-workspace-as/git-checkout/issues/21)) ([85d1c42](https://github.com/save-workspace-as/git-checkout/commit/85d1c42a2a4314f5d4ae310b589940c200953180))
* **edit-commit:** implement edit commit message functionality with validation and history preservation ([#23](https://github.com/save-workspace-as/git-checkout/issues/23)) ([2b51749](https://github.com/save-workspace-as/git-checkout/commit/2b51749f01c4d0ea1080258380fbaf5b46340e11))

## [0.5.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.4.0...git-checkout-v0.5.0) (2026-10-30)


### Features

* add merge_group trigger to CI workflow ([#13](https://github.com/save-workspace-as/git-checkout/issues/13)) ([e93beab](https://github.com/save-workspace-as/git-checkout/commit/e93beabc8816a294e5bae57d0550a7504af8fce7))
* add screenshots to README for enhanced documentation ([#11](https://github.com/save-workspace-as/git-checkout/issues/11)) ([99fa8bc](https://github.com/save-workspace-as/git-checkout/commit/99fa8bcc3ab78c22654527876ae877dd0eec5d35))
* **changes:** add selection actions for staging and discarding lines in diff view ([#18](https://github.com/save-workspace-as/git-checkout/issues/18)) ([f2abdd7](https://github.com/save-workspace-as/git-checkout/commit/f2abdd79f351b647a59829140e13d76d5ac380df))
* **conflicts:** implement merge view for handling file conflicts ([#19](https://github.com/save-workspace-as/git-checkout/issues/19)) ([7d7d4ad](https://github.com/save-workspace-as/git-checkout/commit/7d7d4ad27adc75a193496460b387212417ca459a))
* enhance commit message placeholders to include branch information and shortcuts ([#16](https://github.com/save-workspace-as/git-checkout/issues/16)) ([0896bc7](https://github.com/save-workspace-as/git-checkout/commit/0896bc712a4fc2caa88039fca850db010f957e67))
* enhance non-text diff handling and search suggestions ([#20](https://github.com/save-workspace-as/git-checkout/issues/20)) ([88c7620](https://github.com/save-workspace-as/git-checkout/commit/88c7620cf3bfb37acc9801e4a33f6cc7c221bfbe))
* **patch:** add create patch functionality and related UI updates ([#14](https://github.com/save-workspace-as/git-checkout/issues/14)) ([6661290](https://github.com/save-workspace-as/git-checkout/commit/6661290d322488d7c1ab98ad859b87c1062fbf32))
* **search:** add regex search functionality to commit graph and related UI updates ([#17](https://github.com/save-workspace-as/git-checkout/issues/17)) ([cd211da](https://github.com/save-workspace-as/git-checkout/commit/cd211dadebf7069fbbf12de7709a65ab67e2119e))
* **undo:** add undo functionality for last Git operation ([#15](https://github.com/save-workspace-as/git-checkout/issues/15)) ([08ca03d](https://github.com/save-workspace-as/git-checkout/commit/08ca03df135d2e09a8ae4e7a53868a476b85119d))

## [0.4.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.3.0...git-checkout-v0.4.0) (2026-10-28)


### Features

* add image preview functionality in commit tree ([#8](https://github.com/save-workspace-as/git-checkout/issues/8)) ([90aa7ab](https://github.com/save-workspace-as/git-checkout/commit/90aa7ab54539ff73a6e850f37821464cb74931ee))
* **patch:** implement apply patch functionality with form support ([#10](https://github.com/save-workspace-as/git-checkout/issues/10)) ([1e64633](https://github.com/save-workspace-as/git-checkout/commit/1e64633cdf67255e71313b5aae7e8c0dc0cec011))

## [0.3.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.2.0...git-checkout-v0.3.0) (2026-10-27)


### Features

* rename extension and related paths to 'gitcheckout' ([#5](https://github.com/save-workspace-as/git-checkout/issues/5)) ([385d87c](https://github.com/save-workspace-as/git-checkout/commit/385d87cb07da248eb32f47debbecbd06da18f507))

## [0.2.0](https://github.com/save-workspace-as/git-checkout/compare/git-checkout-v0.1.0...git-checkout-v0.2.0) (2026-10-27)


### Features

* **changes:** add 'Commit and push' option in changes view ([#2](https://github.com/save-workspace-as/git-checkout/issues/2)) ([bb6f018](https://github.com/save-workspace-as/git-checkout/commit/bb6f0189d6326f475bf09e532429d0303a3c1a75))

## Changelog
