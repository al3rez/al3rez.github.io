---
title: How to center the map on a group of markers using Leaflet.js
unlisted: false
date: 2024-09-09
---

To center the map with a lot of markers and zoom in on the area with markers,
we need to use the `center` and `bounds` properties for the map. But how can you find the center of
the markers?

Here is a simple example of how to do it:

```javascript
import React, { useMemo } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import "leaflet-defaulticon-compatibility";

const Map = ({ locations }) => {
  const { defaultCenter, bounds } = useMemo(() => {
    if (locations.length === 0) return { defaultCenter: [0, 0], bounds: null };

    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;

    locations.forEach((loc) => {
      minLat = Math.min(minLat, loc.lat);
      maxLat = Math.max(maxLat, loc.lat);
      minLng = Math.min(minLng, loc.lng);
      maxLng = Math.max(maxLng, loc.lng);
    });

    const defaultCenter = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
    const bounds = [
      [minLat, minLng],
      [maxLat, maxLng],
    ];

    return { defaultCenter, bounds };
  }, [locations]);

  return (
    <MapContainer
      center={defaultCenter}
      bounds={bounds}
      style={{ height: "400px", width: "100%", borderRadius: "10px" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={null}
      />
      {locations.map((location, index) => (
        <Marker key={index} position={[location.lat, location.lng]} color="red">
          <Popup>
            <Link
              href={`https://maps.google.com/?q=${location.lat},${location.lng}`}
            >
              Click here!
            </Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default Map;
```

Let's break down the algorithm used to calculate the `defaultCenter` and `bounds`:

```javascript
const { defaultCenter, bounds } = useMemo(() => {
  if (locations.length === 0) return { defaultCenter: [0, 0], bounds: null };

  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;

  locations.forEach((loc) => {
    minLat = Math.min(minLat, loc.lat);
    maxLat = Math.max(maxLat, loc.lat);
    minLng = Math.min(minLng, loc.lng);
    maxLng = Math.max(maxLng, loc.lng);
  });

  const defaultCenter = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  const bounds = [
    [minLat, minLng],
    [maxLat, maxLng],
  ];

  return { defaultCenter, bounds };
}, [locations]);
```

1. First, we loop through all our location markers. As we go, we're keeping track of four key values:

   - The southernmost point (minimum latitude)
   - The northernmost point (maximum latitude)
   - The westernmost point (minimum longitude)
   - The easternmost point (maximum longitude)

   It's like drawing an imaginary box around all our markers, and we're finding the edges of that box.

2. Once we've found these extremes, we use them to calculate two important things:

   a) The center point:
   We find this by taking the average of our latitude extremes and the average of our longitude extremes. It's like finding the middle of our imaginary box.

   b) The bounds:
   This is essentially our imaginary box defined as coordinates. It's represented by two points: the southwest corner (min lat, min lng) and the northeast corner (max lat, max lng).

3. We then pass these calculated values back to our Map component:
   - The `defaultCenter` is used to initially position the map view.
   - The `bounds` are used to ensure that all our markers fit within the visible area of the map.

![map with markers](/map.png)

This approach works well because it automatically adjusts the map view based on the spread of our markers. Whether they're all clustered in one city or spread across a continent, the map will always show them all!
