import { MapDisplay } from './map_display.js';

export const Analytics = {
    appState: null,
    currentChart: null,
    currentMode: 'distance',
    bikeMode: false,

    init(state) {
        this.appState = state;
        const dashboard = document.getElementById('analytics-dashboard');
        if (dashboard) dashboard.classList.remove('hidden');

        this.renderDashboardUI();
        this.bindEvents();
    },

    bindEvents() {
        const pdfBtn = document.getElementById('pdfBtn');
        if (pdfBtn && !pdfBtn.dataset.init) {
            pdfBtn.addEventListener('click', () => this.exportFullAuditPDF());
            pdfBtn.dataset.init = "true";
        }

        const distanceBtn = document.getElementById('toggle-dist');
        const timeBtn = document.getElementById('toggle-time');
        const bikeBtn = document.getElementById('bike-toggle');

        if (distanceBtn) {
            distanceBtn.onclick = () => {
                this.currentMode = 'distance';
                distanceBtn.classList.add('active');
                if (timeBtn) timeBtn.classList.remove('active');
                if (bikeBtn) bikeBtn.classList.add('hidden');
                this.renderDashboardUI();
            };
        }

        if (timeBtn) {
            timeBtn.onclick = () => {
                this.currentMode = 'time';
                timeBtn.classList.add('active');
                if (distanceBtn) distanceBtn.classList.remove('active');
                if (bikeBtn) bikeBtn.classList.remove('hidden');
                this.renderDashboardUI();
            };
        }

        if (bikeBtn) {
            bikeBtn.onclick = () => {
                this.bikeMode = !this.bikeMode;
                bikeBtn.classList.toggle('active');
                bikeBtn.classList.toggle('bg-emerald-500');
                bikeBtn.classList.toggle('text-white');
                bikeBtn.textContent = this.bikeMode ? '🚲 Vélo électrique activé (-25%)' : '🚲 Vélo électrique (-25%)';
                this.renderDashboardUI();
            };
        }
    },

    categorizeData(mode, isBike = false) {
        const routes = this.appState.routes || [];
        const total = routes.length;
        const categories = {};

        if (mode === 'distance') {
            categories['0-2 km'] = 0; categories['2-5 km'] = 0; 
            categories['5-10 km'] = 0; categories['10+ km'] = 0;
            routes.forEach(r => {
                const d = parseFloat(r.distance_km);
                if (d <= 2) categories['0-2 km']++;
                else if (d <= 5) categories['2-5 km']++;
                else if (d <= 10) categories['5-10 km']++;
                else categories['10+ km']++;
            });
        } else {
            categories['0-10 min'] = 0; categories['10-15 min'] = 0; 
            categories['15-20 min'] = 0; categories['20+ min'] = 0;
            routes.forEach(r => {
                let d = parseFloat(r.duration_min);
                if (isBike) d *= 0.75;
                if (d <= 10) categories['0-10 min']++;
                else if (d <= 15) categories['10-15 min']++;
                else if (d <= 20) categories['15-20 min']++;
                else categories['20+ min']++;
            });
        }

        const percentages = {};
        Object.keys(categories).forEach(k => {
            percentages[k] = total > 0 ? (categories[k] / total) * 100 : 0;
        });

        return { categories, percentages, total };
    },

    renderDashboardUI() {
        const { categories, percentages, total } = this.categorizeData(this.currentMode, this.bikeMode);
        
        const titleElem = document.getElementById('chart-title');
        if (titleElem) titleElem.textContent = this.currentMode === 'distance' ? 'Distribution par Distance' : 'Distribution par Temps';

        const ctx = document.getElementById('interactiveChart').getContext('2d');
        if (this.currentChart) this.currentChart.destroy();

        this.currentChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(categories),
                datasets: [{
                    data: Object.values(percentages),
                    backgroundColor: this.bikeMode && this.currentMode === 'time' ? '#10b981' : '#6366f1',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } }
            }
        });

        this.updateStatsGrid(categories, total, Object.values(percentages));
    },

    updateStatsGrid(categories, total, percentages) {
        const grid = document.getElementById('statsGrid');
        if (!grid) return;
        grid.innerHTML = '';

        Object.keys(categories).forEach((k, i) => {
            const val = Object.values(categories)[i];
            const card = document.createElement('div');
            card.className = 'stat-card';
            card.innerHTML = `
                <div class="stat-value">${val}</div>
                <div class="stat-label">${k}<br><span class="opacity-60">(${percentages[i].toFixed(1)}%)</span></div>
            `;
            grid.appendChild(card);
        });
    },

    async exportFullAuditPDF() {
        if (!this.appState.routes || this.appState.routes.length === 0) return;
        
        const btn = document.getElementById('pdfBtn');
        btn.textContent = "Génération...";
        btn.disabled = true;

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 20;

            const siteName = document.getElementById('input-site-name')?.value || "Site Principal";

            doc.setFontSize(18);
            doc.text(`Rapport de Diagnostic Mobilité : ${siteName}`, margin, 30);
            doc.setFontSize(10);
            doc.text(`Nombre de collaborateurs analysés : ${this.appState.routes.length}`, margin, 40);

            doc.save(`Audit_Mobilité_${siteName.replace(/\s+/g, '_')}.pdf`);
        } catch (e) {
            console.error(e);
        } finally {
            btn.textContent = "Générer l'Audit PDF";
            btn.disabled = false;
        }
    }
};
