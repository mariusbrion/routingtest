export const MapDisplay = {
    deckgl: null,
    lastState: null,
    isCityValidated: false,
    heatmapSettings: { radius: 35, threshold: 0.05 },

    render(state) {
        this.lastState = state;
        if (!state.routes || state.routes.length === 0) return;

        const logs = document.getElementById('cloud-logs');
        if (logs) logs.style.display = 'none';

        this.initCityAutocomplete();

        const pointFeatures = [];
        state.routes.forEach(route => {
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
        });

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
                id: 'points-layer',
                data: { type: "FeatureCollection", features: pointFeatures },
                pickable: true,
                getFillColor: d => d.properties.type === 'arrivee' ? [239, 68, 68] : [34, 197, 94],
                getPointRadius: 25,
                pointRadiusMinPixels: 4
            })
        ];

        const centerLon = state.routes[0]?.end_lon || 2.3522;
        const centerLat = state.routes[0]?.end_lat || 48.8566;

        if (!this.deckgl) {
            this.deckgl = new deck.DeckGL({
                container: 'map-container',
                initialViewState: { longitude: centerLon, latitude: centerLat, zoom: 11, pitch: 0, bearing: 0 },
                controller: true,
                layers: layers,
                glOptions: { preserveDrawingBuffer: true }
            });
        } else {
            this.deckgl.setProps({ layers, initialViewState: { longitude: centerLon, latitude: centerLat, zoom: 11 } });
        }
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
                            item.className = 'p-3 hover:bg-indigo-50 cursor-pointer text-xs border-b border-slate-100 last:border-0';
                            item.innerText = res.display_name;
                            
                            item.onclick = () => {
                                const city = res.address.city || res.address.town || res.address.village || res.display_name.split(',')[0];
                                input.value = city;
                                this.isCityValidated = true;
                                suggestionContainer.classList.add('hidden');
                            };
                            suggestionContainer.appendChild(item);
                        });
                    }
                } catch (err) { console.error(err); }
            }, 400);
        });
    }
};
