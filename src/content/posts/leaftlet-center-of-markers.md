---
title: How to zoom in the area with markers using Leaflet.js
unlisted: true
date: 2024-09-09
---

To render a map with a lot of markers and zoom in the area with markers only;
you need use `center` property for the map but how can you find the center of
the markers?




```javascript
const center = [51.5074, -0.1278];
const zoom = 13;

const map = L.map('map').setView(center, zoom);
```
