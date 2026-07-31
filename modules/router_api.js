export const RouterAPI = {
    worker: null,
    deckgl: null,
    livePaths: [],

    init() {
        console.log("[RouterAPI] Initialisation du moteur de routage WFS streaming BD TOPO...");
    },

    createWorker() {
        const workerCode = `
            const MAX_NODES = 2000000;
            const MAX_EDGES = 6000000;

            let nodesLon, nodesLat, head;
            let nodeCount = 0;

            let edgeTo, edgeWeight, edgeDist, edgeNext;
            let edgeCount = 0;

            let coordToId;

            class DynamicLazyHeap {
                constructor() { this.data = []; }
                push(id, dist) {
                    let i = this.data.length / 2;
                    this.data.push(id, dist);
                    while (i > 0) {
                        let p = (i - 1) >> 1;
                        if (this.data[p * 2 + 1] <= dist) break;
                        this.data[i * 2] = this.data[p * 2];
                        this.data[i * 2 + 1] = this.data[p * 2 + 1];
                        i = p;
                    }
                    this.data[i * 2] = id;
                    this.data[i * 2 + 1] = dist;
                }
                pop() {
                    const len = this.data.length;
                    if (len === 0) return null;
                    const topId = this.data[0], topDist = this.data[1];
                    const botDist = this.data.pop(), botId = this.data.pop();
                    const size = this.data.length / 2;
                    if (size > 0) {
                        let i = 0;
                        while ((i * 2) + 1 < size) {
                            let left = (i * 2) + 1, right = left + 1, smallest = left;
                            if (right < size && this.data[right * 2 + 1] < this.data[left * 2 + 1]) smallest = right;
                            if (this.data[smallest * 2 + 1] >= botDist) break;
                            this.data[i * 2] = this.data[smallest * 2];
                            this.data[i * 2 + 1] = this.data[smallest * 2 + 1];
                            i = smallest;
                        }
                        this.data[i * 2] = botId;
                        this.data[i * 2 + 1] = botDist;
                    }
                    return { id: topId, dist: topDist };
                }
                get size() { return this.data.length / 2; }
            }

            self.onmessage = function(e) {
                const { type, data } = e.data;

                if (type === 'BUILD_START') {
                    nodesLon = new Float32Array(MAX_NODES);
                    nodesLat = new Float32Array(MAX_NODES);
                    head = new Int32Array(MAX_NODES).fill(-1);

                    edgeTo = new Int32Array(MAX_EDGES);
                    edgeWeight = new Float32Array(MAX_EDGES);
                    edgeDist = new Float32Array(MAX_EDGES);
                    edgeNext = new Int32Array(MAX_EDGES);

                    nodeCount = 0;
                    edgeCount = 0;
                    coordToId = new Map();
                }

                if (type === 'BUILD_CHUNK') {
                    const features = data;

                    function getHash(lon, lat) {
                        const x = Math.round((lon + 180) * 100000) | 0;
                        const y = Math.round((lat + 90) * 100000) | 0;
                        return x * 100000000 + y;
                    }

                    function getId(lon, lat) {
                        const key = getHash(lon, lat);
                        let id = coordToId.get(key);
                        if (id === undefined) {
                            if (nodeCount >= MAX_NODES) return -1;
                            id = nodeCount++;
                            coordToId.set(key, id);
                            nodesLon[id] = lon;
                            nodesLat[id] = lat;
                        }
                        return id;
                    }

                    function addEdge(u, v, weight, dist) {
                        if (edgeCount >= MAX_EDGES || u === -1 || v === -1) return;
                        edgeTo[edgeCount] = v;
                        edgeWeight[edgeCount] = weight;
                        edgeDist[edgeCount] = dist;
                        edgeNext[edgeCount] = head[u];
                        head[u] = edgeCount++;
                    }

                    features.forEach(feature => {
                        const geom = feature.geometry;
                        if (!geom || geom.type !== 'LineString') return;

                        const props = feature.properties || {};
                        const nature = String(props.nature || '').trim();
                        const importance = String(props.importance || '').trim();
                        const sens = String(props.sens_de_circulation || 'Double sens').trim();

                        if (importance === '1' || sens === 'Interdit') return;

                        let penalty = 1.0;
                        if (nature === 'Piste cyclable' || nature === 'Voie verte') penalty = 0.5;
                        else if (importance === '2') penalty = 4.0;
                        else if (importance === '3') penalty = 2.5;
                        else if (importance === '4' || importance === '5') penalty = 1.0;
                        else if (importance === '6' || nature === 'Chemin' || nature === 'Sentier') penalty = 1.5;

                        const coords = geom.coordinates;
                        for (let i = 0; i < coords.length - 1; i++) {
                            const u = getId(coords[i][0], coords[i][1]);
                            const v = getId(coords[i+1][0], coords[i+1][1]);
                            if (u === -1 || v === -1) continue;

                            const dist = getDist(coords[i][1], coords[i][0], coords[i+1][1], coords[i+1][0]);
                            const weight = dist * penalty;

                            if (sens === 'Sens direct') {
                                addEdge(u, v, weight, dist);
                            } else if (sens === 'Sens unique inverse') {
                                addEdge(v, u, weight, dist);
                            } else {
                                addEdge(u, v, weight, dist);
                                addEdge(v, u, weight, dist);
                            }
                        }
                    });
                }

                if (type === 'BUILD_FINISH') {
                    coordToId.clear();
                    coordToId = null;
                    self.postMessage({ type: 'READY', nodes: nodeCount, edges: edgeCount });
                }

                if (type === 'ROUTE') {
                    const path = runDijkstra(data.start, data.end);
                    self.postMessage({ type: 'ROUTE_RESULT', id: data.id, path });
                }
            };

            function getDist(la1, lo1, la2, lo2) {
                const dLat = (la2 - la1) * Math.PI / 180;
                const dLon = (lo2 - lo1) * Math.PI / 180;
                const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
                return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
            }

            function findNearestId(lon, lat) {
                let min = Infinity, bestId = -1;
                for (let i = 0; i < nodeCount; i++) {
                    const d = (nodesLon[i] - lon)**2 + (nodesLat[i] - lat)**2;
                    if (d < min) { min = d; bestId = i; }
                }
                return bestId;
            }

            function runDijkstra(sObj, eObj) {
                const startId = findNearestId(sObj.lng, sObj.lat);
                const endId = findNearestId(eObj.lng, eObj.lat);
                
                if (startId === -1 || endId === -1) {
                    return { coords: [], totalDist: 0 };
                }

                const dists = new Float64Array(nodeCount);
                dists.fill(Infinity);
                const prevNode = new Int32Array(nodeCount);
                prevNode.fill(-1);
                const prevDist = new Float32Array(nodeCount);

                const pq = new DynamicLazyHeap(); 

                dists[startId] = 0;
                pq.push(startId, 0);

                while (pq.size > 0) {
                    const top = pq.pop();
                    const curr = top.id;
                    const d = top.dist;

                    if (curr === endId) break;
                    if (d > dists[curr]) continue;

                    for (let e = head[curr]; e !== -1; e = edgeNext[e]) {
                        const target = edgeTo[e];
                        const weight = edgeWeight[e];
                        const realDist = edgeDist[e];
                        const newD = d + weight;

                        if (newD < dists[target]) {
                            dists[target] = newD;
                            prevNode[target] = curr;
                            prevDist[target] = realDist;
                            pq.push(target, newD);
                        }
                    }
                }

                if (prevNode[endId] === -1 && startId !== endId) {
                    return { coords: [], totalDist: 0 }; 
                }

                const coords = [];
                let curr = endId;
                let totalDist = 0;

                while (curr !== -1) {
                    coords.push([nodesLon[curr], nodesLat[curr]]);
                    totalDist += prevDist[curr] || 0;
                    curr = prevNode[curr];
                }
                return { coords, totalDist };
            }
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    },

    initLiveDeckGL(coordinates) {
        const container = document.getElementById('route-deck-container');
        if (!container) return;

        this.livePaths = [];
        
        let avgLat = 48.8566, avgLng = 2.3522;
        if (coordinates && coordinates.length > 0) {
            avgLat = coordinates.reduce((sum, c) => sum + c.start_lat, 0) / coordinates.length;
            avgLng = coordinates.reduce((sum, c) => sum + c.start_lon, 0) / coordinates.length;
        }

        const pointFeatures = [];
        coordinates.forEach(c => {
            pointFeatures.push({
                type: "Feature",
                properties: { type: 'depart' },
                geometry: { type: "Point", coordinates: [c.start_lon, c.start_lat] }
            });
            pointFeatures.push({
                type: "Feature",
                properties: { type: 'arrivee' },
                geometry: { type: "Point", coordinates: [c.end_lon, c.end_lat] }
            });
        });

        const layers = [
            new deck.TileLayer({
                id: 'route-base-tiles',
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
                id: 'route-points-layer',
                data: { type: "FeatureCollection", features: pointFeatures },
                getFillColor: d => d.properties.type === 'arrivee' ? [239, 68, 68] : [34, 197, 94],
                getPointRadius: 20,
                pointRadiusMinPixels: 4
            })
        ];

        if (!this.deckgl) {
            this.deckgl = new deck.DeckGL({
                container: 'route-deck-container',
                initialViewState: { longitude: avgLng, latitude: avgLat, zoom: 11, pitch: 30, bearing: 0 },
                controller: true,
                layers: layers
            });
        } else {
            this.deckgl.setProps({
                layers,
                initialViewState: { longitude: avgLng, latitude: avgLat, zoom: 11 }
            });
        }
    },

    updateLiveDeckGL(newPathCoords, coordinates) {
        if (!this.deckgl) return;

        if (newPathCoords && newPathCoords.length > 0) {
            this.livePaths.push({ path: newPathCoords });
        }

        const pointFeatures = [];
        coordinates.forEach(c => {
            pointFeatures.push({
                type: "Feature",
                properties: { type: 'depart' },
                geometry: { type: "Point", coordinates: [c.start_lon, c.start_lat] }
            });
            pointFeatures.push({
                type: "Feature",
                properties: { type: 'arrivee' },
                geometry: { type: "Point", coordinates: [c.end_lon, c.end_lat] }
            });
        });

        const layers = [
            new deck.TileLayer({
                id: 'route-base-tiles',
                data: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
                renderSubLayers: props => {
                    const { bbox: { west, south, east, north } } = props.tile;
                    return new deck.BitmapLayer(props, {
                        data: null, image: props.data,
                        bounds: [west, south, east, north]
                    });
                }
            }),
            new deck.PathLayer({
                id: 'route-live-glow',
                data: this.livePaths,
                getPath: d => d.path,
                getColor: [99, 102, 241, 120],
                getWidth: 8,
                widthMinPixels: 4
            }),
            new deck.PathLayer({
                id: 'route-live-line',
                data: this.livePaths,
                getPath: d => d.path,
                getColor: [16, 185, 129, 240],
                getWidth: 3,
                widthMinPixels: 2
            }),
            new deck.GeoJsonLayer({
                id: 'route-points-layer',
                data: { type: "FeatureCollection", features: pointFeatures },
                getFillColor: d => d.properties.type === 'arrivee' ? [239, 68, 68] : [34, 197, 94],
                getPointRadius: 20,
                pointRadiusMinPixels: 4
            })
        ];

        this.deckgl.setProps({ layers });
    },

    async startRouting(selectedBboxPayload, coordinates, userName) {
        console.log(`[RouterAPI] Traitement du routage pour ${userName}...`);
        
        const routeLogs = document.getElementById('route-logs');
        const progressText = document.getElementById('route-progress-text');

        const appendLog = (msg) => {
            if (routeLogs) {
                routeLogs.innerHTML += `\n${msg}`;
                routeLogs.scrollTop = routeLogs.scrollHeight;
            }
        };

        if (routeLogs) routeLogs.innerHTML = `> Utilisateur : ${userName}`;
        if (progressText) progressText.innerText = "Téléchargement BD TOPO WFS...";

        // Initialisation de la carte Deck.gl temps réel
        this.initLiveDeckGL(coordinates);

        const bbox = selectedBboxPayload.bbox;
        const bboxString = selectedBboxPayload.wfsBboxString || `${bbox.minLat.toFixed(6)},${bbox.minLng.toFixed(6)},${bbox.maxLat.toFixed(6)},${bbox.maxLng.toFixed(6)},urn:ogc:def:crs:EPSG::4326`;

        appendLog(`> Emprise BBOX transmise : ${bboxString}`);
        appendLog(`> Initialisation du Worker Dijkstra...`);

        this.worker = this.createWorker();
        this.worker.postMessage({ type: 'BUILD_START' });

        const chunkSize = 2500;
        const requestDelay = 800;
        let startIndex = 0;
        let isLastPage = false;
        let callCount = 0;
        let totalReceivedFeatures = 0;

        appendLog(`> Démarrage du streaming WFS IGN BD TOPO par paquets de ${chunkSize}...`);

        while (!isLastPage) {
            callCount++;
            
            const url = new URL('https://data.geopf.fr/wfs/ows');
            url.searchParams.append('SERVICE', 'WFS');
            url.searchParams.append('VERSION', '2.0.0');
            url.searchParams.append('REQUEST', 'GetFeature');
            url.searchParams.append('OUTPUTFORMAT', 'application/json');
            url.searchParams.append('SRSNAME', 'EPSG:4326');
            url.searchParams.append('BBOX', bboxString);
            url.searchParams.append('TYPENAMES', 'BDTOPO_V3:troncon_de_route');
            url.searchParams.append('COUNT', chunkSize.toString());
            url.searchParams.append('STARTINDEX', startIndex.toString());

            try {
                const response = await fetch(url.toString());
                if (!response.ok) throw new Error(`Code HTTP ${response.status}`);
                const data = await response.json();

                if (data && data.features && data.features.length > 0) {
                    const receivedCount = data.features.length;
                    totalReceivedFeatures += receivedCount;

                    this.worker.postMessage({ type: 'BUILD_CHUNK', data: data.features });
                    appendLog(`> [Paquet #${callCount}] ${receivedCount} tronçons transmis au Worker (Total: ${totalReceivedFeatures})...`);

                    if (receivedCount < chunkSize) {
                        isLastPage = true;
                    } else {
                        startIndex += chunkSize;
                    }
                } else {
                    if (callCount === 1 && totalReceivedFeatures === 0) {
                        const altBboxStr = `${bbox.minLng.toFixed(6)},${bbox.minLat.toFixed(6)},${bbox.maxLng.toFixed(6)},${bbox.maxLat.toFixed(6)},EPSG:4326`;
                        url.searchParams.set('BBOX', altBboxStr);
                        const altResp = await fetch(url.toString());
                        if (altResp.ok) {
                            const altData = await altResp.json();
                            if (altData && altData.features && altData.features.length > 0) {
                                totalReceivedFeatures += altData.features.length;
                                this.worker.postMessage({ type: 'BUILD_CHUNK', data: altData.features });
                                appendLog(`> [Paquet #${callCount}] ${altData.features.length} tronçons transmis au Worker...`);
                                if (altData.features.length >= chunkSize) {
                                    startIndex += chunkSize;
                                    isLastPage = false;
                                } else {
                                    isLastPage = true;
                                }
                            } else { isLastPage = true; }
                        } else { isLastPage = true; }
                    } else { isLastPage = true; }
                }
            } catch (err) {
                console.error("[RouterAPI] Erreur WFS:", err);
                appendLog(`> ⚠️ Erreur WFS sur le paquet #${callCount}: ${err.message}`);
                isLastPage = true;
            }

            if (!isLastPage) {
                await new Promise(r => setTimeout(r, requestDelay));
            }
        }

        appendLog(`> Fin de l'extraction WFS (${totalReceivedFeatures} tronçons). Finalisation du graphe...`);
        this.worker.postMessage({ type: 'BUILD_FINISH' });

        await new Promise((resolve) => {
            const handleReady = (e) => {
                if (e.data.type === 'READY') {
                    appendLog(`> ✅ Graphe structuré : ${e.data.nodes.toLocaleString()} carrefours, ${e.data.edges.toLocaleString()} arcs directionnels.`);
                    this.worker.removeEventListener('message', handleReady);
                    resolve();
                }
            };
            this.worker.addEventListener('message', handleReady);
        });

        appendLog(`> Calcul des itinéraires Dijkstra en direct pour ${coordinates.length} salariés...`);

        const computedRoutes = [];

        for (let i = 0; i < coordinates.length; i++) {
            const emp = coordinates[i];
            const startObj = { lat: emp.start_lat, lng: emp.start_lon };
            const endObj = { lat: emp.end_lat, lng: emp.end_lon };

            if (progressText) {
                progressText.innerText = `Calcul itinéraire ${i + 1} / ${coordinates.length}...`;
            }

            const pathResult = await new Promise((resolve) => {
                const handleRoute = (e) => {
                    if (e.data.type === 'ROUTE_RESULT' && e.data.id === emp.id) {
                        this.worker.removeEventListener('message', handleRoute);
                        resolve(e.data.path);
                    }
                };
                this.worker.addEventListener('message', handleRoute);
                this.worker.postMessage({
                    type: 'ROUTE',
                    data: { id: emp.id, start: startObj, end: endObj }
                });
            });

            const hasPath = pathResult && pathResult.coords && pathResult.coords.length > 0;
            const distKm = hasPath 
                ? parseFloat(pathResult.totalDist.toFixed(2)) 
                : parseFloat((Math.sqrt(Math.pow((endObj.lat - startObj.lat) * 111, 2) + Math.pow((endObj.lng - startObj.lng) * 75, 2))).toFixed(2));
            const durationMin = parseFloat((distKm * 3.5).toFixed(1));

            const polylineGeometry = hasPath ? this.encodePolyline(pathResult.coords) : null;

            // Mettre à jour la visualisation Deck.gl en direct !
            if (hasPath) {
                this.updateLiveDeckGL(pathResult.coords, coordinates);
            }

            computedRoutes.push({
                id: emp.id || `route-${i + 1}`,
                status: 'success',
                start_lat: emp.start_lat,
                start_lon: emp.start_lon,
                end_lat: emp.end_lat,
                end_lon: emp.end_lon,
                distance_km: distKm,
                duration_min: durationMin,
                geometry: polylineGeometry
            });

            // Petite pause visuelle pour apprécier l'animation du tracé
            await new Promise(r => setTimeout(r, 60));
        }

        if (progressText) progressText.innerText = "Calculs terminés ! Redirection...";
        appendLog(`> ✅ ${computedRoutes.length} itinéraires calculés avec succès ! Transmission au Dashboard...`);
        this.worker.terminate();

        return computedRoutes;
    },

    encodePolyline(coords, precision = 5) {
        let factor = Math.pow(10, precision);
        let output = '';
        let prevLat = 0, prevLng = 0;

        for (let i = 0; i < coords.length; i++) {
            let lat = Math.round(coords[i][1] * factor);
            let lng = Math.round(coords[i][0] * factor);
            let dLat = lat - prevLat;
            let dLng = lng - prevLng;
            prevLat = lat;
            prevLng = lng;

            [dLat, dLng].forEach(val => {
                let num = (val < 0) ? ~(val << 1) : (val << 1);
                while (num >= 0x20) {
                    output += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
                    num >>= 5;
                }
                output += String.fromCharCode(num + 63);
            });
        }
        return output;
    }
};
