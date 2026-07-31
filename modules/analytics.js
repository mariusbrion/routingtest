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

    generateDistanceComment(stats) {
        const shortDist = stats.percentages['0-2 km'] + stats.percentages['2-5 km'];
        const mediumDist = stats.percentages['5-10 km'];
        const under10 = shortDist + mediumDist;

        let text = `Analyse de la répartition géographique : ${shortDist.toFixed(1)}% des effectifs résident à moins de 5km du site. `;

        if (shortDist > 30) {
            text += "Ceci représente un gisement très important pour le report modal vers le vélo musculaire ou électrique. ";
            text += `Concrètement, cela concerne environ ${Math.round((shortDist/100)*stats.total)} collaborateurs qui pourraient abandonner la voiture individuelle. `;
        } else if (shortDist > 15) {
            text += "Un potentiel modéré mais existant pour la mobilité douce de proximité. ";
        } else {
            text += "L'éloignement géographique est marqué sur la très courte distance. ";
        }

        if (mediumDist > 10 || under10 > 40) {
            text += `Si l'on élargit le périmètre, notons que ${under10.toFixed(1)}% des effectifs se situent à moins de 10km. `;
            text += "En milieu urbain, ce sont des distances (5-10km) où le vélo est souvent plus compétitif que la voiture en temps de trajet réel. ";
        } else {
            text += "Au-delà de 10km, le covoiturage ou les transports en commun deviennent des options stratégiques plus pertinentes. ";
        }

        return text;
    },

    generateTimeComment(normalStats, bikeStats) {
        const totalEmployees = normalStats.total;
        const under15Car = normalStats.percentages['0-10 min'] + normalStats.percentages['10-15 min'];
        const under15Bike = bikeStats.percentages['0-10 min'] + bikeStats.percentages['10-15 min'];
        const under20Bike = under15Bike + bikeStats.percentages['15-20 min'];
        const countUnder20Bike = Math.round((under20Bike / 100) * totalEmployees);
        
        let text = `Impact du temps de trajet : Actuellement, ${under15Car.toFixed(1)}% des trajets sont inférieurs à 15 minutes. `;
        
        if (under15Bike > under15Car) {
            const gain = (under15Bike - under15Car).toFixed(1);
            text += `L'introduction du vélo électrique permettrait d'augmenter cette proportion de +${gain} points. `;
            text += `Concrètement, l'assistance électrique permettrait à ${countUnder20Bike} employés de se rendre au travail en moins de 20 minutes. `;
        } else {
            text += `Le passage au vélo électrique maintient des temps de parcours compétitifs pour ${countUnder20Bike} employés sous les 20 minutes. `;
        }
        return text;
    },

    async generateInvisibleChart(label, stats, color = '#6366f1') {
        return new Promise((resolve) => {
            const container = document.getElementById('pdf-hidden-generator');
            const canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = 400;
            container.appendChild(canvas);

            new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: Object.keys(stats.categories),
                    datasets: [{ data: Object.values(stats.percentages), backgroundColor: color, borderRadius: 6 }]
                },
                options: { animation: false, responsive: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
            });

            setTimeout(() => {
                const data = canvas.toDataURL('image/png');
                container.innerHTML = '';
                resolve(data);
            }, 300);
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
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 20;

            const siteName = document.getElementById('input-site-name')?.value || "Site Principal";
            const cityName = document.getElementById('input-city')?.value || "";
            const fullTitle = `Rapport de diagnostic : ${siteName}${cityName ? ' - ' + cityName : ''}`;

            const addFooter = () => {
                const footerText = "Outil développé dans le cadre du CAVENA - Diagnostic certifié FUB Employeur Pro Vélo.";
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text(footerText, pageWidth / 2, pageHeight - 12, { align: 'center' });
            };

            // Page 1: Cover & Distance
            doc.setFontSize(18);
            doc.setTextColor(79, 70, 229);
            doc.setFont("helvetica", "bold");
            doc.text(fullTitle, margin, 25);

            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text(`Collaborateurs analysés : ${this.appState.routes.length}`, margin, 35);

            const distStats = this.categorizeData('distance', false);
            const distImg = await this.generateInvisibleChart('Distances', distStats, '#6366f1');
            doc.addImage(distImg, 'PNG', margin, 45, pageWidth - (margin*2), 70);

            const distComment = this.generateDistanceComment(distStats);
            doc.setFont("helvetica", "italic");
            doc.setFontSize(9);
            const splitDist = doc.splitTextToSize(distComment, pageWidth - (margin*2));
            doc.text(splitDist, margin, 125);
            addFooter();

            // Page 2: Time
            doc.addPage();
            doc.setFontSize(14);
            doc.setFont("helvetica", "bold");
            doc.text("Analyse des Temps de Trajet", margin, 20);

            const timeStats = this.categorizeData('time', false);
            const timeBikeStats = this.categorizeData('time', true);
            const timeImg = await this.generateInvisibleChart('Temps', timeStats, '#6366f1');
            doc.addImage(timeImg, 'PNG', margin, 30, pageWidth - (margin*2), 65);

            const timeComment = this.generateTimeComment(timeStats, timeBikeStats);
            const splitTime = doc.splitTextToSize(timeComment, pageWidth - (margin*2));
            doc.text(splitTime, margin, 105);
            addFooter();

            // Page 3: Map Capture
            doc.addPage();
            doc.setFontSize(14);
            doc.text("Carte de Chaleur des Flux", margin, 20);

            const mapImg = MapDisplay.getMapImage();
            if (mapImg) {
                doc.addImage(mapImg, 'PNG', margin, 30, pageWidth - (margin * 2), 100);
            }
            addFooter();

            doc.save(`Audit_Mobilité_${siteName.replace(/\s+/g, '_')}.pdf`);
        } catch (e) {
            console.error("[Analytics] Erreur PDF:", e);
        } finally {
            btn.textContent = "Générer l'Audit PDF";
            btn.disabled = false;
        }
    }
};
