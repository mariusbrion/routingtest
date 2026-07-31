/**
 * modules/csv_parser.js
 * Version robuste - Automatisation complète sans clic.
 */
export const CSVParser = {
    originalData: [],
    convertedData: [],
    fileName: '',

    /**
     * Initialisation du module
     */
    init() {
        console.log("[CSVParser] Initialisation du module...");
        const fileInput = document.getElementById('csv-input');
        
        if (fileInput) {
            // Déclenchement dès que le fichier est choisi
            fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
        } else {
            console.error("[CSVParser] Élément #csv-input introuvable dans le DOM.");
        }
    },

    /**
     * Gestion de la lecture du fichier
     */
    handleFileSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        console.log(`[CSVParser] Fichier sélectionné : ${file.name}`);
        this.fileName = file.name;
        this.updateFileUI("Analyse en cours...");

        if (typeof Papa !== 'undefined') {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    console.log("[CSVParser] PapaParse terminé. Lignes trouvées :", results.data.length);
                    this.originalData = results.data;
                    this.processConversion();
                },
                error: (err) => {
                    this.showError(`Erreur PapaParse : ${err.message}`);
                }
            });
        } else {
            console.warn("[CSVParser] PapaParse non détecté, tentative de parsing manuel...");
            const reader = new FileReader();
            reader.onload = (e) => {
                this.originalData = this.simpleCSVParse(e.target.result);
                this.processConversion();
            };
            reader.readAsText(file);
        }
    },

    /**
     * Transformation des données et passage à l'étape suivante
     */
    processConversion() {
        // Vérification du nombre de lignes (En-tête + au moins 1 donnée)
        if (this.originalData.length < 2) {
            this.showError("Le fichier est vide ou ne contient que l'en-tête.");
            return;
        }

        const rows = this.originalData.slice(1); // On ignore la ligne 1 (headers)

        this.convertedData = rows.map((values, index) => {
            // Nettoyage des index (0: Rue, 1: Commune, 2: CP, 3: Site employeur)
            const rue = (values[0] || '').toString().trim();
            const ville = (values[1] || '').toString().trim();
            const cp = (values[2] || '').toString().trim();
            const rawSite = (values[3] || '').toString().trim();

            const addrE = `${rue} ${ville} ${cp}`.trim();

            let addrS = rawSite;
            if (rawSite.includes(';')) {
                const parts = rawSite.split(';');
                addrS = parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : rawSite.replace(/;/g, ' ');
            }

            return { 'adresse employé': addrE, 'adresse employeur': addrS };
        }).filter(row => row['adresse employé'] && row['adresse employeur']);

        console.log(`[CSVParser] Conversion finie : ${this.convertedData.length} lignes valides.`);
        
        this.updateFileUI(`Analyse terminée : ${this.convertedData.length} lignes prêtes.`);

        // Envoi automatique vers le Geocoder via le routeur (main.js)
        window.dispatchEvent(new CustomEvent('nextStep', {
            detail: { 
                data: { rawData: this.convertedData }, 
                next: 'step-geo' 
            }
        }));
    },

    /**
     * Mise à jour de l'affichage dans la section #step-csv
     */
    updateFileUI(message) {
        const section = document.getElementById('step-csv');
        if (!section) return;

        let infoBox = document.getElementById('csv-info-display');
        if (!infoBox) {
            infoBox = document.createElement('div');
            infoBox.id = 'csv-info-display';
            infoBox.className = "mt-6 p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm font-medium text-indigo-700";
            // On l'insère au début de la section
            section.appendChild(infoBox);
        }
        
        infoBox.innerHTML = `<strong>${this.fileName}</strong> : ${message}`;

        // On masque le bouton s'il existe pour renforcer l'aspect automatique
        const parseBtn = document.getElementById('btn-parse-csv');
        if (parseBtn) parseBtn.style.display = 'none';
    },

    showError(msg) {
        console.error(`[CSVParser] ${msg}`);
        this.updateFileUI(`<span class="text-red-600">⚠️ ${msg}</span>`);
    },

    simpleCSVParse(text) {
        const lines = text.split('\n').filter(l => l.trim() !== '');
        const delimiter = lines[0].includes(';') ? ';' : ',';
        return lines.map(line => line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, '')));
    }
};
