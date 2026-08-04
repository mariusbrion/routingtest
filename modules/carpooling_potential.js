export const CarpoolingPotential = {
    appState: null,
    CLUSTER_RADIUS_KM: 3.5, // Distance maximale entre domiciles pour former un équipage

    init(state) {
        this.appState = state;
        console.log("[CarpoolingPotential] Initialisation du module Covoiturage...");
        
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

    analyzeCarpoolingData() {
        const carRoutes = this.appState.carRoutes || this.appState.routes || [];
        const totalEmployees = carRoutes.length;

        if (totalEmployees === 0) return null;

        // 1. Segmentation par tranches de distance
        const longDistanceRoutes = carRoutes.filter(r => (parseFloat(r.distance_km) || 0) > 15);
        const mediumDistanceRoutes = carRoutes.filter(r => {
            const d = parseFloat(r.distance_km) || 0;
            return d > 5 && d <= 15;
        });

        // 2. Clustering par proximité géographique des domiciles (rayon 3.5 km)
        const visited = new Set();
        const clusters = [];

        for (let i = 0; i < carRoutes.length; i++) {
            if (visited.has(carRoutes[i].id)) continue;

            const currentCluster = [carRoutes[i]];
            visited.add(carRoutes[i].id);

            for (let j = i + 1; j < carRoutes.length; j++) {
                if (visited.has(carRoutes[j].id)) continue;

                const dist = this.haversineDistance(
                    carRoutes[i].start_lat, carRoutes[i].start_lon,
                    carRoutes[j].start_lat, carRoutes[j].start_lon
                );

                if (dist <= this.CLUSTER_RADIUS_KM) {
                    currentCluster.push(carRoutes[j]);
                    visited.add(carRoutes[j].id);
                }
            }

            if (currentCluster.length >= 2) {
                clusters.push(currentCluster);
            }
        }

        // 3. Métriques d'impact covoiturage
        const carpoolableEmployeesCount = clusters.reduce((acc, c) => acc + c.length, 0);
        const potentialCrewsCount = clusters.length;
        const potentialCarsRemoved = Math.max(0, carpoolableEmployeesCount - potentialCrewsCount);

        // Estimation annuelle (220 jours travaillés A/R)
        const avgKm = carRoutes.reduce((acc, r) => acc + (parseFloat(r.distance_km) || 0), 0) / (totalEmployees || 1);
        const annualKmSaved = potentialCarsRemoved * (avgKm * 2 * 220);
        const co2SavedTons = (annualKmSaved * 0.000192).toFixed(1); // 192g CO2/km
        const financialSavingsTotal = Math.round(annualKmSaved * 0.25); // 0.25€/km partagé

        return {
            totalEmployees,
            longDistanceCount: longDistanceRoutes.length,
            mediumDistanceCount: mediumDistanceRoutes.length,
            clusters,
            carpoolableEmployeesCount,
            potentialCrewsCount,
            potentialCarsRemoved,
            co2SavedTons,
            financialSavingsTotal,
            carpoolPct: parseFloat(((carpoolableEmployeesCount / totalEmployees) * 100).toFixed(1))
        };
    },

    renderDashboard(container) {
        const stats = this.analyzeCarpoolingData();
        if (!stats) {
            container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs font-bold">Aucune donnée voiture disponible.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="space-y-6">
                <!-- Banner Résumé Covoiturage -->
                <div class="bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-indigo-500/20">
                    <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
                        <div>
                            <span class="text-[10px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
                                🚗 Analyse du Gisement Covoiturage
                            </span>
                            <h3 class="text-xl font-black mt-2">Potentiel d'Équipages &amp; Report Modal</h3>
                        </div>
                        <div class="text-right">
                            <span class="text-2xl font-black text-emerald-400 font-mono">${stats.carpoolPct}%</span>
                            <span class="block text-[10px] uppercase font-bold text-slate-400">Salariés Covoiturables</span>
                        </div>
                    </div>
                    <p class="text-xs text-slate-300 leading-relaxed max-w-2xl">
                        Analyse spatiale basée sur la proximité des domiciles ($\le$ ${this.CLUSTER_RADIUS_KM}km) et les parcours routiers partagés. 
                        Le covoiturage cible prioritairement les <strong class="text-white">${stats.longDistanceCount} salariés</strong> résidant à plus de 15km de l'entreprise.
                    </p>
                </div>

                <!-- Grille de KPIs Covoiturage -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="stat-card bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                        <div class="stat-value text-indigo-600">${stats.potentialCrewsCount}</div>
                        <div class="stat-label">Équipages Potentiels</div>
                    </div>
                    <div class="stat-card bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                        <div class="stat-value text-emerald-600">-${stats.potentialCarsRemoved}</div>
                        <div class="stat-label">Voitures Évitées / Jour</div>
                    </div>
                    <div class="stat-card bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                        <div class="stat-value text-teal-600">${stats.co2SavedTons} t</div>
                        <div class="stat-label">CO2 Économisé / An</div>
                    </div>
                    <div class="stat-card bg-slate-50 border border-slate-200 p-4 rounded-xl text-center">
                        <div class="stat-value text-indigo-600">${stats.financialSavingsTotal.toLocaleString()} €</div>
                        <div class="stat-label">Gain Financier Global / An</div>
                    </div>
                </div>

                <!-- Liste des Équipages Suggérés -->
                <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
                    <h4 class="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center justify-between">
                        <span>Équipages de Proximité Suggérés (Domiciles &lt; ${this.CLUSTER_RADIUS_KM}km)</span>
                        <span class="text-indigo-600 font-mono text-[10px]">${stats.clusters.length} groupes formés</span>
                    </h4>

                    <div class="max-h-60 overflow-y-auto space-y-2 text-xs custom-scrollbar pr-1">
                        ${stats.clusters.length === 0 ? `
                            <div class="text-slate-400 italic text-[11px] py-2">Aucun équipage formé dans un rayon de ${this.CLUSTER_RADIUS_KM}km.</div>
                        ` : stats.clusters.map((c, idx) => `
                            <div class="p-3 bg-slate-50 hover:bg-indigo-50/50 rounded-xl border border-slate-200 flex items-center justify-between transition-colors">
                                <div class="flex items-center gap-3">
                                    <span class="w-6 h-6 rounded-full bg-indigo-600 text-white font-black text-[10px] flex items-center justify-center shrink-0">
                                        #${idx + 1}
                                    </span>
                                    <div>
                                        <div class="font-bold text-slate-800">${c.length} Salariés regroupés</div>
                                        <div class="text-[10px] text-slate-500 font-mono">
                                            Membres: ${c.map(m => m.id).join(', ')}
                                        </div>
                                    </div>
                                </div>
                                <span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-lg border border-emerald-200">
                                    ~${(c.reduce((acc, r) => acc + parseFloat(r.distance_km || 0), 0) / c.length).toFixed(1)} km du site
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }
};
