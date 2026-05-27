---
title: Turning an old iOS handwriting app into a tiny web app
unlisted: false
date: 2026-05-27
description: I ported an old Text to Handwriting iOS project to a static browser app and shipped it at al3rez.com/handwriter.
image: /handwriter/og-image.png
---

I had an old iOS project sitting around called Text to Handwriting. The idea is simple: type some text, render it with a handwriting style, and export it as an image. The original app was written in Swift and used iOS document APIs. Nice for an iPhone app. Less nice if I want to send someone a link.

So I turned it into a web app:

[Try Handwriter](/handwriter/)

It is not a big SaaS thing. There is no account system, no database, no backend. It is just HTML, CSS, JavaScript, a canvas, and a default character set.

## What I kept

The useful part of the original app was the model. A character is not a font glyph. It is a little set of handwriting strokes. The app picks from available samples and draws them onto a page with a bit of variation, so the output does not look like the same pasted letter over and over.

That translated well to the browser.

The web version keeps a `default-charset.json` file with character samples. On load, the app fetches that file, stores the character data in memory, and uses canvas to draw each character. The page itself is just a canvas pretending to be paper.

## What I threw away

A lot of the iOS app did not need to come over.

The SwiftUI screens, document browser, PencilKit bits, template editor, image picker, and app lifecycle code were useful on iOS, but they would have made the web version feel heavier than it needed to be.

For this version I only wanted the part that matters when you open the page:

- type text
- see handwriting
- tweak size, line spacing, color, and style
- export a PNG

That is enough.

## The canvas part

The editor uses a hidden textarea for real keyboard input. The visible page is a canvas. When the text changes, the app clears the canvas and draws the page again.

That sounds wasteful, but for this size of app it is fine. Canvas redraws are fast enough, and the code stays simple. I would rather have boring rendering code that works than a clever partial redraw system that breaks whenever text wraps differently.

The hardest part was not drawing lines. It was making typed text feel like it belongs on a page. Characters need spacing. Lines need wrapping. The cursor needs to land somewhere sensible. Export needs to produce the same page the user sees.

None of that is hard in isolation. It is just a pile of small details.

## Shipping it

The app is static, so deployment was almost boring.

I put the files under `public/handwriter` in my site repo:

```text
index.html
style.css
app.js
default-charset.json
og-image.png
Resources/
```

My site is built with Astro and deployed through Vercel, but static files in `public` are copied as-is. That means `/public/handwriter/index.html` becomes:

```text
https://al3rez.com/handwriter/
```

I also pushed a standalone `gh-pages` branch to the existing Handwriter repo, but the clean URL is the one on my own domain.

## The Open Graph image

I first made an Open Graph image that looked like fake lined paper. It was ugly. Too much decoration, not enough taste.

I ended up copying the spirit of Armin Ronacher's generated social images: mostly white space, large type, a short description, and a small author mark. His site generates those images with Pillow. Mine is currently generated with a tiny Python script using Pillow too.

The point is not to make a poster. It just needs to look decent when someone pastes the link into a chat app.

## What I like about this kind of project

Small tools are underrated. This one does not need a launch plan. It does not need onboarding. It does not need a pricing page. It just needs to load quickly and do the thing.

I like that.

The app is here:

[al3rez.com/handwriter](/handwriter/)
