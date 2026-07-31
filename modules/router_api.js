/**
 * modules/router_api.js
 * Version : FAILSAFE - Nettoyage forcé avant envoi Google Sheet
 */

export const RouterAPI = {
    processedRoutes: [],
    processedIsochrones: [],
    apiKey: '',
    logUrl: "https://script.google.com/macros/s/AKfycbwBNZF_feM3tDlPM4yghacRYoHkBtRaNEjP9YJZp1HSmDOFXLYbqoVkwGicQj_TCC88qw/exec",
    currentUserName: "me",
    
    init() {
        this.apiKey = localStorage.getItem('ors_api_key') || '';
        this.ensureApiKeyUI();
    },

    /**
     * Envoi des données vers Google Sheets
     */
    async logSession(destAddress, coords) {
        try {
            // SECURITE ULTIME : On re-nettoie le nom ici juste avant l'envoi
            // pour être sûr que "Connecté en tant que" ne passe jamais.
            let finalName = this.currentUserName || "Anonyme";
            finalName = String(finalName)
                .replace(/.*(connecté|en tant que|bienvenue)\s*[:]*\s*/gi, '')
                .trim();

            if(finalName.includes(':')) finalName = finalName.split(':').pop().trim();

            const payload = {
                userName: finalName, // On utilise la version forcée-nettoyée
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

    ensureApiKeyUI() {
        const section = document.getElementById('step-route');
        if (!section || document.getElementById('ors-api-key-input')) return;
        
        const html = `<div class="mb-6 p-6 bg-slate-50 rounded-2xl border border-slate-200">
            <label class="block text-xs font-black text-slate-500 mb-3 tracking-widest uppercase">Configuration API OpenRouteService</label>
            <input type="password" id="ors-api-key-input" class="w-full p-4 rounded-xl border border-slate-300 outline-none font-mono text-sm focus:ring-4 focus:ring-indigo-500/10" placeholder="Votre clé API..." value="${this.apiKey}">
        </div>`;
        const logArea = document.getElementById('route-logs');
        if (logArea) logArea.insertAdjacentHTML('beforebegin', html);
        
        document.getElementById('ors-api-key-input').addEventListener('input', (e) => {
            this.apiKey = e.target.value.trim();
            localStorage.setItem('ors_api_key', this.apiKey);
        });
    },

    async startRouting(data, userName) {
        if (!this.apiKey) return;
        
        // Stockage du nom (déjà nettoyé par main.js, mais on garde la logique)
        console.log(`[Router] userName reçu:`, userName);
        this.currentUserName = userName || "me";
        
        this.processedRoutes = [];
        this.processedIsochrones = [];
        const logArea = document.getElementById('route-logs');
        logArea.innerHTML = "> Marius calcule les itinéraires...";

        const totalRoutes = data.length;
        this.ensureProgressUI();

        const firstEntry = data[0];
        const destAddress = firstEntry?.employer_address || "Inconnue";
        const destCoords = firstEntry ? `${firstEntry.end_lat}, ${firstEntry.end_lon}` : "N/A";

        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            this.updateProgress(i, totalRoutes, `Traitement ${i + 1}/${totalRoutes}`);
            try {
                const route = await this.calculateRouteWithRadius(item.start_lat, item.start_lon, item.end_lat, item.end_lon, 300);
                this.processedRoutes.push({ ...item, distance_km: route.distance, duration_min: route.duration, geometry: route.geometry, status: 'success' });
                logArea.innerHTML += `<br><span class="text-emerald-400">✅ Route ${item.id}</span>`;
            } catch (error) {
                this.processedRoutes.push({ ...item, status: 'error', error: error.message });
            }
            if (i < data.length - 1) await this.delay(1700);
        }

        const uniqueDestinations = {};
        data.forEach(d => {
            const key = `${d.end_lat},${d.end_lon}`;
            if (!uniqueDestinations[key]) uniqueDestinations[key] = { lat: d.end_lat, lon: d.end_lon, address: d.employer_address };
        });

        for (const dest of Object.values(uniqueDestinations)) {
            for (const km of [2, 5, 10]) {
                try {
                    const isoGeoJson = await this.generateIsochrone(dest.lat, dest.lon, km, 'cycling-regular');
                    if (isoGeoJson) {
                        isoGeoJson.properties = { ...isoGeoJson.properties, range_km: km, center: dest.address };
                        this.processedIsochrones.push(isoGeoJson);
                    }
                } catch (e) {}
                await this.delay(1000);
            }
        }

        this.updateProgress(100, 100, "Analyse terminée !");
        
        // C'est ici que l'appel part vers le Sheet
        this.logSession(destAddress, destCoords);

        await this.delay(1000);
        this.emitNextStep();
    },

    async generateIsochrone(lat, lng, distanceKm, profile) {
        const response = await fetch('https://api.openrouteservice.org/v2/isochrones/' + profile, {
            method: 'POST',
            headers: { 'Accept': 'application/json, application/geo+json', 'Authorization': this.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ locations: [[lng, lat]], range: [distanceKm * 1000], range_type: 'distance', smoothing: 0.9 })
        });
        const data = await response.json();
        return (data.features && data.features.length > 0) ? data.features[0] : null;
    },

    async calculateRouteWithRadius(slat, slon, elat, elon, radius) {
        const url = `https://api.openrouteservice.org/v2/directions/cycling-regular`;
        const body = { coordinates: [[slon, slat], [elon, elat]], radiuses: [radius, radius], format: "json", instructions: false, geometry: true };
        const response = await fetch(url, { method: 'POST', headers: { 'Authorization': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        return { distance: (data.routes[0].summary.distance / 1000).toFixed(2), duration: Math.round(data.routes[0].summary.duration / 60), geometry: data.routes[0].geometry };
    },

    emitNextStep() {
        window.dispatchEvent(new CustomEvent('nextStep', { detail: { data: { routes: this.processedRoutes, isochrones: this.processedIsochrones }, next: 'step-map' } }));
    },

    ensureProgressUI() {
        if (!document.getElementById('router-progress-bar')) {
            const html = `<div id="router-ui" class="mb-4"><div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div id="router-progress-bar" class="bg-indigo-400 h-full w-0 transition-all duration-300"></div></div><p id="router-progress-text" class="text-[10px] text-slate-400 mt-3 uppercase font-black text-center tracking-widest"></p></div>`;
            document.getElementById('route-logs').insertAdjacentHTML('beforebegin', html);
        }
    },

    updateProgress(curr, tot, txt) {
        const bar = document.getElementById('router-progress-bar');
        const lbl = document.getElementById('router-progress-text');
        if (bar) bar.style.width = `${tot > 0 ? (curr / tot) * 100 : 0}%`;
        if (lbl) lbl.innerText = txt;
    },

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
};
