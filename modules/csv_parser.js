export const CSVParser = {
    headers: [],
    previewRows: [],
    fullRows: [],
    fileName: '',

    init() {
        console.log("[CSVParser] Initialisation du module...");
        const fileInput = document.getElementById('csv-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
        }

        const confirmBtn = document.getElementById('btn-confirm-columns');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.processSelectedColumns());
        }
    },

    handleFileSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.fileName = file.name;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (!results.data || results.data.length === 0) {
                    alert("Le fichier CSV est vide.");
                    return;
                }

                this.headers = results.meta.fields || Object.keys(results.data[0]);
                this.fullRows = results.data;
                this.previewRows = results.data.slice(0, 5);

                this.renderPreviewUI();
            },
            error: (err) => {
                alert(`Erreur de lecture CSV : ${err.message}`);
            }
        });
    },

    renderPreviewUI() {
        const previewContainer = document.getElementById('csv-preview-container');
        const countSpan = document.getElementById('csv-row-count');
        const table = document.getElementById('csv-preview-table');
        const empColsContainer = document.getElementById('emp-cols-container');
        const siteColsContainer = document.getElementById('site-cols-container');

        if (countSpan) countSpan.textContent = `${this.fullRows.length} lignes trouvées`;

        // 1. Génération du tableau d'aperçu
        let tableHtml = `<thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200"><tr>`;
        this.headers.forEach(h => { tableHtml += `<th class="px-3 py-2 border-r border-slate-200 last:border-r-0">${h}</th>`; });
        tableHtml += `</tr></thead><tbody>`;

        this.previewRows.forEach(row => {
            tableHtml += `<tr class="border-b border-slate-100 hover:bg-slate-50">`;
            this.headers.forEach(h => {
                tableHtml += `<td class="px-3 py-2 border-r border-slate-100 last:border-r-0 truncate max-w-[150px]">${row[h] || ''}</td>`;
            });
            tableHtml += `</tr>`;
        });
        tableHtml += `</tbody>`;
        table.innerHTML = tableHtml;

        // 2. Génération des checkboxes
        let empHtml = '';
        let siteHtml = '';

        this.headers.forEach((h, i) => {
            const isEmpDefault = i < 3;
            const isSiteDefault = i >= 3;

            empHtml += `
                <label class="flex items-center space-x-2 text-xs font-semibold text-slate-700 hover:text-indigo-600 cursor-pointer">
                    <input type="checkbox" name="emp-col" value="${h}" ${isEmpDefault ? 'checked' : ''} class="rounded text-indigo-600 focus:ring-indigo-500 emp-cb">
                    <span>${h}</span>
                </label>`;

            siteHtml += `
                <label class="flex items-center space-x-2 text-xs font-semibold text-slate-700 hover:text-indigo-600 cursor-pointer">
                    <input type="checkbox" name="site-col" value="${h}" ${isSiteDefault ? 'checked' : ''} class="rounded text-indigo-600 focus:ring-indigo-500 site-cb">
                    <span>${h}</span>
                </label>`;
        });

        empColsContainer.innerHTML = empHtml;
        siteColsContainer.innerHTML = siteHtml;

        // Écouteurs pour mise à jour dynamique de la prévisualisation
        empColsContainer.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => this.updateLiveAddressPreview()));
        siteColsContainer.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => this.updateLiveAddressPreview()));

        if (previewContainer) previewContainer.classList.remove('hidden');

        this.updateLiveAddressPreview();
    },

    updateLiveAddressPreview() {
        const selectedEmpCols = Array.from(document.querySelectorAll('input[name="emp-col"]:checked')).map(cb => cb.value);
        const selectedSiteCols = Array.from(document.querySelectorAll('input[name="site-col"]:checked')).map(cb => cb.value);

        const firstRow = this.fullRows[0] || {};

        const empPreviewText = selectedEmpCols.map(col => (firstRow[col] || '').toString().trim()).filter(Boolean).join(' ');
        const sitePreviewText = selectedSiteCols.map(col => (firstRow[col] || '').toString().trim()).filter(Boolean).join(' ');

        const empElem = document.getElementById('preview-assembled-emp');
        const siteElem = document.getElementById('preview-assembled-site');

        if (empElem) empElem.textContent = empPreviewText || "Aucune colonne sélectionnée";
        if (siteElem) siteElem.textContent = sitePreviewText || "Aucune colonne sélectionnée";
    },

    processSelectedColumns() {
        const selectedEmpCols = Array.from(document.querySelectorAll('input[name="emp-col"]:checked')).map(cb => cb.value);
        const selectedSiteCols = Array.from(document.querySelectorAll('input[name="site-col"]:checked')).map(cb => cb.value);

        if (selectedEmpCols.length === 0 || selectedSiteCols.length === 0) {
            alert("Veuillez cocher au moins une colonne pour l'adresse employé et pour l'adresse employeur.");
            return;
        }

        const convertedData = this.fullRows.map(row => {
            const empAddrParts = selectedEmpCols.map(col => (row[col] || '').toString().trim()).filter(Boolean);
            const siteAddrParts = selectedSiteCols.map(col => (row[col] || '').toString().trim()).filter(Boolean);

            return {
                'adresse employé': empAddrParts.join(' '),
                'adresse employeur': siteAddrParts.join(' ')
            };
        }).filter(r => r['adresse employé'] && r['adresse employeur']);

        if (convertedData.length === 0) {
            alert("Aucune adresse valide n'a pu être construite à partir de la sélection.");
            return;
        }

        window.dispatchEvent(new CustomEvent('nextStep', {
            detail: { 
                data: { rawData: convertedData }, 
                next: 'step-geo' 
            }
        }));
    }
};
