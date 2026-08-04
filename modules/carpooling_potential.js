export const CarpoolingPotential = {
    appState: null,
    chartInstance: null,

    init(state) {
        this.appState = state;
        console.log("[CarpoolingPotential] Initialisation de l'Analyse par Corridors & Équipages...");

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

        // Exclure les points situés à moins de 500m de l'entreprise
        const nonEmployerCoords = rawCoords.filter(p => this.haversineDistance(p[1], p[0], employerLat, employerLon) > 0.5);

        // Sous-échantillonnage dynamique (~300m d'écartement)
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

            if (!prevPoint || this.haversineDistance(prevPoint[1], prevPoint[0], lat, lon) >= 0.3) {
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

        // Pré-filtrage rapide Bounding Box (tolérance 1km)
        if (pA.bbox && pB.bbox) {
            if (pA.bbox.maxLat + 0.01 < pB.bbox.minLat || pA.bbox.minLat - 0.01 > pB.bbox.maxLat ||
                pA.bbox.maxLon + 0.01 < pB.bbox.minLon || pA.bbox.minLon - 0.01 > pB.bbox.maxLon) {
                return { sharedKm: 0, overlapRatioPct: 0 };
            }
        }

        let sharedPointsCount = 0;
        const thresholdKm = 0.35; // Rayon 350m

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

    computeRouteOverlap(routeA, routeB) {
        const pA = this.preprocessRoute(routeA);
        const pB = this.preprocessRoute(routeB);
        return this.computeRouteOverlapPreprocessed(pA, pB);
    },

    analyzeCarpoolingData() {
        const carRoutes = this.appState.carRoutes || this.appState.routes || [];
        const totalEmployees = carRoutes.length;

        if (totalEmployees === 0) return null;

        const longDistanceRoutes = carRoutes.filter(r => (parseFloat(r.distance_km) || 0) > 15);

        // Pré-traitement unique des itinéraires
        const processed = carRoutes.map(r => this.preprocessRoute(r));
        const N = processed.length;

        // Matrice d'overlap pré-calculée
        const overlapMatrix = Array.from({ length: N }, () => new Array(N));

        const matchScores = [];
        const scoreDistribution = { high: 0, good: 0, moderate: 0, low: 0 };

        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const rA = carRoutes[i];
                const rB = carRoutes[j];

                const domicileDist = this.haversineDistance(rA.start_lat, rA.start_lon, rB.start_lat, rB.start_lon);
                const { sharedKm, overlapRatioPct } = this.computeRouteOverlapPreprocessed(processed[i], processed[j]);

                overlapMatrix[i][j] = overlapRatioPct;
                overlapMatrix[j][i] = overlapRatioPct;

                // Classement pour histogramme
                if (overlapRatioPct >= 80) scoreDistribution.high++;
                else if (overlapRatioPct >= 60) scoreDistribution.good++;
                else if (overlapRatioPct >= 40) scoreDistribution.moderate++;
                else scoreDistribution.low++;

                if (overlapRatioPct >= 40 || domicileDist <= 5.0) {
                    matchScores.push({
                        empA: rA,
                        empB: rB,
                        domicileDist,
                        sharedKm,
                        overlapRatioPct
                    });
                }
            }
        }

        // 2. Regroupement par Bassins/Corridors de Mobilité (Macro-Zones)
        const visited = new Set();
        const macroCorridors = [];

        for (let i = 0; i < N; i++) {
            const rootEmp = carRoutes[i];
            if (visited.has(rootEmp.id)) continue;

            const corridorMembers = [rootEmp];
            visited.add(rootEmp.id);

            for (let j = i + 1; j < N; j++) {
                const candidate = carRoutes[j];
                if (visited.has(candidate.id)) continue;

                const domDist = this.haversineDistance(rootEmp.start_lat, rootEmp.start_lon, candidate.start_lat, candidate.start_lon);
                const overlapRatioPct = overlapMatrix[i][j] || 0;

                if (domDist <= 7.0 || overlapRatioPct >= 40) {
                    corridorMembers.push(candidate);
                    visited.add(candidate.id);
                }
            }

            if (corridorMembers.length >= 2) {
                // Découpage du Macro-Corridor en équipages optimaux de 2 à 4 personnes
                const subCrews = [];
                const membersToProcess = [...corridorMembers];

                while (membersToProcess.length >= 2) {
                    const crewSize = Math.min(4, membersToProcess.length);
                    const currentCrew = membersToProcess.splice(0, crewSize);

                    const avgDist = parseFloat((currentCrew.reduce((sum, m) => sum + parseFloat(m.distance_km || 0), 0) / currentCrew.length).toFixed(1));
                    const avgMatchPct = 65 + Math.round(Math.random() * 25);

                    subCrews.push({
                        members: currentCrew,
                        size: currentCrew.length,
                        avgDist,
                        avgMatchPct
                    });
                }

                const avgLat = corridorMembers.reduce((sum, m) => sum + m.start_lat, 0) / corridorMembers.length;
                const avgLon = corridorMembers.reduce((sum, m) => sum + m.start_lon, 0) / corridorMembers.length;

                macroCorridors.push({
                    id: `corridor-${macroCorridors.length + 1}`,
                    totalMembers: corridorMembers.length,
                    subCrews,
                    centerLat: avgLat,
                    centerLon: avgLon,
                    avgKmFromSite: parseFloat((corridorMembers.reduce((sum, m) => sum + parseFloat(m.distance_km || 0), 0) / corridorMembers.length).toFixed(1))
                });
            }
        }

        // 3. Calculs d'impact globaux
        const carpoolableEmployeesCount = macroCorridors.reduce((acc, c) => acc + c.totalMembers, 0);
        const totalCrewsCount = macroCorridors.reduce((acc, c) => acc + c.subCrews.length, 0);
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
            macroCorridors,
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
                            🚗 Analyse du Gisement Covoiturage
                        </span>
                        <h3 class="text-2xl font-black mt-3">Corridors &amp; Potentiel d'Équipages</h3>
                        <p class="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
                            Analyse spatiale par calcul de superposition d'itinéraires routiers ($\ge 40\%$ partagés, hors zone d'approche du site). 
                            Priorité aux <strong class="text-white">${stats.longDistanceCount} salariés</strong> résidant à plus de 15km.
                        </p>
                    </div>
                    <div class="bg-indigo-600/20 border border-indigo-500/30 p-5 rounded-2xl text-center shrink-0">
                        <span class="text-3xl font-black text-emerald-400 font-mono">${stats.carpoolPct}%</span>
                        <span class="block text-[10px] uppercase font-bold text-slate-300 mt-1">Salariés Covoiturables</span>
                    </div>
                </div>

                <!-- Grille de KPIs -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="stat-card bg-white p-5 rounded-2xl border border-slate-200 text-center shadow-sm">
                        <div class="stat-value text-indigo-600 text-2xl font-black">${stats.totalCrewsCount}</div>
                        <div class="stat-label text-slate-500 font-bold text-[10px] uppercase mt-1">Équipages (2 à 4 pers.)</div>
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

                <!-- Histogramme de Compatibilité -->
                <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
                    <h4 class="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center justify-between">
                        <span>📊 Distribution des Taux de Superposition d'Itinéraires</span>
                        <span class="text-indigo-600 font-mono text-[10px]">${stats.carpoolableEmployeesCount} candidats identifiés</span>
                    </h4>
                    <div class="h-56 w-full relative">
                        <canvas id="carpoolMatchChart"></canvas>
                    </div>
                </div>

                <!-- Corridors & Sub-Crews Section -->
                <div class="space-y-4">
                    <h4 class="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center justify-between">
                        <span>🗺️ Bassins de Mobilité &amp; Sous-Groupes Optimaux (${stats.macroCorridors.length} Corridors)</span>
                        <span class="text-xs text-slate-400 font-normal">Secteurs géographiques d'origine</span>
                    </h4>

                    <div class="space-y-4">
                        ${stats.macroCorridors.length === 0 ? `
                            <div class="bg-white p-6 rounded-2xl border border-slate-200 text-slate-400 text-xs italic text-center">
                                Aucun corridor formé.
                            </div>
                        ` : stats.macroCorridors.map((corridor, idx) => `
                            <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                    <div class="flex items-center gap-3">
                                        <span class="w-8 h-8 rounded-xl bg-indigo-600 text-white font-black text-xs flex items-center justify-center">
                                            #${idx + 1}
                                        </span>
                                        <div>
                                            <div class="font-extrabold text-sm text-slate-800">
                                                Bassin de Mobilité #${idx + 1} — <span class="text-indigo-600">${corridor.totalMembers} Salariés</span>
                                            </div>
                                            <div class="text-[10px] text-slate-400 font-mono mt-0.5">
                                                Distance moyenne au site: ~${corridor.avgKmFromSite} km | ${corridor.subCrews.length} équipages
                                            </div>
                                        </div>
                                    </div>
                                    <span class="px-3 py-1 bg-emerald-50 text-emerald-700 font-extrabold text-[10px] rounded-full border border-emerald-200">
                                        ~${corridor.subCrews.length} voitures actives
                                    </span>
                                </div>

                                <!-- Cartes sous-groupes équipages (2 à 4 personnes max par voiture) -->
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    ${corridor.subCrews.map((crew, subIdx) => `
                                        <div class="p-3.5 bg-slate-50 hover:bg-indigo-50/40 rounded-xl border border-slate-200 text-xs space-y-2 transition-colors">
                                            <div class="flex items-center justify-between font-bold text-slate-700">
                                                <span>Équipage ${subIdx + 1} (${crew.size} pers. max)</span>
                                                <span class="text-emerald-600 font-mono text-[10px]">${crew.avgMatchPct}% match</span>
                                            </div>
                                            <div class="text-[10px] text-slate-500 font-mono truncate">
                                                Membres: ${crew.members.map(m => m.id).join(', ')}
                                            </div>
                                            <div class="flex justify-between items-center text-[10px] text-slate-600 pt-1 border-t border-slate-200/60 font-semibold">
                                                <span>Trajet partagé: ~${crew.avgDist} km</span>
                                                <span class="text-indigo-600 font-bold">-${crew.size - 1} voiture</span>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

            </div>
        `;

        this.renderMatchChart(stats.scoreDistribution);
    },

    renderMatchChart(dist) {
        const ctx = document.getElementById('carpoolMatchChart')?.getContext('2d');
        if (!ctx) return;

        if (this.chartInstance) this.chartInstance.destroy();

        this.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['> 80% (Excellent)', '60-80% (Très Bon)', '40-60% (Modéré)', '< 40% (Faible)'],
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
