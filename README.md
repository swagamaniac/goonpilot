# Goonpilot

A personal booru viewer that runs on your own computer. No accounts, no cloud, and nothing to install besides Node.js 18+ (the image analysis packages are optional). Everything you like, save or change stays on your machine.

**Quick start:** on Windows, double-click `launchers\start.bat`. On macOS or Linux, run `node server.mjs`. Then open http://localhost:8787.

## More info
Everything beyond the quick start is in the **[wiki](https://github.com/swagamaniac/goonpilot/wiki)**:
- [Setup](https://github.com/swagamaniac/goonpilot/wiki/Setup): install, start, optional logins
- [Phone](https://github.com/swagamaniac/goonpilot/wiki/Phone): use it from a phone or tablet
- [Search and sorting](https://github.com/swagamaniac/goonpilot/wiki/Search-and-sorting): search syntax, OR groups, sort options, tag limits
- [Image analysis](https://github.com/swagamaniac/goonpilot/wiki/Image-analysis): optional local AI tagging
- [Favorites and data](https://github.com/swagamaniac/goonpilot/wiki/Favorites-and-data): downloads, new-post checks, where your data lives
- [Troubleshooting](https://github.com/swagamaniac/goonpilot/wiki/Troubleshooting)

## Privacy
Goonpilot has no server of its own, no accounts, no analytics and no cookies. Your likes, votes, saved searches and settings are stored only on your computer. It only talks to the booru sites you search (your search tags, plus your API key if you added one), and the browser loads images straight from them. The optional image analysis downloads its model once from Hugging Face. Details: [Privacy](https://github.com/swagamaniac/goonpilot/wiki/Privacy).

## License
[![WTFPL](public/img/wtfpl-badge-88x31.png)](http://www.wtfpl.net/)

Do what you want. See [LICENSE](LICENSE). Credits are in [credits.md](credits.md).
