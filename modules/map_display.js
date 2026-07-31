import { Analytics } from './analytics.js';

export const MapDisplay = {
    deckgl: null,
    lastState: null,
    isCityValidated: false,
    heatmapSettings: {
        radius: 35,
        threshold: 0.03
    },

    render(state) {
        this.lastState = state;
        if (!state.routes || state.routes.length === 0) return;

        const logs = document.getElementById('cloud-logs');
        if (logs) logs.style.display = 'none';

        this.initCityAutocomplete();
        this.initHeatmapControls();

        const saveBtn = document.getElementById('btn-cloud-save');
        if (saveBtn && !saveBtn.dataset.init) {
            saveBtn.addEventListener('click', () => this.saveToSheets(this.lastState));
            saveBtn.dataset.init = "true";
        }

        const allTrajectoryPoints = [];
        const pointFeatures = [];
        const pathFeatures = [];

        state.routes.forEach(route => {
            let coords = [];
            if (route.status === 'success' && route.geometry) {
                coords = this.decodePolyline(route.geometry);
            } else if (route.start_lon && route.start_lat && route.end_lon && route.end_lat) {
                coords = [[route.start_lon, route.start_lat], [route.end_lon, route.end_lat]];
            }

            if (coords.length > 0) {
                pathFeatures.push({ path: coords });
                const sampled = this.samplePolylinePoints(coords, 0.05);
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

        const layers = [
            new deck.TileLayer({
                id: 'base-tiles',
                data: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
                renderSubLayers: props => {
                    const { bbox: { west, south, east, north } } = props.tile;
                    return new deck.BitmapLayer(props, {
                        data: null, image: props.data,
                        bounds: [west, south, east, north]
                    });
                }
            }),
            new deck.GeoJsonLayer({
                id: 'isochrones-layer',
                data: { type: "FeatureCollection", features: isochroneFeatures },
                pickable: true, stroked: true, filled: true,
                opacity: 0.15,
                getFillColor: d => this.getIsochroneColor(d.properties.range_km),
                getLineColor: [255, 255, 255, 100],
                getLineWidth: 1
            }),
            new deck.PathLayer({
                id: 'routes-glow-layer',
                data: pathFeatures,
                getPath: d => d.path,
                getColor: [99, 102, 241, 100],
                getWidth: 6,
                widthMinPixels: 2
            }),
            new deck.HeatmapLayer({
                id: 'heatmap-layer',
                data: allTrajectoryPoints,
                getPosition: d => d.coords,
                getWeight: () => 1,
                radiusPixels: this.heatmapSettings.radius || 35,
                intensity: 1.5,
                threshold: this.heatmapSettings.threshold || 0.03,
                colorRange: [
                    [34, 197, 94, 40],
                    [241, 196, 15, 120],
                    [230, 126, 34, 180],
                    [231, 76, 60, 230],
                    [155, 89, 182, 255]
                ]
            }),
            new deck.GeoJsonLayer({
                id: 'points-layer',
                data: { type: "FeatureCollection", features: pointFeatures },
                pickable: true,
                getFillColor: d => d.properties.type === 'arrivee' ? [239, 68, 68] : [34, 197, 94],
                getPointRadius: 25,
                pointRadiusMinPixels: 4
            })
        ];

        const initialView = this.calculateInitialView(state);

        if (!this.deckgl) {
            this.deckgl = new deck.DeckGL({
                container: 'map-container',
                initialViewState: initialView,
                controller: true,
                layers: layers,
                glOptions: { preserveDrawingBuffer: true },
                getTooltip: ({object}) => {
                    if (!object) return null;
                    if (object.properties && object.properties.range_km) return `Isochrone: ${object.properties.range_km} km`;
                    if (object.properties && object.properties.type) return object.properties.type === 'arrivee' ? "Site Employeur" : "Départ Employé";
                    return null;
                }
            });
        } else {
            this.deckgl.setProps({ layers, initialViewState: initialView });
        }
    },

    initHeatmapControls() {
        if (document.getElementById('heatmap-controls')) return;

        const container = document.getElementById('map-container');
        if (!container) return;

        const controls = document.createElement('div');
        controls.id = 'heatmap-controls';
        controls.className = 'absolute top-4 right-4 bg-white/90 backdrop-blur p-4 rounded-xl shadow-lg z-[50] border border-slate-200 w-48';
        controls.innerHTML = `
            <h4 class="text-[10px] font-bold uppercase text-slate-500 mb-3 tracking-widest">Réglages Heatmap</h4>
            <div class="mb-3">
                <label class="block text-[9px] mb-1 font-bold">Rayon: <span id="val-radius">${this.heatmapSettings.radius}</span></label>
                <input type="range" id="input-radius" min="10" max="100" value="${this.heatmapSettings.radius}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
            </div>
            <div>
                <label class="block text-[9px] mb-1 font-bold">Seuil: <span id="val-threshold">${this.heatmapSettings.threshold}</span></label>
                <input type="range" id="input-threshold" min="0.01" max="0.2" step="0.01" value="${this.heatmapSettings.threshold}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
            </div>
        `;
        container.appendChild(controls);

        document.getElementById('input-radius').oninput = (e) => {
            this.heatmapSettings.radius = parseInt(e.target.value);
            document.getElementById('val-radius').innerText = this.heatmapSettings.radius;
            this.render(this.lastState);
        };
        document.getElementById('input-threshold').oninput = (e) => {
            this.heatmapSettings.threshold = parseFloat(e.target.value);
            document.getElementById('val-threshold').innerText = this.heatmapSettings.threshold;
            this.render(this.lastState);
        };
    },

    getMapImage() {
        if (!this.deckgl) return null;
        return this.deckgl.getCanvas().toDataURL('image/png');
    },

    initCityAutocomplete() {
        const input = document.getElementById('input-city');
        if (!input || input.dataset.autoinit) return;
        input.dataset.autoinit = "true";

        const suggestionContainer = document.createElement('div');
        suggestionContainer.id = 'city-suggestions';
        suggestionContainer.className = 'absolute z-[100] bg-white border border-slate-200 rounded-lg shadow-xl mt-1 w-full max-h-48 overflow-y-auto hidden';
        
        if (input.parentNode) {
            input.parentNode.style.position = 'relative';
            input.parentNode.appendChild(suggestionContainer);
        }

        let timeout;
        input.addEventListener('input', (e) => {
            this.isCityValidated = false;
            clearTimeout(timeout);
            const query = e.target.value.trim();
            
            if (query.length < 3) {
                suggestionContainer.classList.add('hidden');
                return;
            }

            timeout = setTimeout(async () => {
                try {
                    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(query)}&limit=5&countrycodes=fr`);
                    const results = await resp.json();
                    
                    suggestionContainer.innerHTML = '';
                    if (results.length > 0) {
                        suggestionContainer.classList.remove('hidden');
                        results.forEach(res => {
                            const item = document.createElement('div');
                            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer text-xs border-b border-slate-100 last:border-0 transition-colors';
                            item.innerText = res.display_name;
                            
                            item.onclick = () => {
                                const city = res.address.city || res.address.town || res.address.village || res.display_name.split(',')[0];
                                input.value = city;
                                this.isCityValidated = true;
                                suggestionContainer.classList.add('hidden');
                                input.classList.remove('border-red-500');
                                input.classList.add('border-emerald-500');
                            };
                            suggestionContainer.appendChild(item);
                        });
                    }
                } catch (err) { console.error(err); }
            }, 400);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input) suggestionContainer.classList.add('hidden');
        });
    },

    getIsochroneColor(km) {
        if (km <= 2) return [46, 204, 113];
        if (km <= 5) return [241, 196, 15];
        return [230, 126, 34];
    },

    classifyDistance(d) {
        const val = parseFloat(d);
        if (val <= 2) return '0-2 km';
        if (val <= 5) return '2-5 km';
        if (val <= 10) return '5-10 km';
        return '10+ km';
    },

    classifyTime(t) {
        const val = parseFloat(t);
        if (val <= 10) return '0-10 min';
        if (val <= 15) return '10-15 min';
        if (val <= 20) return '15-20 min';
        return '20+ min';
    },

    async saveToSheets(state) {
        const siteName = document.getElementById('input-site-name')?.value.trim();
        const cityName = document.getElementById('input-city')?.value.trim();
        const btn = document.getElementById('btn-cloud-save');

        if (!siteName || !this.isCityValidated) { 
            alert("Veuillez sélectionner une ville dans les suggestions pour valider le format."); 
            document.getElementById('input-city')?.classList.add('border-red-500');
            return; 
        }

        btn.disabled = true;
        btn.innerHTML = `<span class="animate-pulse">Export...</span>`;

        try {
            const anonymizedData = state.routes.map(r => {
                const rawDistance = r.distance_km || 0;
                const rawTime = r.duration_min || 0;
                const vaeTime = rawTime * 0.75;

                return {
                    id_anonyme: "EMP-" + String(r.id).slice(-4),
                    tranche_distance: this.classifyDistance(rawDistance),
                    tranche_temps: this.classifyTime(rawTime),
                    tranche_temps_vae: this.classifyTime(vaeTime),
                    status: r.status
                };
            });

            const payload = {
                field1: siteName,
                field2: cityName,
                field3: Papa.unparse(anonymizedData)
            };

            const url = "https://script.google.com/macros/s/AKfycbxgTYcx-62MBamAawDtt3IMgMAFCkudO49be8amsULPoeNkXiYLuh3dXK8zLd9u-hoyAA/exec";
            
            await fetch(url, { 
                method: 'POST', 
                mode: 'no-cors', 
                headers: { 'Content-Type': 'text/plain' }, 
                body: JSON.stringify(payload) 
            });

            alert("Données anonymisées transmises avec succès !");
        } catch (error) {
            console.error(error);
            alert("Erreur lors de la sauvegarde.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<span>Sauvegarder</span>`;
        }
    },

    decodePolyline(str, precision = 5) {
        if (!str) return [];
        let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, lat_c, lng_c, factor = Math.pow(10, precision);
        while (index < str.length) {
            byte = null; shift = 0; result = 0;
            do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
            lat_c = ((result & 1) ? ~(result >> 1) : (result >> 1));
            shift = result = 0;
            do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
            lng_c = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lat += lat_c; lng += lng_c;
            coordinates.push([lng / factor, lat / factor]);
        }
        return coordinates;
    },

    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const clampedA = Math.min(1, Math.max(0, a));
        return R * 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
    },

    samplePolylinePoints(coords, stepKm = 0.05) {
        const points = [];
        if (!coords || coords.length === 0) return points;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            points.push({ coords: p1 });

            const dist = this.haversineDistance(p1[1], p1[0], p2[1], p2[0]);

            if (dist > stepKm && !isNaN(dist)) {
                const steps = Math.floor(dist / stepKm);
                for (let s = 1; s <= steps; s++) {
                    const ratio = s / (steps + 1);
                    const interpLon = p1[0] + (p2[0] - p1[0]) * ratio;
                    const interpLat = p1[1] + (p2[1] - p1[1]) * ratio;
                    points.push({ coords: [interpLon, interpLat] });
                }
            }
        }
        if (coords.length > 0) {
            points.push({ coords: coords[coords.length - 1] });
        }
        return points;
    },

    calculateInitialView(state) {
        let companyLon = null;
        let companyLat = null;

        if (state && state.routes && state.routes.length > 0) {
            const first = state.routes[0];
            if (first.end_lon && first.end_lat) {
                companyLon = first.end_lon;
                companyLat = first.end_lat;
            }
        } else if (state && state.coordinates && state.coordinates.length > 0) {
            const first = state.coordinates[0];
            if (first.end_lon && first.end_lat) {
                companyLon = first.end_lon;
                companyLat = first.end_lat;
            }
        }

        if (companyLon !== null && companyLat !== null) {
            return {
                longitude: companyLon,
                latitude: companyLat,
                zoom: 12.5,
                pitch: 0,
                bearing: 0,
                transitionDuration: 1000
            };
        }

        return { longitude: 2.3522, latitude: 48.8566, zoom: 11, pitch: 0, bearing: 0 };
    }
};
