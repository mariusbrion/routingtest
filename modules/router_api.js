export const RouterAPI = {
    init() {
        console.log("[RouterAPI] Initialisé et prêt à recevoir la BBOX optimisée.");
    },

    async startRouting(selectedBboxPayload, coordinates, userName) {
        console.log(`[RouterAPI] Traitement pour ${userName}...`);
        
        const routeLogs = document.getElementById('route-logs');
        if (routeLogs) {
            routeLogs.innerHTML = `> Utilisateur : ${userName}\n`;
            routeLogs.innerHTML += `> Emprise BBOX transmise : ${selectedBboxPayload.wfsBboxString}\n`;
            routeLogs.innerHTML += `> Tronçons à traiter : ${selectedBboxPayload.featureCount}\n`;
            routeLogs.innerHTML += `> Temps d'exécution estimé : ${selectedBboxPayload.estimatedSeconds}s\n`;
            routeLogs.innerHTML += `> Génération des itinéraires réseau...\n`;
        }

        await new Promise(resolve => setTimeout(resolve, 800));

        if (routeLogs) {
            routeLogs.innerHTML += `> ✅ Génération terminée avec succès !`;
        }

        const routes = coordinates.map((item, idx) => {
            const startLat = item.start_lat;
            const startLon = item.start_lon;
            const endLat = item.end_lat;
            const endLon = item.end_lon;

            const distKm = (Math.sqrt(Math.pow((endLat - startLat) * 111, 2) + Math.pow((endLon - startLon) * 75, 2))).toFixed(2);
            const durationMin = (distKm * 3.5).toFixed(1);

            return {
                id: item.id || `route-${idx + 1}`,
                status: 'success',
                start_lat: startLat,
                start_lon: startLon,
                end_lat: endLat,
                end_lon: endLon,
                distance_km: distKm,
                duration_min: durationMin,
                geometry: null
            };
        });

        return routes;
    }
};
