/**
 * modules/geocoder.js
 * Automatisation : Passe au routeur dès que le géocodage est fini.
 */
export const Geocoder = {
    processedData: [],
    apiStats: { ban: { s: 0, f: 0 }, nom: { s: 0, f: 0 } },

    init() {
        // Le bouton "Suivant" peut rester pour le mode manuel, 
        // mais il sera court-circuité par l'auto-next.
        const btnNext = document.getElementById('btn-go-route');
        if (btnNext) btnNext.addEventListener('click', () => this.emitNextStep());
    },

    async startGeocoding(data) {
        this.processedData = [];
        const container = document.getElementById('step-geo');
        this.ensureProgressUI(container);

        const employerGroups = {};
        let currentLetter = 'a';
        const total = data.length;
        const totalSteps = total * 2;

        for (let i = 0; i < data.length; i++) {
            const pair = data[i];
            const currentStepBase = i * 2;

            // 1. Employé
            this.updateUI(currentStepBase, totalSteps, `Géocodage employé ${i + 1}/${total}...`);
            await this.delay(1200);
            const employeeCoords = await this.fetchWithFallback(pair['adresse employé']);
            if (!employeeCoords) continue;

            // 2. Employeur
            const site = pair['adresse employeur'];
            this.updateUI(currentStepBase + 1, totalSteps, `Géocodage employeur ${i + 1}/${total}...`);

            let employerCoords;
            let groupId;

            if (employerGroups[site]) {
                employerCoords = employerGroups[site].coords;
                groupId = employerGroups[site].groupId;
                await this.delay(300);
            } else {
                await this.delay(1200);
                employerCoords = await this.fetchWithFallback(site);
                if (!employerCoords) continue;

                groupId = currentLetter;
                employerGroups[site] = { coords: employerCoords, groupId: currentLetter, count: 0 };
                currentLetter = String.fromCharCode(currentLetter.charCodeAt(0) + 1);
            }

            employerGroups[site].count++;
            const id = `employé ${groupId}${employerGroups[site].count}`;

            this.processedData.push({
                id,
                start_lat: employeeCoords.lat,
                start_lon: employeeCoords.lon,
                end_lat: employerCoords.lat,
                end_lon: employerCoords.lon,
                employee_address: pair['adresse employé'],
                employer_address: site
            });
        }

        this.updateUI(totalSteps, totalSteps, "Géocodage terminé ! Préparation du routage...");
        
        // AUTOMATISATION : On attend un court instant avant de passer à l'étape suivante
        await this.delay(800);
        this.emitNextStep();
    },

    async fetchWithFallback(address) {
        let res = await this.callBAN(address);
        if (res) { this.apiStats.ban.s++; return res; }
        await this.delay(500);
        res = await this.callNominatim(address);
        if (res) { this.apiStats.nom.s++; return res; }
        return null;
    },

    async callBAN(addr) {
        try {
            const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(addr)}&limit=1`;
            const r = await fetch(url);
            const d = await r.json();
            if (d.features?.length > 0) {
                const c = d.features[0].geometry.coordinates;
                return { lat: c[1], lon: c[0] };
            }
        } catch(e) { return null; }
    },

    async callNominatim(addr) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr + ', France')}&limit=1`;
            const r = await fetch(url);
            const d = await r.json();
            if (d.length > 0) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
        } catch(e) { return null; }
    },

    emitNextStep() {
        window.dispatchEvent(new CustomEvent('nextStep', {
            detail: { data: { coordinates: this.processedData }, next: 'step-route' }
        }));
    },

    ensureProgressUI(container) {
        if (!document.getElementById('geo-progress-bar')) {
            const html = `
                <div class="mb-6">
                    <div class="bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div id="geo-progress-bar" class="bg-indigo-500 h-full w-0 transition-all duration-300"></div>
                    </div>
                    <p id="geo-progress-text" class="text-[11px] font-medium text-slate-500 text-center mt-2 italic tracking-tight"></p>
                </div>`;
            const target = container.querySelector('div');
            if (target) target.insertAdjacentHTML('afterbegin', html);
        }
    },

    updateUI(curr, tot, txt) {
        const bar = document.getElementById('geo-progress-bar');
        const lbl = document.getElementById('geo-progress-text');
        if (bar) bar.style.width = `${(curr / tot) * 100}%`;
        if (lbl) lbl.innerText = txt;
    },

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
};
