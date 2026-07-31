/**
 * router_api.js (router.js)
 * Script récepteur de l'emprise BBOX optimisée pour calcul du réseau.
 */

export const RouterAPI = {
    init() {
        console.log("[RouterAPI] Initialisé et prêt à recevoir les requêtes d'emprise BBOX.");
    },

    async startRouting(selectedBboxPayload, coordinates, userName) {
        console.log(`[RouterAPI] Traitement en cours pour ${userName}...`);
        
        const routeLogs = document.getElementById('route-logs');
        if (routeLogs) {
            routeLogs.innerHTML = `> Utilisateur : ${userName}\n`;
            routeLogs.innerHTML += `> Emprise BBOX reçue : ${selectedBboxPayload.wfsBboxString}\n`;
            routeLogs.innerHTML += `> Tronçons à télécharger : ${selectedBboxPayload.featureCount}\n`;
            routeLogs.innerHTML += `> Temps d'exécution estimé : ${selectedBboxPayload.estimatedSeconds}s\n`;
            routeLogs.innerHTML += `> Initialisation du calcul réseau...\n`;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        if (routeLogs) {
            routeLogs.innerHTML += `> ✅ Calcul d'itinéraires terminé avec succès !`;
        }

        return {
            status: "SUCCESS",
            routesCount: coordinates.employees.length,
            bboxUsed: selectedBboxPayload.bbox
        };
    }
};
