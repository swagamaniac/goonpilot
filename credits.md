# Credits

Goonpilot is my own code, but it didn't come out of nowhere. These projects shaped it.

## kurosearch
This is where it started. I began by forking kurosearch, and a lot of how I think about browsing a booru comes from it: tag search that stays out of the way, saved searches and supertags, and grouping the `~` (OR) tags you add into one group. Goonpilot grew out of that into its own thing.

https://github.com/kurozenzen/kurosearch

## BooruRamen
https://github.com/SoupDevs/BooruRamen (GPL-3.0)

The "For you" feed is modelled on BooruRamen. It showed me that a recommender for a booru can run entirely on your own machine, with no account and no server. Ideas I took from it:
- weighting tags by type (character, artist, series, general) when learning what you like
- ignoring tags that are too common to say anything about taste
- searching in several different ways and learning which ones work for you
- shaping what you see with the different modes (balanced, comfort, explore)

I only took ideas. No BooruRamen code is copied; everything here is written from scratch.

## WD SwinV2 Tagger v3
https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3 (Apache-2.0), by SmilingWolf

The optional image analysis uses this model to describe pictures with tags. It is not included in this repository. It is downloaded to your own computer when you run the image analysis setup, and it never leaves it.

## Libraries
The image analysis also uses [onnxruntime-node](https://github.com/microsoft/onnxruntime) to run the model and [sharp](https://github.com/lovell/sharp) to read images. Both are optional and installed with `npm install`. Their own dependencies are all under permissive licenses (MIT, Apache-2.0, BSD, ISC), except the prebuilt libvips binaries that sharp downloads, which are LGPL-3.0-or-later. None of them are included in this repository.

## Fonts and images
Goonpilot ships no font files. The interface uses your system's own fonts and emoji. The only bundled image is the WTFPL badge (`public/img/wtfpl-badge-88x31.png`) from [wtfpl.net](http://www.wtfpl.net/), released under the WTFPL.

## The sites
Thanks to rule34.xxx, e621, e6ai and rule34.paheal.net for their public APIs.
