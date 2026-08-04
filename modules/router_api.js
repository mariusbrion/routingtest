export const RouterAPI = {
    worker: null,
    deckgl: null,
    livePaths: [],
    processedRoutes: [],
    logUrl: "https://script.google.com/macros/s/AKfycbwBNZF_feM3tDlPM4yghacRYoHkBtRaNEjP9YJZp1HSmDOFXLYbqoVkwGicQj_TCC88qw/exec",
    currentUserName: "Anonyme",

    init() {
        console.log("[RouterAPI] Initialisation du moteur de routage WFS streaming BD TOPO...");
    },

    async logSession(destAddress, coords) {
        try {
            let finalName = this.currentUserName || "Anonyme";
            finalName = String(finalName)
                .replace(/.*(connecté|en tant que|bienvenue)\s*[:]*\s*/gi, '')
                .trim();

            if (finalName.includes(':')) finalName = finalName.split(':').pop().trim();

            const payload = {
                userName: finalName,
                destinationAddress: destAddress,
                coordinates: coords,
                totalRoutes: this.processedRoutes.length
            };

            console.log("[Marius] Log de session envoyé pour :", payload.userName);

            fetch(this.logUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

        } catch (error) {
            console.error("[Marius] Erreur de journalisation:", error);
        }
    },

    createWorker() {
        const workerCode = `
            const MAX_NODES = 2000000;
            const MAX_EDGES = 6000000;

            let nodesLon, nodesLat, head;
            let nodeCount = 0;

            let edgeTo, edgeWeight, edgeDist, edgeNext, edgeCarWeight;
            let edgeCount = 0;

            let coordToId;

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
                    edgeCarWeight = new Float32Array(MAX_EDGES);
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

                    function addEdge(u, v, bikeWeight, carWeight, dist) {
                        if (edgeCount >= MAX_EDGES || u === -1 || v === -1) return;
                        edgeTo[edgeCount] = v;
                        edgeWeight[edgeCount] = bikeWeight;
                        edgeCarWeight[edgeCount] = carWeight;
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

                        if (sens === 'Interdit') return;

                        // Vélo : Pénalise les grands axes (importance 1 & 2)
                        let bikePenalty = 1.0;
                        if (importance === '1') return; // Interdit vélo sur autoroutes
                        if (nature === 'Piste cyclable' || nature === 'Voie verte') bikePenalty = 0.5;
                        else if (importance === '2') bikePenalty = 4.0;
                        else if (importance === '3') bikePenalty = 2.5;
                        else if (importance === '4' || importance === '5') bikePenalty = 1.0;
                        else if (importance === '6' || nature === 'Chemin' || nature === 'Sentier') bikePenalty = 1.5;

                        // Voiture : Favorise les grands axes (importance 1 & 2), interdit pistes cyclables
                        let carPenalty = 1.0;
                        if (nature === 'Piste cyclable' || nature === 'Voie verte' || nature === 'Sentier') {
                            carPenalty = 999.0; // Inaccessible voiture
                        } else if (importance === '1') carPenalty = 0.4; // Vitesse rapide
                        else if (importance === '2') carPenalty = 0.6;
                        else if (importance === '3') carPenalty = 0.8;
                        else if (importance === '4') carPenalty = 1.0;
                        else if (importance === '5' || importance === '6') carPenalty = 1.8;

                        const coords = geom.coordinates;
                        for (let i = 0; i < coords.length - 1; i++) {
                            const u = getId(coords[i][0], coords[i][1]);
                            const v = getId(coords[i+1][0], coords[i+1][1]);
                            if (u === -1 || v === -1) continue;

                            const dist = getDist(coords[i][1], coords[i][0], coords[i+1][1], coords[i+1][0]);
                            const bikeW = dist * bikePenalty;
                            const carW = dist * carPenalty;

                            if (sens === 'Sens direct') {
                                addEdge(u, v, bikeW, carW, dist);
                            } else if (sens === 'Sens unique inverse') {
                                addEdge(v, u, bikeW, carW, dist);
                            } else {
                                addEdge(u, v, bikeW, carW, dist);
                                addEdge(v, u, bikeW, carW, dist);
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
                    const bikePath = runDijkstra(data.start, data.end, 'bike');
                    const carPath = runDijkstra(data.start, data.end, 'car');
                    self.postMessage({ type: 'ROUTE_RESULT', id: data.id, path: bikePath, carPath });
                }
            };

            function runDijkstra(sObj, eObj, mode = 'bike') {
                if (nodeCount === 0) {
                    const directDist = getDist(sObj.lat, sObj.lng, eObj.lat, eObj.lng);
                    return { coords: [[sObj.lng, sObj.lat], [eObj.lng, eObj.lat]], totalDist: directDist };
                }

                const startId = findNearestId(sObj.lng, sObj.lat);
                const endId = findNearestId(eObj.lng, eObj.lat);
                
                if (startId === -1 || endId === -1) {
                    const directDist = getDist(sObj.lat, sObj.lng, eObj.lat, eObj.lng);
                    return { coords: [[sObj.lng, sObj.lat], [eObj.lng, eObj.lat]], totalDist: directDist };
                }

                const dists = new Float64Array(nodeCount);
                dists.fill(Infinity);
                const prevNode = new Int32Array(nodeCount);
                prevNode.fill(-1);
                const prevDist = new Float32Array(nodeCount);

                const pq = new DynamicLazyHeap(); 

                dists[startId] = 0;
                pq.push(startId, 0);

                const weightsArray = mode === 'car' ? edgeCarWeight : edgeWeight;

                while (pq.size > 0) {
                    const top = pq.pop();
                    const curr = top.id;
                    const d = top.dist;

                    if (curr === endId) break;
                    if (d > dists[curr]) continue;

                    for (let e = head[curr]; e !== -1; e = edgeNext[e]) {
                        const target = edgeTo[e];
                        const weight = weightsArray[e];
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
                    const directDist = getDist(sObj.lat, sObj.lng, eObj.lat, eObj.lng);
                    return { 
                        coords: [[sObj.lng, sObj.lat], [nodesLon[startId], nodesLat[startId]], [nodesLon[endId], nodesLat[endId]], [eObj.lng, eObj.lat]], 
                        totalDist: directDist 
                    }; 
                }

                const coords = [];
                coords.push([eObj.lng, eObj.lat]);

                let curr = endId;
                let dijkstraDist = 0;

                while (curr !== -1) {
                    coords.push([nodesLon[curr], nodesLat[curr]]);
                    dijkstraDist += prevDist[curr] || 0;
                    curr = prevNode[curr];
                }

                coords.push([sObj.lng, sObj.lat]);
                coords.reverse();

                const totalDist = getDist(sObj.lat, sObj.lng, nodesLat[startId], nodesLon[startId]) + dijkstraDist + getDist(nodesLat[endId], nodesLon[endId], eObj.lat, eObj.lng);
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
        
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        if (coordinates && coordinates.length > 0) {
            coordinates.forEach(c => {
                if (c.start_lat < minLat) minLat = c.start_lat;
                if (c.start_lat > maxLat) maxLat = c.start_lat;
                if (c.end_lat < minLat) minLat = c.end_lat;
                if (c.end_lat > maxLat) maxLat = c.end_lat;
                if (c.start_lon < minLng) minLng = c.start_lon;
                if (c.start_lon > maxLng) maxLng = c.start_lon;
                if (c.end_lon < minLng) minLng = c.end_lon;
                if (c.end_lon > maxLng) maxLng = c.end_lon;
            });
        } else {
            minLat = 48.8; maxLat = 48.9; minLng = 2.3; maxLng = 2.4;
        }

        const avgLat = (minLat + maxLat) / 2;
        const avgLng = (minLng + maxLng) / 2;

        const maxDiff = Math.max(Math.abs(maxLat - minLat), Math.abs(maxLng - minLng));
        let zoom = 11;
        if (maxDiff > 0) {
            zoom = Math.max(6, Math.min(14, Math.floor(9.5 - Math.log2(maxDiff))));
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

        // Rendu 2D à plat (pitch: 0, bearing: 0) et cadrage dynamique
        if (!this.deckgl) {
            this.deckgl = new deck.DeckGL({
                container: 'route-deck-container',
                initialViewState: { longitude: avgLng, latitude: avgLat, zoom: zoom, pitch: 0, bearing: 0 },
                controller: true,
                layers: layers
            });
        } else {
            this.deckgl.setProps({
                layers,
                initialViewState: { longitude: avgLng, latitude: avgLat, zoom: zoom, pitch: 0, bearing: 0 }
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
                data: [...this.livePaths],
                getPath: d => d.path,
                getColor: [99, 102, 241, 140],
                getWidth: 8,
                widthMinPixels: 4
            }),
            new deck.PathLayer({
                id: 'route-live-line',
                data: [...this.livePaths],
                getPath: d => d.path,
                getColor: [16, 185, 129, 255],
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
        this.currentUserName = userName || "Anonyme";
        
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

        // Initialisation de la carte Deck.gl temps réel en 2D à plat
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
        const computedCarRoutes = [];

        for (let i = 0; i < coordinates.length; i++) {
            const emp = coordinates[i];
            const startObj = { lat: emp.start_lat, lng: emp.start_lon };
            const endObj = { lat: emp.end_lat, lng: emp.end_lon };

            if (progressText) {
                progressText.innerText = `Calcul itinéraire ${i + 1} / ${coordinates.length}...`;
            }

            const routeData = await new Promise((resolve) => {
                const handleRoute = (e) => {
                    if (e.data.type === 'ROUTE_RESULT' && e.data.id === emp.id) {
                        this.worker.removeEventListener('message', handleRoute);
                        resolve({ bike: e.data.path, car: e.data.carPath });
                    }
                };
                this.worker.addEventListener('message', handleRoute);
                this.worker.postMessage({
                    type: 'ROUTE',
                    data: { id: emp.id, start: startObj, end: endObj }
                });
            });

            const bikePath = routeData.bike;
            const carPath = routeData.car;

            const bikeDist = bikePath && bikePath.coords && bikePath.coords.length > 0 
                ? parseFloat(bikePath.totalDist.toFixed(2)) 
                : parseFloat((Math.sqrt(Math.pow((endObj.lat - startObj.lat) * 111, 2) + Math.pow((endObj.lng - startObj.lng) * 75, 2))).toFixed(2));
            
            const carDist = carPath && carPath.coords && carPath.coords.length > 0
                ? parseFloat(carPath.totalDist.toFixed(2))
                : bikeDist;

            const bikeDuration = parseFloat((bikeDist * 3.5).toFixed(1));
            const carDuration = parseFloat((carDist * 1.5).toFixed(1)); // Vitesse moyenne voiture ~40 km/h

            if (bikePath && bikePath.coords) {
                this.updateLiveDeckGL(bikePath.coords, coordinates);
            }

            computedRoutes.push({
                id: emp.id || `route-${i + 1}`,
                status: 'success',
                start_lat: emp.start_lat,
                start_lon: emp.start_lon,
                end_lat: emp.end_lat,
                end_lon: emp.end_lon,
                distance_km: bikeDist,
                duration_min: bikeDuration,
                geometry: bikePath?.coords ? this.encodePolyline(bikePath.coords) : null
            });

            computedCarRoutes.push({
                id: emp.id || `route-${i + 1}`,
                status: 'success',
                start_lat: emp.start_lat,
                start_lon: emp.start_lon,
                end_lat: emp.end_lat,
                end_lon: emp.end_lon,
                distance_km: carDist,
                duration_min: carDuration,
                geometry: carPath?.coords ? this.encodePolyline(carPath.coords) : null
            });

            await new Promise(r => setTimeout(r, 40));
        }

        this.processedRoutes = computedRoutes;

        if (progressText) progressText.innerText = "Calculs terminés ! Envoi du journal...";
        appendLog(`> ✅ ${computedRoutes.length} itinéraires vélo & voiture calculés avec succès !`);
        
        const firstEntry = coordinates[0];
        const destAddress = firstEntry?.employer_address || "Inconnue";
        const destCoords = firstEntry ? `${firstEntry.end_lat}, ${firstEntry.end_lon}` : "N/A";
        
        await this.logSession(destAddress, destCoords);

        this.worker.terminate();

        return { bikeRoutes: computedRoutes, carRoutes: computedCarRoutes };
    }
};
