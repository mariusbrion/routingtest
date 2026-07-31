// ... existing code ...
        const allTrajectoryPoints = [];
        const pointFeatures = [];

        state.routes.forEach(route => {
            let coords = [];
            if (route.status === 'success' && route.geometry) {
                coords = this.decodePolyline(route.geometry);
            } else if (route.start_lon && route.start_lat && route.end_lon && route.end_lat) {
                coords = [[route.start_lon, route.start_lat], [route.end_lon, route.end_lat]];
            }

            if (coords.length > 0) {
                const sampled = this.samplePolylinePoints(coords, 0.05); // Échantillonne tous les 50 mètres
                sampled.forEach(p => allTrajectoryPoints.push(p));

                pointFeatures.push({
                    type: "Feature",
                    properties: { type: 'depart', id: route.id },
                    geometry: { type: "Point", coordinates: [route.start_lon, route.start_lat] }
                });

                pointFeatures.push({
                    type: "Feature",
                    properties: { type: 'arrivee', id: route.id },
                    geometry: { type: "Point", coordinates: [route.end_lon, route.end_lat] }
                });
            }
        });

        const isochroneFeatures = state.isochrones 
            ? [...state.isochrones].sort((a, b) => b.properties.range_km - a.properties.range_km) 
            : [];
// ... existing code ...
    getIsochroneColor(km) {
        if (km <= 2) return [46, 204, 113];
        if (km <= 5) return [241, 196, 15];
        return [230, 126, 34];
    },

    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    samplePolylinePoints(coords, stepKm = 0.05) {
        const points = [];
        if (!coords || coords.length === 0) return points;

        points.push({ coords: coords[0] });

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const dist = this.haversineDistance(p1[1], p1[0], p2[1], p2[0]);

            if (dist > stepKm) {
                const steps = Math.floor(dist / stepKm);
                for (let s = 1; s <= steps; s++) {
                    const ratio = s / (steps + 1);
                    const interpLon = p1[0] + (p2[0] - p1[0]) * ratio;
                    const interpLat = p1[1] + (p2[1] - p1[1]) * ratio;
                    points.push({ coords: [interpLon, interpLat] });
                }
            }
            points.push({ coords: p2 });
        }
        return points;
    },

    classifyDistance(d) {
// ... existing code ...
