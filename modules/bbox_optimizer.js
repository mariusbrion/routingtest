/**
 * bbox_optimizer.js - Module de calcul BBOX & Interrogation IGN Géoplateforme WFS
 * Génère des cartes pop-up modernes à droite de l'écran avec les 3 métriques essentielles :
 * 1. Nombre d'employés exclus (%)
 * 2. Gain de surface en %
 * 3. Temps estimé de traitement
 */

export const BboxOptimizer = {
    map: null,
    company: null,       // { lat, lng }
    employees: [],       // [{ id, lat, lng, distKm, marker }]
    bboxLayer: null,
    scenariosData: [],
    onSelectCallback: null,

    SAFETY_BUFFER_KM: 2.0,   // Buffer +2 km
    CHUNK_SIZE: 2500,        // 2500 entités
    CHUNK_DELAY_MS: 800,     // toutes les 800 ms

    init(mapContainerId, coordinates, onSelectCallback) {
        this.onSelectCallback = onSelectCallback;
        this.company = coordinates.company;

        const popupsContainer = document.getElementById('bbox-popups-container');
        if (popupsContainer) popupsContainer.innerHTML = '';

        if (!this.map) {
            this.map = L.map(mapContainerId, { zoomControl: false }).setView([this.company.lat, this.company.lng], 11);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap &copy; CARTO',
                maxZoom: 19
            }).addTo(this.map);
            L.control.zoom({ position: 'bottomleft' }).addTo(this.map);
        } else {
            this.map.setView([this.company.lat, this.company.lng], 11);
        }

        setTimeout(() => {
            this.map.invalidateSize();
        }, 100);

        this.renderMarkers(coordinates.employees);
    },

    renderMarkers(rawEmployees) {
        // Marqueur Entreprise
        const companyIcon = L.divIcon({
            html: `<div class="company-marker text-3xl">🏢</div>`,
            className: '',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
        L.marker([this.company.lat, this.company.lng], { icon: companyIcon }).addTo(this.map);

        // Distance Haversine & Marqueurs Employés
        this.employees = rawEmployees.map(emp => {
            const distKm = this.haversineDistance(this.company.lat, this.company.lng, emp.lat, emp.lng);
            const icon = L.divIcon({
                html: `<div class="emp-marker w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-md"></div>`,
                className: '',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });
            const marker = L.marker([emp.lat, emp.lng], { icon }).addTo(this.map);
            return { ...emp, distKm, marker };
        });

        // Trier du plus proche au plus éloigné
        this.employees.sort((a, b) => a.distKm - b.distKm);

        const group = L.featureGroup([
            L.marker([this.company.lat, this.company.lng]),
            ...this.employees.map(e => e.marker)
        ]);
        this.map.fitBounds(group.getBounds().pad(0.12));
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

    computeBbox(keptEmployees) {
        const points = [this.company, ...keptEmployees];
        const minLat = Math.min(...points.map(p => p.lat));
        const maxLat = Math.max(...points.map(p => p.lat));
        const minLng = Math.min(...points.map(p => p.lng));
        const maxLng = Math.max(...points.map(p => p.lng));

        const latBuffer = this.SAFETY_BUFFER_KM / 111.32;
        const midLat = (minLat + maxLat) / 2;
        const lngBuffer = this.SAFETY_BUFFER_KM / (111.32 * Math.cos(midLat * Math.PI / 180));

        const bbox = {
            minLat: minLat - latBuffer,
            maxLat: maxLat + latBuffer,
            minLng: minLng - lngBuffer,
            maxLng: maxLng + lngBuffer
        };

        const heightKm = (bbox.maxLat - bbox.minLat) * 111.32;
        const widthKm = (bbox.maxLng - bbox.minLng) * (111.32 * Math.cos(midLat * Math.PI / 180));
        bbox.areaKm2 = widthKm * heightKm;

        return bbox;
    },

    async fetchWfsHits(bbox) {
        const baseUrl = "https://data.geopf.fr/wfs/ows";
        const bboxStr = `${bbox.minLat.toFixed(6)},${bbox.minLng.toFixed(6)},${bbox.maxLat.toFixed(6)},${bbox.maxLng.toFixed(6)},urn:ogc:def:crs:EPSG::4326`;

        const params = new URLSearchParams({
            service: "WFS",
            version: "2.0.0",
            request: "GetFeature",
            typeNames: "BDTOPO_V3:troncon_de_route",
            bbox: bboxStr,
            resultType: "hits"
        });

        try {
            const response = await fetch(`${baseUrl}?${params.toString()}`);
            if (!response.ok) throw new Error("WFS hit error");
            const xmlText = await response.text();
            
            const match = xmlText.match(/numberMatched="(\d+)"/i);
            return match ? parseInt(match[1], 10) : Math.round(bbox.areaKm2 * 180);
        } catch (e) {
            return Math.round(bbox.areaKm2 * 180);
        }
    },

    async startScan() {
        const statusBadge = document.getElementById('bbox-status-badge');
        if (statusBadge) {
            statusBadge.classList.remove('hidden');
            statusBadge.innerText = '⏳ Scan WFS en cours...';
        }

        const totalEmp = this.employees.length;
        const percentSteps = [0, 1, 2, 3, 5, 10, 15, 20];
        const uniqueCounts = new Set();
        const scenarioConfigs = [];

        percentSteps.forEach(pct => {
            const excludeCount = Math.floor((pct / 100) * totalEmp);
            if (!uniqueCounts.has(excludeCount) && excludeCount < totalEmp) {
                uniqueCounts.add(excludeCount);
                scenarioConfigs.push({
                    pctRequested: pct,
                    excludeCount,
                    keepCount: totalEmp - excludeCount,
                    realPctExcluded: ((excludeCount / totalEmp) * 100).toFixed(1)
                });
            }
        });

        this.scenariosData = [];
        let baseArea = 0;
        let hasCriticalVolume = false;

        for (let i = 0; i < scenarioConfigs.length; i++) {
            const config = scenarioConfigs[i];
            const kept = this.employees.slice(0, config.keepCount);
            const bbox = this.computeBbox(kept);

            if (i === 0) baseArea = bbox.areaKm2;

            const areaReductionPct = baseArea > 0 ? (((baseArea - bbox.areaKm2) / baseArea) * 100) : 0;
            const featureCount = await this.fetchWfsHits(bbox);

            if (featureCount >= 1000000) hasCriticalVolume = true;

            const estimatedSec = Math.ceil(featureCount / this.CHUNK_SIZE) * (this.CHUNK_DELAY_MS / 1000);

            this.scenariosData.push({
                id: i,
                config,
                bbox,
                keptEmployees: kept,
                excludedCount: config.excludeCount,
                realPctExcluded: config.realPctExcluded,
                areaReductionPct: areaReductionPct.toFixed(1),
                featureCount,
                estimatedSec,
                isRecommended: false
            });
        }

        this.evaluateOptimalOption();
        this.renderRightPopups();

        const warn = document.getElementById('volume-warning');
        if (warn) {
            warn.classList.toggle('hidden', !hasCriticalVolume);
            warn.classList.toggle('flex', hasCriticalVolume);
        }

        if (statusBadge) statusBadge.innerText = '✅ Scan Terminé';

        const recIndex = this.scenariosData.findIndex(s => s.isRecommended);
        this.selectScenario(recIndex >= 0 ? recIndex : 0);
    },

    evaluateOptimalOption() {
        if (this.scenariosData.length === 1) {
            this.scenariosData[0].isRecommended = true;
            return;
        }

        let bestScore = -1;
        let bestIndex = 0;

        this.scenariosData.forEach((sc, idx) => {
            const pctEx = parseFloat(sc.realPctExcluded);
            const areaDrop = parseFloat(sc.areaReductionPct);

            let score = areaDrop / (pctEx + 0.5);
            if (areaDrop >= 50 && pctEx <= 2.5) score += 50;

            if (score > bestScore) {
                bestScore = score;
                bestIndex = idx;
            }
        });

        this.scenariosData[bestIndex].isRecommended = true;
    },

    renderRightPopups() {
        const container = document.getElementById('bbox-popups-container');
        if (!container) return;
        container.innerHTML = '';

        const formatTime = (sec) => {
            if (sec < 60) return `${sec.toFixed(1)} s`;
            const m = Math.floor(sec / 60);
            const s = Math.round(sec % 60);
            return `${m} min ${s}s`;
        };

        this.scenariosData.forEach((sc, idx) => {
            const card = document.createElement('div');
            card.id = `bbox-popup-card-${idx}`;
            
            const isRec = sc.isRecommended;

            card.className = `p-4 rounded-2xl border transition-all duration-200 cursor-pointer backdrop-blur-md shadow-xl relative ${
                isRec 
                ? 'bg-white/95 border-indigo-500 ring-2 ring-indigo-500/30' 
                : 'bg-white/90 border-slate-200 hover:border-slate-300 hover:bg-white'
            }`;

            card.onclick = () => this.selectScenario(idx);

            card.innerHTML = `
                ${isRec ? `
                    <div class="absolute -top-2.5 right-4 bg-indigo-600 text-white font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow">
                        ★ Suggéré
                    </div>
                ` : ''}

                <!-- Metric 1: Employés exclus -->
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>🧑</span>
                        <span>${sc.excludedCount === 0 ? '0 employé exclu' : `${sc.excludedCount} emp. exclus (${sc.realPctExcluded}%)`}</span>
                    </span>
                    <span class="text-[10px] font-mono text-slate-500">${sc.keptEmployees.length} conservés</span>
                </div>

                <!-- Metric 2 & 3: Gain de surface & Temps estimé -->
                <div class="grid grid-cols-2 gap-2 my-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                    <div>
                        <div class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Gain Surface</div>
                        <div class="text-sm font-extrabold ${parseFloat(sc.areaReductionPct) > 0 ? 'text-indigo-600' : 'text-slate-500'}">
                            ${parseFloat(sc.areaReductionPct) > 0 ? '-' : ''}${sc.areaReductionPct}%
                        </div>
                    </div>
                    <div>
                        <div class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Temps estimé</div>
                        <div class="text-sm font-extrabold text-emerald-600">
                            ${formatTime(sc.estimatedSec)}
                        </div>
                    </div>
                </div>

                <!-- Action Button -->
                <button onclick="event.stopPropagation(); window.BboxOptimizer.confirmSelection(${idx})" 
                        class="w-full mt-2 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-md shadow-indigo-100 flex items-center justify-center gap-1">
                    <span>Valider cette BBOX</span>
                    <span>→</span>
                </button>
            `;

            container.appendChild(card);
        });
    },

    selectScenario(index) {
        const sc = this.scenariosData[index];
        if (!sc) return;

        this.scenariosData.forEach((_, idx) => {
            const card = document.getElementById(`bbox-popup-card-${idx}`);
            if (card) {
                if (idx === index) {
                    card.classList.add('ring-2', 'ring-indigo-500', 'border-indigo-500');
                } else {
                    card.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-500');
                }
            }
        });

        if (this.bboxLayer) this.map.removeLayer(this.bboxLayer);

        const bounds = [
            [sc.bbox.minLat, sc.bbox.minLng],
            [sc.bbox.maxLat, sc.bbox.maxLng]
        ];

        this.bboxLayer = L.rectangle(bounds, {
            color: '#4f46e5',
            weight: 2,
            dashArray: '4, 4',
            fillColor: '#6366f1',
            fillOpacity: 0.12
        }).addTo(this.map);

        this.map.fitBounds(bounds, { padding: [30, 30] });

        const keptSet = new Set(sc.keptEmployees.map(e => e.id));
        this.employees.forEach(emp => {
            if (keptSet.has(emp.id)) {
                emp.marker.getElement()?.classList.remove('emp-excluded');
            } else {
                emp.marker.getElement()?.classList.add('emp-excluded');
            }
        });
    },

    confirmSelection(index) {
        const sc = this.scenariosData[index];
        if (!sc) return;

        const bboxPayload = {
            bbox: sc.bbox,
            wfsBboxString: `${sc.bbox.minLat.toFixed(6)},${sc.bbox.minLng.toFixed(6)},${sc.bbox.maxLat.toFixed(6)},${sc.bbox.maxLng.toFixed(6)},urn:ogc:def:crs:EPSG::4326`,
            excludedCount: sc.excludedCount,
            keptCount: sc.keptEmployees.length,
            surfaceGainPct: sc.areaReductionPct,
            featureCount: sc.featureCount,
            estimatedSeconds: sc.estimatedSec
        };

        if (this.onSelectCallback) {
            this.onSelectCallback(bboxPayload);
        }
    }
};
