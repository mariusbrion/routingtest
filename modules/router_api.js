/

router_api.js (router.js)

Script d'ingénierie réseau récepteur de la BBOX optimisée.
*/

export const RouterAPI = {
init() {
console.log("[RouterAPI] Initialisé et prêt à recevoir les requêtes d'emprise BBOX.");
},

/**
 * Traitement du calcul d'itinéraire basé sur l'emprise BBOX transmise
 */
async startRouting(selectedBboxPayload, coordinates, userName) {
    console.log(`[RouterAPI] Traitement en cours pour ${userName}...`);
    console.log(`[RouterAPI] Emprise BBOX reçue :`, selectedBboxPayload.wfsBboxString);

    const routeLogs = document.getElementById('route-logs');
    if (routeLogs) {
        routeLogs.innerHTML = `> Emprise BBOX reçue : ${selectedBboxPayload.wfsBboxString}\n`;
        routeLogs.innerHTML += `> Tronçons à télécharger : ${selectedBboxPayload.featureCount}\n`;
        routeLogs.innerHTML += `> Temps d'exécution estimé : ${selectedBboxPayload.estimatedSeconds}s\n`;
        routeLogs.innerHTML += `> Initialisation du calcul réseau...\n`;
    }

    // Simulation du traitement des tronçons de route WFS
    await new Promise(resolve => setTimeout(resolve, 1200));

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
