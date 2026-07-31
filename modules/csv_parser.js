export const CSVParser = {
    originalData: [],
    convertedData: [],
    fileName: '',

    init() {
        console.log("[CSVParser] Initialisation du module...");
        const fileInput = document.getElementById('csv-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
        }
    },

    handleFileSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.fileName = file.name;
        this.updateFileUI("Analyse en cours...");

        if (typeof Papa !== 'undefined') {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    this.originalData = results.data;
                    this.processConversion();
                },
                error: (err) => {
                    this.showError(`Erreur PapaParse : ${err.message}`);
                }
            });
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.originalData = this.simpleCSVParse(e.target.result);
                this.processConversion();
            };
            reader.readAsText(file);
        }
    },

    processConversion() {
        if (this.originalData.length < 2) {
            this.showError("Le fichier est vide ou ne contient que l'en-tête.");
            return;
        }

        const rows = this.originalData.slice(1);

        this.convertedData = rows.map((values) => {
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

        this.updateFileUI(`Analyse terminée : ${this.convertedData.length} lignes prêtes.`);

        window.dispatchEvent(new CustomEvent('nextStep', {
            detail: { 
                data: { rawData: this.convertedData }, 
                next: 'step-geo' 
            }
        }));
    },

    updateFileUI(message) {
        const section = document.getElementById('step-csv');
        if (!section) return;

        let infoBox = document.getElementById('csv-info-display');
        if (!infoBox) {
            infoBox = document.createElement('div');
            infoBox.id = 'csv-info-display';
            infoBox.className = "mt-6 p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm font-medium text-indigo-700";
            section.appendChild(infoBox);
        }
        infoBox.innerHTML = `<strong>${this.fileName}</strong> : ${message}`;
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
