/**
 * modules/analytics.js
 * Dashboard interactif + Générateur d'Audit PDF Professionnel
 */

import { MapDisplay } from './map_display.js';

export const Analytics = {
    appState: null,
    currentChart: null,
    currentMode: 'distance', // 'distance' ou 'time'
    bikeMode: false,         // Simulation VAE activée

    init(state) {
        this.appState = state;
        console.log("[Analytics] Initialisation du Dashboard...");
        
        const dashboard = document.getElementById('analytics-dashboard');
        if (dashboard) dashboard.classList.remove('hidden');

        this.renderDashboardUI();
        this.bindEvents();
    },

    bindEvents() {
        // Bouton d'export PDF
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

    /**
     * Segmentation des données
     */
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
                if (isBike) d *= 0.75; // Simulation VAE
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

    /**
     * Mise à jour de l'interface graphique
     */
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
                    backgroundColor: this.bikeMode && this.currentMode === 'time' ? '#2ed573' : '#4facfe',
                    borderRadius: 10
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

    /**
     * Commentaires rédactionnels nuancés (Rétablis)
     */
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
            text += "En milieu urbain, ce sont des distances (5-10km) où le vélo est souvent plus compétitif que la voiture en temps de trajet réel, tout en restant réalisable par la très grande majorité de la population, particulièrement avec l'assistance électrique. ";
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
            
            if (under15Bike < 15) {
                text += `Bien que la part des trajets de moins de 15 minutes reste modeste, l'assistance électrique permettrait à ${countUnder20Bike} employés de se rendre au travail en moins de 20 minutes. Ce temps de trajet reste extrêmement crédible et attractif pour la grande majorité de la population. `;
            } else {
                text += `Concrètement, l'assistance électrique permettrait à ${countUnder20Bike} employés de se rendre au travail en moins de 20 minutes. `;
            }

            text += "Le gain de fluidité et la réduction de la fatigue liée aux embouteillages sont des facteurs clés de qualité de vie au travail (QVT). Le vélo électrique nivelle les temps de parcours en s'affranchissant des aléas du trafic automobile.";
        } else {
            text += `Le passage au vélo électrique maintient des temps de parcours compétitifs en permettant à ${countUnder20Bike} employés de se rendre au travail en moins de 20 minutes tout en garantissant une prédictibilité des horaires d'arrivée et une régularité précieuse pour les collaborateurs. `;
            
            if (under15Bike < 10 && under20Bike > 30) {
                text += "Même si les trajets de moins de 15 minutes sont peu nombreux, la durée de moins de 20 minutes constitue un seuil de basculement très réaliste pour la grande majorité de la population active.";
            }
        }
        return text;
    },

    async generateInvisibleChart(label, stats, color = '#4facfe') {
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

    /**
     * Export PDF Final sur 3 pages avec capture de carte
     */
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
            const softBlue = [79, 172, 254];

            // Récupération des infos personnalisées
            const siteName = document.getElementById('input-site-name')?.value || "Site Principal";
            const cityName = document.getElementById('input-city')?.value || "";
            const fullTitle = "Rapport de diagnostic : " + siteName + (cityName ? " - " + cityName : "");

            const addFooter = () => {
                const footerText = "Outil développé dans le cadre du CAVENA, faisant partie des moyens de diagnostic validés par la FUB pour la certification du label Employeur Pro Vélo.";
                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                const splitFooter = doc.splitTextToSize(footerText, pageWidth - (margin * 2));
                doc.text(splitFooter, pageWidth / 2, pageHeight - 12, { align: 'center' });
            };

            // --- PAGE 1: COUVERTURE & DISTANCES ---
            doc.setFillColor(255, 255, 255); 
            doc.rect(0, 0, pageWidth, 40, 'F');
            
            doc.setTextColor(...softBlue); 
            doc.setFontSize(22);
            doc.setFont("helvetica", "bold");
            doc.text(fullTitle, pageWidth / 2, 25, { align: 'center' });
            
            doc.setTextColor(80, 80, 80);
            doc.setFontSize(11);
            doc.setFont("helvetica", "normal");
            doc.text(`Rapport généré le ${new Date().toLocaleDateString()} - Outil CartoProcessor`, margin, 50);
            doc.text(`Effectif analysé : ${this.appState.routes.length} collaborateurs`, margin, 57);
            
            doc.setDrawColor(...softBlue);
            doc.line(margin, 65, pageWidth - margin, 65);

            // ANALYSE DISTANCE
            const distStats = this.categorizeData('distance', false);
            const distImg = await this.generateInvisibleChart('Distances', distStats, '#4facfe');
            
            doc.setFontSize(14);
            doc.setTextColor(...softBlue);
            doc.setFont("helvetica", "bold");
            doc.text("1. ANALYSE DES DISTANCES", margin, 80);
            
            doc.addImage(distImg, 'PNG', margin, 85, pageWidth - (margin*2), 70);
            
            const distComment = this.generateDistanceComment(distStats);
            doc.setFont("helvetica", "italic");
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            const splitDist = doc.splitTextToSize(distComment, pageWidth - (margin*2));
            doc.text(splitDist, margin, 165);
            
            addFooter();

            // --- PAGE 2: ANALYSE TEMPS ---
            doc.addPage();
            doc.setFontSize(14);
            doc.setTextColor(...softBlue);
            doc.setFont("helvetica", "bold");
            doc.text("2. ANALYSE DES TEMPS DE TRAJET", margin, 20);
            
            const timeStats = this.categorizeData('time', false);
            const timeImg = await this.generateInvisibleChart('Temps Musculaire', timeStats, '#4facfe');
            
            doc.setFontSize(10);
            doc.setTextColor(80, 80, 80);
            doc.text("Situation actuelle (Vélo Musculaire / Standard)", margin, 30);
            doc.addImage(timeImg, 'PNG', margin, 32, pageWidth - (margin*2), 65);
            
            const timeBikeStats = this.categorizeData('time', true);
            const timeComment = this.generateTimeComment(timeStats, timeBikeStats);
            doc.setFont("helvetica", "italic");
            doc.setTextColor(100, 100, 100);
            const splitTime = doc.splitTextToSize(timeComment, pageWidth - (margin*2));
            doc.text(splitTime, margin, 105);

            const timeBikeImg = await this.generateInvisibleChart('Temps Électrique', timeBikeStats, '#2ed573');
            doc.setFont("helvetica", "bold");
            doc.setTextColor(46, 213, 115); 
            doc.text("Projection comparative avec Assistance Électrique (VAE)", margin, 145);
            doc.addImage(timeBikeImg, 'PNG', margin, 147, pageWidth - (margin*2), 65);
            
            addFooter();

            // --- PAGE 3: CARTE ---
            doc.addPage();
            doc.setFontSize(14);
            doc.setTextColor(...softBlue);
            doc.setFont("helvetica", "bold");
            doc.text("3. CARTE DE CHALEUR DES FLUX", margin, 30);
            
            const mapImg = MapDisplay.getMapImage();
            if (mapImg) {
                doc.addImage(mapImg, 'PNG', margin, 40, pageWidth - (margin * 2), 100);
                
                // Description de la carte
                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                doc.setTextColor(80, 80, 80);
                const mapDesc = "Les points verts représentent les domiciles des collaborateurs, tandis que les points rouges indiquent le lieu d'arrivée (site employeur). L'intensité de la carte de chaleur illustre les flux de passage les plus denses, permettant d'identifier les cheminements théoriques potentiels les plus stratégiques pour l'aménagement ou la sensibilisation cyclable.";
                const splitDesc = doc.splitTextToSize(mapDesc, pageWidth - (margin * 2));
                doc.text(splitDesc, margin, 150);
            } else {
                doc.setDrawColor(220, 220, 220);
                doc.rect(margin, 40, pageWidth - (margin*2), 100);
                doc.setFontSize(10);
                doc.setTextColor(180, 180, 180);
                doc.text("Capture de la carte interactive", pageWidth/2, 90, {align:'center'});
            }

            addFooter();

            doc.save(`Audit_Mobilité_${siteName.replace(/\s+/g, '_')}.pdf`);

        } catch (e) {
            console.error("[Analytics] Erreur PDF:", e);
        } finally {
            btn.textContent = "Export Audit PDF";
            btn.disabled = false;
        }
    }
};
