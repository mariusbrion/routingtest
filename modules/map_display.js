import { Analytics } from './analytics.js';

export const MapDisplay = {
    deckgl: null,
    lastState: null,
    isCityValidated: false,
    displayMode: 'both', // 'heatmap' | 'flow' | 'both'
    
    // Dynamic distance filter (km)
    maxDistanceFilter: Infinity,
    maxDistanceLimit: 50,

    // Dynamic minimum flow filter (passages)
    minFlowFilter: 1,

    // Configurable heatmap parameters
    heatmapSettings: {
        radius: 30,
        intensity: 1.2,
        threshold: 0.03
    },

    // Configurable point parameters (Size & Visibility)
    pointSettings: {
        radius: 25,
        visible: true
    },

    // Dynamic quintile thresholds for flows
    flowThresholds: [],

    render(state) {
        this.lastState = state;
        if (!state.routes || state.routes.length === 0) return;

        const logs = document.getElementById('cloud-logs');
        if (logs) logs.style.display = 'none';

        // Calculate max distance present in dataset if not initialized
        const allDistances = state.routes.map(r => parseFloat(r.distance_km) || 0);
        const datasetMaxDist = Math.ceil(Math.max(...allDistances, 10));
        if (this.maxDistanceFilter === Infinity) {
            this.maxDistanceLimit = datasetMaxDist;
            this.maxDistanceFilter = datasetMaxDist;
        }

        this.initCityAutocomplete();
        this.initMapControls();

        const saveBtn = document.getElementById('btn-cloud-save');
        if (saveBtn && !saveBtn.dataset.init) {
            saveBtn.addEventListener('click', () => this.saveToSheets(this.lastState));
            saveBtn.dataset.init = "true";
        }

        // 1. Filter routes according to max distance slider
        const activeRoutes = state.routes.filter(r => {
            const dist = parseFloat(r.distance_km) || 0;
            return dist <= this.maxDistanceFilter;
        });

        const allTrajectoryPoints = [];
        const pointFeatures = [];
        const decodedRoutes = [];

        // Extract employer destination coordinate
        let companyCoords = null;
        if (activeRoutes.length > 0 && activeRoutes[0].end_lon && activeRoutes[0].end_lat) {
            companyCoords = [activeRoutes[0].end_lon, activeRoutes[0].end_lat];
        }

        activeRoutes.forEach(route => {
            let coords = [];
            if (route.status === 'success' && route.geometry) {
                coords = this.decodePolyline(route.geometry);
            } else if (route.start_lon && route.start_lat && route.end_lon && route.end_lat) {
                coords = [[route.start_lon, route.start_lat], [route.end_lon, route.end_lat]];
            }

            if (coords.length > 0) {
                decodedRoutes.push(coords);
                
                // Sample polyline points using logarithmic scaling to prevent destination saturation
                const sampled = this.samplePolylinePointsLog(coords, 0.04, companyCoords);
                sampled.forEach(p => allTrajectoryPoints.push(p));

                pointFeatures.push({
                    type: "Feature",
                    properties: { type: 'depart', id: route.id, dist: route.distance_km },
                    geometry: { type: "Point", coordinates: [route.start_lon, route.start_lat] }
                });

                pointFeatures.push({
                    type: "Feature",
                    properties: { type: 'arrivee', id: route.id },
                    geometry: { type: "Point", coordinates: [route.end_lon, route.end_lat] }
                });
            }
        });

        // Compute segment frequencies and dynamic 20% quintile boundaries
        const { segments, maxPassages } = this.computeSegmentFrequencies(decodedRoutes);
        this.flowThresholds = this.computeQuintileThresholds(segments);

        // Filter segments by minimum flow threshold
        const filteredSegments = segments.filter(s => s.count >= this.minFlowFilter);

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
            })
        ];

        // 1. Heatmap Layer with logarithmic weight scaling & smooth dispersion
        if (this.displayMode === 'heatmap' || this.displayMode === 'both') {
            layers.push(
                new deck.HeatmapLayer({
                    id: 'heatmap-layer',
                    data: allTrajectoryPoints,
                    getPosition: d => d.coords,
                    getWeight: d => d.weight || 1,
                    radiusPixels: this.heatmapSettings.radius,
                    intensity: this.heatmapSettings.intensity,
                    threshold: this.heatmapSettings.threshold,
                    colorRange: [
                        [56, 189, 248, 40],   // Sky Blue halo
                        [45, 212, 191, 130],  // Soft Teal
                        [250, 204, 21, 190],  // Yellow
                        [249, 115, 22, 230],  // Orange
                        [220, 38, 38, 250],   // Bright Crimson
                        [153, 27, 27, 255]    // Burgundy
                    ]
                })
            );
        }

        // 2. Flow Path Layer with dynamic 20% quintile threshold coloring
        if (this.displayMode === 'flow' || this.displayMode === 'both') {
            layers.push(
                new deck.PathLayer({
                    id: 'routes-flow-layer',
                    data: filteredSegments,
                    getPath: d => d.path,
                    getColor: d => this.getSegmentColor(d.count),
                    getWidth: d => this.getSegmentWidth(d.count),
                    widthMinPixels: 2,
                    pickable: true,
                    onClick: (info) => {
                        if (info && info.object) {
                            // Clicking on a flow segment filters out flows with count <= this segment
                            this.minFlowFilter = info.object.count + 1;
                            const inputMinFlow = document.getElementById('input-min-flow');
                            if (inputMinFlow) inputMinFlow.value = this.minFlowFilter;
                            const valMinFlow = document.getElementById('val-min-flow');
                            if (valMinFlow) valMinFlow.innerText = `${this.minFlowFilter} passage(s)`;
                            this.render(this.lastState);
                        }
                    }
                })
            );
        }

        // 3. Employee & Employer Points Layer
        layers.push(
            new deck.GeoJsonLayer({
                id: 'points-layer',
                data: { type: "FeatureCollection", features: pointFeatures },
                pickable: this.pointSettings.visible,
                visible: this.pointSettings.visible,
                getFillColor: d => d.properties.type === 'arrivee' ? [239, 68, 68] : [34, 197, 94],
                getPointRadius: this.pointSettings.radius,
                pointRadiusMinPixels: this.pointSettings.visible ? Math.max(2, Math.round(this.pointSettings.radius / 5)) : 0
            })
        );

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
                    if (object.count) return `🔀 ${object.count} passage(s) de salarié(s)\n(Cliquer pour masquer les flux ≤ ${object.count})`;
                    if (object.properties && object.properties.range_km) return `Isochrone: ${object.properties.range_km} km`;
                    if (object.properties && object.properties.type) {
                        return object.properties.type === 'arrivee' 
                            ? "🏢 Site Employeur" 
                            : `🏠 Départ Employé (${object.properties.dist || '?'} km)`;
                    }
                    return null;
                }
            });
        } else {
            this.deckgl.setProps({ layers, initialViewState: initialView });
        }

        this.updateLegendUI();
    },

    computeSegmentFrequencies(routes) {
        const segmentMap = new Map();
        let maxPassages = 1;

        routes.forEach(coords => {
            for (let i = 0; i < coords.length - 1; i++) {
                const p1 = coords[i];
                const p2 = coords[i + 1];

                const k1 = `${p1[0].toFixed(5)},${p1[1].toFixed(5)}`;
                const k2 = `${p2[0].toFixed(5)},${p2[1].toFixed(5)}`;
                const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;

                const existing = segmentMap.get(key);
                if (existing) {
                    existing.count += 1;
                    if (existing.count > maxPassages) maxPassages = existing.count;
                } else {
                    segmentMap.set(key, { path: [p1, p2], count: 1 });
                }
            }
        });

        return {
            segments: Array.from(segmentMap.values()),
            maxPassages
        };
    },

    /**
     * Compute clean 20% quintile thresholds across all segment passage counts
     */
    computeQuintileThresholds(segments) {
        if (!segments || segments.length === 0) {
            return [
                { min: 1, max: 1, color: [56, 189, 248, 190], width: 3, label: '1 passage' },
                { min: 2, max: 3, color: [45, 212, 191, 210], width: 5, label: '2 - 3 passages' },
                { min: 4, max: 6, color: [250, 204, 21, 230], width: 7, label: '4 - 6 passages' },
                { min: 7, max: 10, color: [249, 115, 22, 245], width: 9, label: '7 - 10 passages' },
                { min: 11, max: Infinity, color: [185, 28, 28, 255], width: 12, label: '11+ passages' }
            ];
        }

        const counts = segments.map(s => s.count).sort((a, b) => a - b);
        const N = counts.length;

        // Get raw percentile values at 20%, 40%, 60%, 80%
        const q20 = counts[Math.floor(N * 0.20)] || 1;
        const q40 = counts[Math.floor(N * 0.40)] || 2;
        const q60 = counts[Math.floor(N * 0.60)] || 4;
        const q80 = counts[Math.floor(N * 0.80)] || 8;
        const maxVal = counts[N - 1] || 10;

        const palette = [
            { color: [56, 189, 248, 190], width: 3 },   // Sky Blue (20%)
            { color: [45, 212, 191, 210], width: 5 },   // Teal (40%)
            { color: [250, 204, 21, 230], width: 7 },   // Yellow (60%)
            { color: [249, 115, 22, 245], width: 9 },   // Orange (80%)
            { color: [185, 28, 28, 255], width: 12 }    // Dark Red (100%)
        ];

        // Create discrete non-overlapping integer bounds
        const rawBreaks = [1, q20, q40, q60, q80, maxVal];
        const ranges = [];
        let currMin = 1;

        for (let i = 0; i < 5; i++) {
            let bMax = rawBreaks[i + 1];
            if (bMax < currMin) bMax = currMin;

            // Ensure distinct boundary for next bucket if not at the top
            if (i < 4 && bMax >= rawBreaks[i + 2]) {
                // Keep bucket concise if duplicates occur
                bMax = currMin;
            }

            const isLast = (i === 4) || (bMax >= maxVal);
            const rangeMax = isLast ? Infinity : bMax;
            
            let label = "";
            if (currMin === rangeMax || rangeMax === Infinity && currMin === maxVal) {
                label = `${currMin} passage${currMin > 1 ? 's' : ''}`;
            } else if (rangeMax === Infinity) {
                label = `${currMin}+ passages`;
            } else {
                label = `${currMin} - ${rangeMax} passages`;
            }

            ranges.push({
                min: currMin,
                max: rangeMax,
                color: palette[i].color,
                width: palette[i].width,
                label
            });

            if (rangeMax === Infinity) break;
            currMin = rangeMax + 1;
            if (currMin > maxVal) break;
        }

        return ranges;
    },

    getSegmentColor(count) {
        if (!this.flowThresholds || this.flowThresholds.length === 0) return [56, 189, 248, 190];
        const matched = this.flowThresholds.find(t => count >= t.min && count <= t.max);
        return matched ? matched.color : this.flowThresholds[this.flowThresholds.length - 1].color;
    },

    getSegmentWidth(count) {
        if (!this.flowThresholds || this.flowThresholds.length === 0) return 3;
        const matched = this.flowThresholds.find(t => count >= t.min && count <= t.max);
        return matched ? matched.width : this.flowThresholds[this.flowThresholds.length - 1].width;
    },

    initMapControls() {
        if (document.getElementById('map-controls-panel')) return;

        const container = document.getElementById('map-container');
        if (!container) return;

        const controls = document.createElement('div');
        controls.id = 'map-controls-panel';
        controls.className = 'absolute top-4 right-4 bg-white/95 backdrop-blur p-4 rounded-2xl shadow-xl z-[50] border border-slate-200 w-72 space-y-3 text-xs';
        controls.innerHTML = `
            <h4 class="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">Visualisation & Filtres</h4>
            
            <!-- Mode Toggle -->
            <div class="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button id="btn-mode-heatmap" class="flex-1 py-1 text-[9px] font-bold rounded-lg transition-all ${this.displayMode === 'heatmap' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}">
                    🔥 Heatmap
                </button>
                <button id="btn-mode-flow" class="flex-1 py-1 text-[9px] font-bold rounded-lg transition-all ${this.displayMode === 'flow' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}">
                    🔀 Flux
                </button>
                <button id="btn-mode-both" class="flex-1 py-1 text-[9px] font-bold rounded-lg transition-all ${this.displayMode === 'both' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}">
                    ✨ Tout
                </button>
            </div>

            <!-- Distance Exclusion Slider -->
            <div class="pt-2 border-t border-slate-100 space-y-1">
                <div class="flex justify-between items-center text-[9px] font-bold text-slate-600">
                    <span>Distance max salarié</span>
                    <span id="val-max-distance" class="text-indigo-600 font-mono">${this.maxDistanceFilter} km</span>
                </div>
                <input type="range" id="input-max-distance" min="1" max="${this.maxDistanceLimit}" value="${this.maxDistanceFilter}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
            </div>

            <!-- Minimum Flow Threshold Filter -->
            <div id="flow-filter-box" class="pt-2 border-t border-slate-100 space-y-1 ${this.displayMode === 'heatmap' ? 'hidden' : ''}">
                <div class="flex justify-between items-center text-[9px] font-bold text-slate-600">
                    <span>Seuil min passages</span>
                    <span id="val-min-flow" class="text-indigo-600 font-mono">${this.minFlowFilter} passage(s)</span>
                </div>
                <div class="flex items-center gap-2">
                    <input type="range" id="input-min-flow" min="1" max="15" value="${this.minFlowFilter}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
                    <button id="btn-reset-flow-filter" class="text-[8px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-1.5 py-0.5 rounded border border-slate-200 shrink-0">Reset</button>
                </div>
            </div>

            <!-- Heatmap Controls -->
            <div id="heatmap-sliders-box" class="pt-2 border-t border-slate-100 space-y-2 ${this.displayMode === 'flow' ? 'hidden' : ''}">
                <div>
                    <div class="flex justify-between items-center text-[9px] font-bold text-slate-600 mb-1">
                        <span>Diffusion (Rayon)</span>
                        <span id="val-radius" class="text-indigo-600 font-mono">${this.heatmapSettings.radius}px</span>
                    </div>
                    <input type="range" id="input-radius" min="10" max="70" value="${this.heatmapSettings.radius}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
                </div>
                <div>
                    <div class="flex justify-between items-center text-[9px] font-bold text-slate-600 mb-1">
                        <span>Intensité Heatmap</span>
                        <span id="val-intensity" class="text-indigo-600 font-mono">${this.heatmapSettings.intensity}</span>
                    </div>
                    <input type="range" id="input-intensity" min="0.2" max="4.0" step="0.1" value="${this.heatmapSettings.intensity}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
                </div>
                <div>
                    <div class="flex justify-between items-center text-[9px] font-bold text-slate-600 mb-1">
                        <span>Seuil de coupure</span>
                        <span id="val-threshold" class="text-indigo-600 font-mono">${this.heatmapSettings.threshold}</span>
                    </div>
                    <input type="range" id="input-threshold" min="0.01" max="0.2" step="0.01" value="${this.heatmapSettings.threshold}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
                </div>
            </div>

            <!-- Points Controls -->
            <div class="pt-2 border-t border-slate-100 space-y-2">
                <div class="flex justify-between items-center">
                    <span class="text-[9px] font-extrabold uppercase text-slate-500">Points Salariés/Employeur</span>
                    <button id="btn-toggle-points" class="px-2 py-0.5 text-[9px] font-bold rounded-lg border transition-all ${this.pointSettings.visible ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}">
                        ${this.pointSettings.visible ? '👁️ Visibles' : '🙈 Masqués'}
                    </button>
                </div>
                
                <div id="point-radius-box" class="${this.pointSettings.visible ? '' : 'hidden'}">
                    <div class="flex justify-between items-center text-[9px] font-bold text-slate-600 mb-1">
                        <span>Taille des marqueurs</span>
                        <span id="val-point-radius" class="text-indigo-600 font-mono">${this.pointSettings.radius}px</span>
                    </div>
                    <input type="range" id="input-point-radius" min="5" max="60" value="${this.pointSettings.radius}" class="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600">
                </div>
            </div>
        `;
        container.appendChild(controls);

        const updateModeUI = (newMode) => {
            this.displayMode = newMode;
            document.getElementById('btn-mode-heatmap').className = `flex-1 py-1 text-[9px] font-bold rounded-lg transition-all ${newMode === 'heatmap' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}`;
            document.getElementById('btn-mode-flow').className = `flex-1 py-1 text-[9px] font-bold rounded-lg transition-all ${newMode === 'flow' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}`;
            document.getElementById('btn-mode-both').className = `flex-1 py-1 text-[9px] font-bold rounded-lg transition-all ${newMode === 'both' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}`;
            
            const slidersBox = document.getElementById('heatmap-sliders-box');
            if (slidersBox) slidersBox.classList.toggle('hidden', newMode === 'flow');

            const flowBox = document.getElementById('flow-filter-box');
            if (flowBox) flowBox.classList.toggle('hidden', newMode === 'heatmap');

            this.render(this.lastState);
        };

        document.getElementById('btn-mode-heatmap').onclick = () => updateModeUI('heatmap');
        document.getElementById('btn-mode-flow').onclick = () => updateModeUI('flow');
        document.getElementById('btn-mode-both').onclick = () => updateModeUI('both');

        // Distance exclusion slider event
        document.getElementById('input-max-distance').oninput = (e) => {
            this.maxDistanceFilter = parseFloat(e.target.value);
            document.getElementById('val-max-distance').innerText = `${this.maxDistanceFilter} km`;
            this.render(this.lastState);
        };

        // Minimum passage filter event
        document.getElementById('input-min-flow').oninput = (e) => {
            this.minFlowFilter = parseInt(e.target.value);
            document.getElementById('val-min-flow').innerText = `${this.minFlowFilter} passage(s)`;
            this.render(this.lastState);
        };

        document.getElementById('btn-reset-flow-filter').onclick = () => {
            this.minFlowFilter = 1;
            document.getElementById('input-min-flow').value = 1;
            document.getElementById('val-min-flow').innerText = `1 passage(s)`;
            this.render(this.lastState);
        };

        document.getElementById('input-radius').oninput = (e) => {
            this.heatmapSettings.radius = parseInt(e.target.value);
            document.getElementById('val-radius').innerText = `${this.heatmapSettings.radius}px`;
            this.render(this.lastState);
        };

        document.getElementById('input-intensity').oninput = (e) => {
            this.heatmapSettings.intensity = parseFloat(e.target.value);
            document.getElementById('val-intensity').innerText = this.heatmapSettings.intensity;
            this.render(this.lastState);
        };

        document.getElementById('input-threshold').oninput = (e) => {
            this.heatmapSettings.threshold = parseFloat(e.target.value);
            document.getElementById('val-threshold').innerText = this.heatmapSettings.threshold;
            this.render(this.lastState);
        };

        document.getElementById('btn-toggle-points').onclick = () => {
            this.pointSettings.visible = !this.pointSettings.visible;
            const btn = document.getElementById('btn-toggle-points');
            btn.className = `px-2 py-0.5 text-[9px] font-bold rounded-lg border transition-all ${this.pointSettings.visible ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`;
            btn.innerText = this.pointSettings.visible ? '👁️ Visibles' : '🙈 Masqués';

            const radiusBox = document.getElementById('point-radius-box');
            if (radiusBox) radiusBox.classList.toggle('hidden', !this.pointSettings.visible);

            this.render(this.lastState);
        };

        document.getElementById('input-point-radius').oninput = (e) => {
            this.pointSettings.radius = parseInt(e.target.value);
            document.getElementById('val-point-radius').innerText = `${this.pointSettings.radius}px`;
            this.render(this.lastState);
        };
    },

    updateLegendUI() {
        let legend = document.getElementById('flow-legend-widget');
        
        if (this.displayMode === 'heatmap') {
            if (legend) legend.remove();
            return;
        }

        const container = document.getElementById('map-container');
        if (!container) return;

        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'flow-legend-widget';
            legend.className = 'absolute bottom-6 right-4 bg-white/95 backdrop-blur p-3 rounded-2xl shadow-xl z-[40] border border-slate-200 text-xs w-52 space-y-1.5';
            container.appendChild(legend);
        }

        let legendHtml = `
            <div class="text-[9px] font-black uppercase text-slate-500 tracking-wider mb-2 flex items-center justify-between">
                <span>Légende (Tranches 20%)</span>
                <span class="text-indigo-600">Passages</span>
            </div>
        `;

        if (this.flowThresholds && this.flowThresholds.length > 0) {
            this.flowThresholds.forEach(t => {
                const rgb = `rgb(${t.color[0]}, ${t.color[1]}, ${t.color[2]})`;
                const isFiltered = t.max < this.minFlowFilter;
                legendHtml += `
                    <div class="flex items-center space-x-2 text-[10px] font-semibold ${isFiltered ? 'line-through opacity-40' : 'text-slate-700'} cursor-pointer hover:text-indigo-600"
                         onclick="window.MapDisplay.toggleLegendFilter(${t.min})">
                        <span class="w-3 h-3 rounded-full inline-block shrink-0 shadow-sm" style="background-color: ${rgb}"></span>
                        <span>${t.label}</span>
                    </div>
                `;
            });
        }

        legend.innerHTML = legendHtml;
    },

    toggleLegendFilter(minVal) {
        if (this.minFlowFilter === minVal) {
            this.minFlowFilter = 1;
        } else {
            this.minFlowFilter = minVal;
        }
        const inputMinFlow = document.getElementById('input-min-flow');
        if (inputMinFlow) inputMinFlow.value = this.minFlowFilter;
        const valMinFlow = document.getElementById('val-min-flow');
        if (valMinFlow) valMinFlow.innerText = `${this.minFlowFilter} passage(s)`;
        this.render(this.lastState);
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

    /**
     * Logarithmic polyline point sampling to preserve corridor contrast without destination saturation
     */
    samplePolylinePointsLog(coords, stepKm = 0.04, companyCoords = null) {
        const points = [];
        if (!coords || coords.length === 0) return points;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];

            // Apply logarithmic attenuation near employer node to maintain broad contrast
            let weight = 1.0;
            if (companyCoords) {
                const distToCompany = this.haversineDistance(p1[1], p1[0], companyCoords[1], companyCoords[0]);
                if (distToCompany < 0.1) {
                    weight = Math.log1p(distToCompany * 10) / Math.log1p(10); // Log compression
                    weight = Math.max(0.15, weight);
                }
            }

            points.push({ coords: p1, weight });

            const dist = this.haversineDistance(p1[1], p1[0], p2[1], p2[0]);

            if (dist > stepKm && !isNaN(dist)) {
                const steps = Math.floor(dist / stepKm);
                for (let s = 1; s <= steps; s++) {
                    const ratio = s / (steps + 1);
                    const interpLon = p1[0] + (p2[0] - p1[0]) * ratio;
                    const interpLat = p1[1] + (p2[1] - p1[1]) * ratio;

                    let interpWeight = 1.0;
                    if (companyCoords) {
                        const distToComp = this.haversineDistance(interpLat, interpLon, companyCoords[1], companyCoords[0]);
                        if (distToComp < 0.1) {
                            interpWeight = Math.log1p(distToComp * 10) / Math.log1p(10);
                            interpWeight = Math.max(0.15, interpWeight);
                        }
                    }

                    points.push({ coords: [interpLon, interpLat], weight: interpWeight });
                }
            }
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

window.MapDisplay = MapDisplay;
