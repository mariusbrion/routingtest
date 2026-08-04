export const CarpoolingPotential = {
    appState: null,
    chartInstance: null,
    mapInstance: null,
    corridorLayers: [],
    colorPalette: ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'],

    init(state) {
        this.appState = state;
        console.log("[CarpoolingPotential] Initialisation du Diagnostic de Covoiturage Ciblé...");

        const container = document.getElementById('carpooling-dashboard');
        if (!container) return;

        this.renderDashboard(container);
    },

    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(1 - Math.min(1, Math.max(0, a))));
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

    preprocessRoute(route) {
        let rawCoords = [];
        if (route.geometry) {
            rawCoords = this.decodePolyline(route.geometry);
        } else if (route.start_lon && route.start_lat && route.end_lon && route.end_lat) {
            rawCoords = [[route.start_lon, route.start_lat], [route.end_lon, route.end_lat]];
        }

        if (!rawCoords || rawCoords.length === 0) {
            return { route, filteredCoords: [], bbox: null };
        }

        const employerLat = route.end_lat;
        const employerLon = route.end_lon;

        // Strict: Exclure les 800m avant le site employeur pour éliminer le biais de convergence finale
        const nonEmployerCoords = rawCoords.filter(p => this.haversineDistance(p[1], p[0], employerLat, employerLon) > 0.8);

        const filteredCoords = [];
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        let prevPoint = null;

        for (const p of nonEmployerCoords) {
            const lat = p[1];
            const lon = p[0];
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;

            if (!prevPoint || this.haversineDistance(prevPoint[1], prevPoint[0], lat, lon) >= 0.35) {
                filteredCoords.push(p);
                prevPoint = p;
            }
        }

        return {
            route,
            filteredCoords,
            bbox: { minLat, maxLat, minLon, maxLon }
        };
    },

    computeRouteOverlapPreprocessed(pA, pB) {
        const coordsA = pA.filteredCoords;
        const coordsB = pB.filteredCoords;

        if (!coordsA || !coordsB || coordsA.length === 0 || coordsB.length === 0) {
            return { sharedKm: 0, overlapRatioPct: 0 };
        }

        if (pA.bbox && pB.bbox) {
            if (pA.bbox.maxLat + 0.015 < pB.bbox.minLat || pA.bbox.minLat - 0.015 > pB.bbox.maxLat ||
                pA.bbox.maxLon + 0.015 < pB.bbox.minLon || pA.bbox.minLon - 0.015 > pB.bbox.maxLon) {
                return { sharedKm: 0, overlapRatioPct: 0 };
            }
        }

        let sharedPointsCount = 0;
        const thresholdKm = 0.4; // 400m tolerance

        coordsA.forEach(ptA => {
            const isNear = coordsB.some(ptB => this.haversineDistance(ptA[1], ptA[0], ptB[1], ptB[0]) <= thresholdKm);
            if (isNear) sharedPointsCount++;
        });

        const ratioA = sharedPointsCount / coordsA.length;
        const distA = parseFloat(pA.route.distance_km || 0);
        const distB = parseFloat(pB.route.distance_km || 0);
        const minDistance = Math.min(distA, distB);

        const sharedKm = parseFloat((minDistance * ratioA).toFixed(1));
        const overlapRatioPct = Math.round(ratioA * 100);

        return { sharedKm, overlapRatioPct };
    },

    analyzeCarpoolingData() {
        const carRoutes = this.appState.carRoutes || this.appState.routes || [];
        const totalEmployees = carRoutes.length;

        if (totalEmployees === 0) return null;

        // Priorité absolue aux longs trajets (> 15km)
        const longDistanceRoutes = carRoutes.filter(r => (parseFloat(r.distance_km) || 0) >= 15);

        // Preprocessing des itinéraires
        const processed = carRoutes.map(r => this.preprocessRoute(r));
        const N = processed.length;

        const overlapMatrix = Array.from({ length: N }, () => new Array(N));
        const scoreDistribution = { high: 0, good: 0, moderate: 0, low: 0 };

        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const rA = carRoutes[i];
                const rB = carRoutes[j];

                const distA = parseFloat(rA.distance_km || 0);
                const distB = parseFloat(rB.distance_km || 0);
                const minDistance = Math.min(distA, distB);

                const domicileDist = this.haversineDistance(rA.start_lat, rA.start_lon, rB.start_lat, rB.start_lon);
                const { sharedKm, overlapRatioPct } = this.computeRouteOverlapPreprocessed(processed[i], processed[j]);

                overlapMatrix[i][j] = overlapRatioPct;
                overlapMatrix[j][i] = overlapRatioPct;

                // Restrindre les trajets ultra-courts (< 5km) sauf si match exceptionnel (>= 80%)
                if (minDistance < 5.0 && overlapRatioPct < 80) {
                    continue;
                }

                if (overlapRatioPct >= 80) scoreDistribution.high++;
                else if (overlapRatioPct >= 60) scoreDistribution.good++;
                else if (overlapRatioPct >= 40) scoreDistribution.moderate++;
                else scoreDistribution.low++;
            }
        }

        const visited = new Set();
        const affinityPools = [];

        // Trier les employés candidats du plus éloigné au plus proche pour privilégier les trajets structurants
        const sortedIndices = Array.from({ length: N }, (_, idx) => idx)
            .sort((a, b) => (parseFloat(carRoutes[b].distance_km) || 0) - (parseFloat(carRoutes[a].distance_km) || 0));

        for (const i of sortedIndices) {
            const rootEmp = carRoutes[i];
            const rootDist = parseFloat(rootEmp.distance_km || 0);

            // Ne pas créer de pool pour des employés habitant à moins de 4km du lieu de travail
            if (rootDist < 4.0 || visited.has(rootEmp.id)) continue;

            const poolMembers = [rootEmp];

            for (const j of sortedIndices) {
                if (i === j) continue;
                const candidate = carRoutes[j];
                if (visited.has(candidate.id)) continue;

                const candDist = parseFloat(candidate.distance_km || 0);
                if (candDist < 4.0) continue;

                const domDist = this.haversineDistance(rootEmp.start_lat, rootEmp.start_lon, candidate.start_lat, candidate.start_lon);
                const overlapRatioPct = overlapMatrix[i][j] || 0;

                // Condition de regroupement en Bassin d'Affinité (Domicile < 6km OU overlap > 50%)
                if ((domDist <= 6.0 && overlapRatioPct >= 35) || overlapRatioPct >= 55) {
                    poolMembers.push(candidate);
                }
            }

            if (poolMembers.length >= 2) {
                poolMembers.forEach(m => visited.add(m.id));

                const avgDist = parseFloat((poolMembers.reduce((sum, m) => sum + parseFloat(m.distance_km || 0), 0) / poolMembers.length).toFixed(1));

                // Calcul du score d'impact stratégique : Distance moyenne * Taille du gisement
                const strategicScore = avgDist * poolMembers.length;

                // Découpage interne en voitures de 2 à 4 personnes (Sub-crews)
                const subCrews = [];
                const membersToProcess = [...poolMembers];

                while (membersToProcess.length >= 2) {
                    const crewSize = Math.min(4, membersToProcess.length);
                    const currentCrew = membersToProcess.splice(0, crewSize);

                    const crewAvgDist = parseFloat((currentCrew.reduce((sum, m) => sum + parseFloat(m.distance_km || 0), 0) / currentCrew.length).toFixed(1));

                    subCrews.push({
                        members: currentCrew,
                        size: currentCrew.length,
                        avgDist: crewAvgDist
                    });
                }

                const avgLat = poolMembers.reduce((sum, m) => sum + m.start_lat, 0) / poolMembers.length;
                const avgLon = poolMembers.reduce((sum, m) => sum + m.start_lon, 0) / poolMembers.length;

                affinityPools.push({
                    id: `pool-${affinityPools.length + 1}`,
                    poolMembers,
                    totalMembers: poolMembers.length,
                    subCrews,
                    centerLat: avgLat,
                    centerLon: avgLon,
                    avgKmFromSite: avgDist,
                    strategicScore
                });
            }
        }

        // Tri prioritaire des pools : Les trajets les plus longs avec le plus grand gisement en premier !
        affinityPools.sort((a, b) => b.strategicScore - a.strategicScore);

        const carpoolableEmployeesCount = affinityPools.reduce((acc, c) => acc + c.totalMembers, 0);
        const totalCrewsCount = affinityPools.reduce((acc, c) => acc + c.subCrews.length, 0);
        const carsRemoved = Math.max(0, carpoolableEmployeesCount - totalCrewsCount);

        const avgKmGlobal = carRoutes.reduce((acc, r) => acc + (parseFloat(r.distance_km) || 0), 0) / (totalEmployees || 1);
        const annualKmSaved = carsRemoved * (avgKmGlobal * 2 * 220); // 220 jours A/R
        const co2SavedTons = (annualKmSaved * 0.000192).toFixed(1);
        const financialSavingsTotal = Math.round(annualKmSaved * 0.25);

        return {
            totalEmployees,
            longDistanceCount: longDistanceRoutes.length,
            carpoolableEmployeesCount,
            totalCrewsCount,
            carsRemoved,
            co2SavedTons,
            financialSavingsTotal,
            carpoolPct: parseFloat(((carpoolableEmployeesCount / totalEmployees) * 100).toFixed(1)),
            affinityPools,
            scoreDistribution
        };
    },

    renderDashboard(container) {
        const stats = this.analyzeCarpoolingData();

        if (!stats) {
            container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs font-bold">Aucune donnée voiture disponible.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="space-y-8 max-w-5xl mx-auto">
                
                <!-- En-tête / Bannière Covoiturage -->
                <div class="bg-slate-900 text-white rounded-3xl p-8 shadow-xl border border-slate-800 flex flex-wrap justify-between items-center gap-6">
                    <div>
                        <span class="text-[10px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
                            🚗 Gisements d'Affinité &amp; Corridors Strategiques
                        </span>
                        <h3 class="text-2xl font-black mt-3">Analyse Prioritaire des Longs Trajets</h3>
                        <p class="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
                            Priorité absolue aux <strong class="text-emerald-400">${stats.longDistanceCount} salariés</strong> résidant à plus de 15km. 
                            Exclusion des trajets ultra-courts (< 5km) pour se concentrer sur le gisement à fort impact environnemental et financier.
                        </p>
                    </div>
                    <div class="bg-indigo-600/20 border border-indigo-500/30 p-5 rounded-2xl text-center shrink-0">
                        <span class="text-3xl font-black text-emerald-400 font-mono">${stats.carpoolPct}%</span>
                        <span class="block text-[10px] uppercase font-bold text-slate-300 mt-1">Potentiel Réseau Mobilisable</span>
                    </div>
                </div>

                <!-- Grille de KPIs -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="stat-card bg-white p-5 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <div class="stat-value text-indigo-600 text-2xl font-black">${stats.affinityPools.length}</div>
                        <div class="stat-label text-slate-500 font-bold text-[10px] uppercase mt-1">Gisements d'Origine</div>
                    </div>
                    <div class="stat-card bg-white p-5 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <div class="stat-value text-emerald-600 text-2xl font-black">-${stats.carsRemoved}</div>
                        <div class="stat-label text-slate-500 font-bold text-[10px] uppercase mt-1">Voitures Évitées / Jour</div>
                    </div>
                    <div class="stat-card bg-white p-5 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <div class="stat-value text-teal-600 text-2xl font-black">${stats.co2SavedTons} t</div>
                        <div class="stat-label text-slate-500 font-bold text-[10px] uppercase mt-1">CO2 Économisé / An</div>
                    </div>
                    <div class="stat-card bg-white p-5 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <div class="stat-value text-indigo-600 text-2xl font-black">${stats.financialSavingsTotal.toLocaleString()} €</div>
                        <div class="stat-label text-slate-500 font-bold text-[10px] uppercase mt-1">Gain Financier / An</div>
                    </div>
                </div>

                <!-- Carte Interactive des Gisements d'Origine -->
                <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <h4 class="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
                            <span>🗺️ Cartographie des Gisements d'Origine (Hors zone employeur)</span>
                        </h4>
                        <span class="text-[10px] bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full border border-indigo-200 font-bold">
                            Cliquer sur une fiche pour centrer le gisement
                        </span>
                    </div>

                    <div class="relative w-full h-[460px] rounded-2xl overflow-hidden border border-slate-200">
                        <div id="carpooling-map" class="w-full h-full z-0"></div>
                    </div>
                </div>

                <!-- Histogramme de Compatibilité -->
                <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                    <h4 class="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center justify-between">
                        <span>📊 Distribution du Taux de Superposition d'Itinéraires</span>
                        <span class="text-indigo-600 font-mono text-[10px]">${stats.carpoolableEmployeesCount} candidats covoiturables</span>
                    </h4>
                    <div class="h-56 w-full relative">
                        <canvas id="carpoolMatchChart"></canvas>
                    </div>
                </div>

                <!-- Detailed Pools Section -->
                <div class="space-y-4">
                    <h4 class="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center justify-between">
                        <span>🚘 Gisements d'Affinité &amp; Compositions de Voitures (${stats.affinityPools.length} Pools Classés par Impact)</span>
                        <span class="text-xs text-slate-400 font-normal">Triés par distance &amp; taille de gisement</span>
                    </h4>

                    <div class="space-y-5">
                        ${stats.affinityPools.length === 0 ? `
                            <div class="bg-white p-6 rounded-2xl border border-slate-200 text-slate-400 text-xs italic text-center">
                                Aucun gisement significatif formé.
                            </div>
                        ` : stats.affinityPools.map((pool, idx) => {
                            const poolColor = this.colorPalette[idx % this.colorPalette.length];
                            return `
                            <div id="corridor-card-${idx}" 
                                 onclick="window.CarpoolingPotential.focusCorridor(${idx})"
                                 class="bg-white hover:bg-slate-50/90 rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4 cursor-pointer transition-all border-l-8"
                                 style="border-left-color: ${poolColor}">
                                
                                <!-- Entête du Pool / Gisement -->
                                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                                    <div class="flex items-center gap-3">
                                        <span class="w-9 h-9 rounded-xl text-white font-black text-sm flex items-center justify-center shadow-sm"
                                              style="background-color: ${poolColor}">
                                            #${idx + 1}
                                        </span>
                                        <div>
                                            <div class="font-extrabold text-base text-slate-800 flex items-center gap-2">
                                                <span>Gisement d'Affinité #${idx + 1}</span>
                                                <span class="text-xs px-2.5 py-0.5 rounded-full font-bold text-white shadow-xs" style="background-color: ${poolColor}">
                                                    ${pool.totalMembers} Salariés Compatibles
                                                </span>
                                            </div>
                                            <div class="text-xs text-slate-500 font-mono mt-0.5">
                                                Distance moyenne: <strong class="text-slate-700">${pool.avgKmFromSite} km</strong> | Possibilité de composer ${pool.subCrews.length} voitures
                                            </div>
                                        </div>
                                    </div>
                                    <span class="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs rounded-full border border-indigo-200 transition-colors">
                                        🎯 Voir le Gisement sur la carte
                                    </span>
                                </div>

                                <!-- Vue de la Composition des Voitures Recommandées (Sub-Crews) -->
                                <div>
                                    <div class="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                                        🚗 Proposition de Répartition en Équipages (2 à 4 pers. max) :
                                    </div>
                                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        ${pool.subCrews.map((crew, subIdx) => `
                                            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                                                <div class="flex items-center justify-between font-bold text-slate-700">
                                                    <span>Voiture ${subIdx + 1} (${crew.size} places)</span>
                                                    <span class="text-emerald-600 font-mono text-[10px]">-${crew.size - 1} auto</span>
                                                </div>
                                                <div class="text-[10px] text-slate-500 font-mono truncate">
                                                    Membres: ${crew.members.map(m => m.id).join(', ')}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>

                            </div>
                        `}).join('')}
                    </div>
                </div>

            </div>
        `;

        this.renderMatchChart(stats.scoreDistribution);

        setTimeout(() => {
            this.initCarpoolMap(stats);
        }, 150);
    },

    initCarpoolMap(stats) {
        if (typeof L === 'undefined') return;

        const container = document.getElementById('carpooling-map');
        if (!container) return;

        if (this.mapInstance) {
            this.mapInstance.remove();
            this.mapInstance = null;
        }

        this.mapInstance = L.map('carpooling-map', { zoomControl: false });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            maxZoom: 19
        }).addTo(this.mapInstance);
        L.control.zoom({ position: 'bottomleft' }).addTo(this.mapInstance);

        this.corridorLayers = [];
        const allBounds = [];

        // Marker Site Employeur uniquement (Aucun cercle autour !)
        if (this.appState && this.appState.coordinates && this.appState.coordinates.length > 0) {
            const first = this.appState.coordinates[0];
            const siteIcon = L.divIcon({
                html: `<div class="company-marker text-3xl">🏢</div>`,
                className: '',
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });
            L.marker([first.end_lat, first.end_lon], { icon: siteIcon })
                .bindPopup(`<div class="font-bold text-xs">🏢 Site Employeur</div>`)
                .addTo(this.mapInstance);
            allBounds.push([first.end_lat, first.end_lon]);
        }

        stats.affinityPools.forEach((pool, idx) => {
            const color = this.colorPalette[idx % this.colorPalette.length];
            const groupFeatureList = [];

            const memberCoords = [];
            pool.subCrews.forEach(crew => {
                crew.members.forEach(emp => {
                    memberCoords.push([emp.start_lat, emp.start_lon]);
                    allBounds.push([emp.start_lat, emp.start_lon]);

                    // Marker salarié coloré aux couleurs du pool
                    const empIcon = L.divIcon({
                        html: `<div style="background-color: ${color}; border: 2px solid white;" class="w-5 h-5 rounded-full shadow-md flex items-center justify-center text-[9px] text-white font-black">${idx + 1}</div>`,
                        className: '',
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });

                    const m = L.marker([emp.start_lat, emp.start_lon], { icon: empIcon })
                        .bindPopup(`<div class="text-xs"><strong>${emp.id}</strong><br>Gisement #${idx + 1}<br>Distance: ${emp.distance_km || '?'} km</div>`)
                        .addTo(this.mapInstance);

                    groupFeatureList.push(m);

                    // Ligne pointillée vers l'entreprise
                    if (emp.end_lat && emp.end_lon) {
                        const line = L.polyline([[emp.start_lat, emp.start_lon], [emp.end_lat, emp.end_lon]], {
                            color: color,
                            weight: 2,
                            opacity: 0.5,
                            dashArray: '5, 5'
                        }).addTo(this.mapInstance);
                        groupFeatureList.push(line);
                    }
                });
            });

            // Enveloppe uniquement autour des domiciles d'ORIGINE (Gisement d'origine)
            if (memberCoords.length >= 2) {
                const avgLat = memberCoords.reduce((sum, c) => sum + c[0], 0) / memberCoords.length;
                const avgLon = memberCoords.reduce((sum, c) => sum + c[1], 0) / memberCoords.length;

                let maxDist = 1.0;
                memberCoords.forEach(c => {
                    const d = this.haversineDistance(avgLat, avgLon, c[0], c[1]);
                    if (d > maxDist) maxDist = d;
                });

                const clusterZone = L.circle([avgLat, avgLon], {
                    radius: Math.min(maxDist * 1000, 5000),
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.18,
                    weight: 2,
                    dashArray: '4, 4'
                }).bindPopup(`<div class="font-bold text-xs text-indigo-900">Gisement d'Origine #${idx + 1} (${pool.totalMembers} salariés)</div>`)
                  .addTo(this.mapInstance);

                groupFeatureList.push(clusterZone);
            }

            this.corridorLayers.push({
                corridorId: pool.id,
                layers: groupFeatureList,
                bounds: memberCoords
            });
        });

        if (allBounds.length > 0) {
            this.mapInstance.fitBounds(allBounds, { padding: [35, 35] });
        }
    },

    focusCorridor(idx) {
        const item = this.corridorLayers[idx];
        if (!item || !this.mapInstance || !item.bounds || item.bounds.length === 0) return;

        this.mapInstance.fitBounds(item.bounds, { padding: [60, 60], maxZoom: 14 });

        document.querySelectorAll('[id^="corridor-card-"]').forEach((c, i) => {
            c.classList.toggle('ring-2', i === idx);
            c.classList.toggle('ring-indigo-500', i === idx);
        });
    },

    renderMatchChart(dist) {
        const ctx = document.getElementById('carpoolMatchChart')?.getContext('2d');
        if (!ctx) return;

        if (this.chartInstance) this.chartInstance.destroy();

        this.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['> 80% (Excellente)', '60-80% (Très Bonne)', '40-60% (Modérée)', '< 40% (Exclue)'],
                datasets: [{
                    data: [dist.high, dist.good, dist.moderate, dist.low],
                    backgroundColor: ['#10b981', '#6366f1', '#f59e0b', '#cbd5e1'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
};
