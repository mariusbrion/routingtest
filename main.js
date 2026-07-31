import { Auth } from './modules/auth.js';
import { CSVParser } from './modules/csv_parser.js';
import { Geocoder } from './modules/geocoder.js';
import { BboxOptimizer } from './modules/bbox_optimizer.js';
import { RouterAPI } from './modules/router_api.js';
import { MapDisplay } from './modules/map_display.js';
import { Analytics } from './modules/analytics.js';

export const App = {
    appState: {
        currentStep: 'step-auth',
        isAuthenticated: false,
        userName: null,
        rawData: null,
        coordinates: null,      // Géocodage réel BAN Batch
        geocodeStats: null,     // Métriques d'adresses géocodées / non retrouvées
        selectedBbox: null,     // Emprise BBOX optimisée
        routes: null
    },

    stepsOrder: ['step-auth', 'step-csv', 'step-geo', 'step-bbox', 'step-route', 'step-map'],

    cleanName(name) {
        if (!name) return "Anonyme";
        let cleaned = String(name);
        cleaned = cleaned.replace(/.*(connecté|en tant que|bienvenue)\s*[:]*\s*/gi, '');
        if (cleaned.includes(':')) {
            cleaned = cleaned.split(':').pop();
        }
        return cleaned.trim();
    },

    init() {
        console.log("[App] Initialisation du système Marius...");
        window.App = this; 
        window.BboxOptimizer = BboxOptimizer;

        Auth.init();
        CSVParser.init();
        Geocoder.init();
        RouterAPI.init();

        window.addEventListener('nextStep', (event) => this.handleNavigation(event));
    },

    handleNavigation(event) {
        let { data, next } = event.detail;

        if (data && data.userName) {
            data.userName = this.cleanName(data.userName);
        }

        console.log(`[App] Transition vers : ${next}`);
        this.appState = { ...this.appState, ...data, currentStep: next };

        this.triggerModuleLogic(next);
        this.updateUI(next);
    },

    triggerModuleLogic(stepId) {
        switch(stepId) {
            case 'step-csv':
                const welcome = document.getElementById('user-welcome');
                if (welcome && this.appState.userName) {
                    welcome.innerText = this.appState.userName;
                }
                break;

            case 'step-geo':
                if (this.appState.rawData) {
                    Geocoder.startGeocoding(this.appState.rawData);
                }
                break;

            case 'step-bbox':
                if (this.appState.coordinates) {
                    BboxOptimizer.init('bboxMap', this.appState.coordinates, (selectedBboxPayload) => {
                        console.log("[App] BBOX retenue :", selectedBboxPayload);
                        this.handleNavigation({
                            detail: {
                                data: { selectedBbox: selectedBboxPayload },
                                next: 'step-route'
                            }
                        });
                    });
                }
                break;

            case 'step-route':
                if (this.appState.selectedBbox && this.appState.coordinates) {
                    RouterAPI.startRouting(this.appState.selectedBbox, this.appState.coordinates, this.appState.userName)
                        .then(routesResult => {
                            setTimeout(() => {
                                this.handleNavigation({
                                    detail: {
                                        data: { routes: routesResult },
                                        next: 'step-map'
                                    }
                                });
                            }, 800);
                        });
                }
                break;

            case 'step-map':
                if (this.appState.routes) {
                    MapDisplay.render(this.appState);
                    Analytics.init(this.appState);
                    const sess = document.getElementById('session-info');
                    if (sess) sess.innerText = this.appState.userName || "Marius Admin";
                }
                break;
        }
    },

    updateUI(stepId) {
        document.querySelectorAll('.step-view').forEach(section => {
            section.classList.toggle('active', section.id === stepId);
        });

        const index = this.stepsOrder.indexOf(stepId);
        if (index !== -1) {
            const progress = (index / (this.stepsOrder.length - 1)) * 100;
            const bar = document.getElementById('progress-bar');
            const indicator = document.getElementById('step-indicator');
            
            if (bar) bar.style.width = `${progress}%`;
            if (indicator) {
                indicator.innerText = stepId === 'step-auth' ? "Authentification" : `Étape ${index} sur ${this.stepsOrder.length - 1}`;
            }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
