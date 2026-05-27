---
title: Building Handwriter, a tiny browser app for fake handwriting
unlisted: false
date: 2026-05-27
description: I built a small static browser app that turns typed text into handwritten-looking pages and exports them as PNGs.
image: /handwriter/og-image.png
---

I wanted a small tool that turns typed text into something that looks handwritten. Not a full product. Not a service. Just a page I can open, type into, and export as an image.

So I built Handwriter:

[Try Handwriter](/handwriter/)

It is plain HTML, CSS, JavaScript, a canvas, and a character set stored as JSON. No accounts. No backend. No build step for the app itself.

## The idea

A character is not treated like a font glyph. It is a small set of handwriting strokes. The app picks from available samples and draws them onto a canvas with a bit of variation, so the output does not feel like the same pasted letter repeated across the page.

The default handwriting data lives in `default-charset.json`. On load, the app fetches that file, keeps the character samples in memory, and uses canvas to draw the page.

The page is basically a canvas pretending to be paper.

## What I kept simple

I only wanted the things that matter when you open the page:

- type text
- see handwriting
- change size, line spacing, color, and style
- export a PNG

That is enough for now.

There is no editor framework. The visible page is a canvas, and a hidden textarea handles real keyboard input. When the text changes, the app redraws the page.

That sounds wasteful, but it is fine here. The page is small. Canvas is fast. The code stays boring.

## The annoying parts

Drawing strokes is the easy part.

The fussy part is making text feel like it belongs on a page. Characters need spacing. Lines need wrapping. The cursor needs to appear in the right-ish place. Export needs to match what the user sees.

None of this is impressive by itself. It is just a stack of small details, and each one is annoying when it is slightly wrong.

## Shipping it

The app is static, so deployment was simple.

I put the files under `public/handwriter` in my site repo:

```text
index.html
style.css
app.js
default-charset.json
og-image.png
Resources/
```

My site is built with Astro and deployed through Vercel. Static files in `public` are copied as-is, so the app lives at:

```text
https://al3rez.com/handwriter/
```

## The Open Graph image

The first Open Graph image I made was ugly. It looked like fake lined paper and tried too hard.

I changed it to something closer to Armin Ronacher's social images: white background, large type, a short description, and a small author mark. It is generated with a tiny Pillow script.

A share image does not need to be clever. It just needs to not embarrass me when the link shows up in a chat.

## Why I like this

Small tools are underrated. This one does not need onboarding. It does not need a pricing page. It does not need a database hiding behind a simple feature.

It just needs to load quickly and do the thing.

The app is here:

[al3rez.com/handwriter](/handwriter/)
