export const Geocoder = {
    processedData: [],
    CHUNK_SIZE: 1000,

    init() {},

    async startGeocoding(data) {
        this.processedData = [];
        const totalInputRows = data.length;
        this.updateProgress(10, "Initialisation du géocodage BAN Batch...");

        const employerMap = new Map();
        data.forEach(item => {
            const site = item['adresse employeur'];
            if (!employerMap.has(site)) employerMap.set(site, null);
        });

        this.updateProgress(20, `Géocodage de ${employerMap.size} sites employeurs via BAN...`);
        const employerList = Array.from(employerMap.keys());
        const geocodedEmployers = await this.geocodeBatchBAN(employerList);
        
        employerList.forEach((site, i) => {
            employerMap.set(site, geocodedEmployers[i]);
        });

        this.updateProgress(40, `Géocodage de ${totalInputRows} employés en lots BAN Batch...`);

        const employeeAddrs = data.map(item => item['adresse employé']);
        const geocodedEmployees = await this.geocodeBatchBAN(employeeAddrs, (pct) => {
            this.updateProgress(40 + Math.round(pct * 0.5), `Géocodage BAN Batch : ${Math.round(pct)}%...`);
        });

        let currentLetter = 'a';
        const employerGroupIds = new Map();

        for (let i = 0; i < data.length; i++) {
            const empCoords = geocodedEmployees[i];
            const siteAddr = data[i]['adresse employeur'];
            const siteCoords = employerMap.get(siteAddr);

            if (!empCoords || !siteCoords) continue;

            if (!employerGroupIds.has(siteAddr)) {
                employerGroupIds.set(siteAddr, { letter: currentLetter, count: 0 });
                currentLetter = String.fromCharCode(currentLetter.charCodeAt(0) + 1);
            }

            const group = employerGroupIds.get(siteAddr);
            group.count++;

            this.processedData.push({
                id: `employé ${group.letter}${group.count}`,
                start_lat: empCoords.lat,
                start_lon: empCoords.lon,
                end_lat: siteCoords.lat,
                end_lon: siteCoords.lon,
                employee_address: data[i]['adresse employé'],
                employer_address: siteAddr
            });
        }

        const geocodedCount = this.processedData.length;
        const failedCount = Math.max(0, totalInputRows - geocodedCount);
        const successRate = totalInputRows > 0 ? parseFloat(((geocodedCount / totalInputRows) * 100).toFixed(1)) : 100;

        const geocodeStats = {
            totalInput: totalInputRows,
            geocodedCount,
            failedCount,
            successRate
        };

        this.updateProgress(100, `Géocodage terminé (${geocodedCount}/${totalInputRows} adresses localisées) ! Transmetteur BBOX...`);
        await new Promise(r => setTimeout(r, 600));

        window.dispatchEvent(new CustomEvent('nextStep', {
            detail: { 
                data: { 
                    coordinates: this.processedData,
                    geocodeStats
                }, 
                next: 'step-bbox' 
            }
        }));
    },

    async geocodeBatchBAN(addresses, progressCallback) {
        const results = new Array(addresses.length).fill(null);
        const totalChunks = Math.ceil(addresses.length / this.CHUNK_SIZE);

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const start = chunkIdx * this.CHUNK_SIZE;
            const end = Math.min(start + this.CHUNK_SIZE, addresses.length);
            const chunkAddrs = addresses.slice(start, end);

            const csvLines = ["adresse"];
            chunkAddrs.forEach(addr => csvLines.push(`"${(addr || '').replace(/"/g, '""')}"`));
            const csvBlob = new Blob([csvLines.join("\n")], { type: 'text/csv;charset=utf-8;' });

            const formData = new FormData();
            formData.append('data', csvBlob, 'addresses.csv');
            formData.append('columns', 'adresse');

            try {
                const response = await fetch('https://api-adresse.data.gouv.fr/search/csv/', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    const csvText = await response.text();
                    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

                    parsed.data.forEach((row, i) => {
                        const lat = parseFloat(row.latitude);
                        const lon = parseFloat(row.longitude);
                        if (!isNaN(lat) && !isNaN(lon)) {
                            results[start + i] = { lat, lon, label: row.result_label };
                        }
                    });
                }
            } catch (err) {
                console.error("[Geocoder BAN Batch] Error:", err);
            }

            if (progressCallback) {
                progressCallback(((chunkIdx + 1) / totalChunks) * 100);
            }
        }

        return results;
    },

    updateProgress(pct, txt) {
        const bar = document.getElementById('geo-progress-bar');
        const lbl = document.getElementById('geo-progress-text');
        if (bar) bar.style.width = `${pct}%`;
        if (lbl) lbl.innerText = txt;
    }
};
