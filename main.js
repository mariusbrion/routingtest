/

main.js - Orchestrateur Central Marius

Intègre le module BBOX Optimizer et transmet l'emprise à router_api.js
*/

import { BboxOptimizer } from './modules/bbox_optimizer.js';
import { RouterAPI } from './modules/router_api.js';

const App = {
// État global de l'application
appState: {
currentStep: 'step-auth',
isAuthenticated: false,
userName: null,
rawData: null,
coordinates: null,    // { company: {lat, lng}, employees: [{id, lat, lng}] }
selectedBbox: null,   // Emprise BBOX finale retenue
routes: null
},

stepsOrder: ['step-auth', 'step-csv', 'step-geo', 'step-bbox', 'step-route', 'step-map'],

/**
 * Utilitaire de nettoyage du nom d'utilisateur
 */
cleanName(name) {
    if (!name) return "Anonyme";
    let cleaned = String(name);
    cleaned = cleaned.replace(/.*(connecté|en tant que|bienvenue)\s*[:]*\s*/gi, '');
    if (cleaned.includes(':')) {
        cleaned = cleaned.split(':').pop();
    }
    return cleaned.trim();
},

/**
 * Initialisation globale
 */
init() {
    console.log("[App] Initialisation du système Marius...");
    window.App = this; 
    window.BboxOptimizer = BboxOptimizer;

    this.setupAuth();
    this.setupCsvListener();

    window.addEventListener('nextStep', (event) => this.handleNavigation(event));
},

setupAuth() {
    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
        btnLogin.onclick = () => {
            const pwd = document.getElementById('auth-password')?.value;
            if (pwd) {
                this.triggerNavigation({
                    userName: "Connecté en tant que: Marius Admin",
                    isAuthenticated: true
                }, 'step-csv');
            }
        };
    }
},

setupCsvListener() {
    const csvInput = document.getElementById('csv-input');
    if (csvInput) {
        csvInput.onchange = () => {
            // Déclencher le passage en simulant la géolocalisation
            this.loadDemoData();
        };
    }
},

/**
 * Données de démonstration (Entreprise + Employés dispersés)
 */
loadDemoData() {
    // Siège social : Paris Centre
    const company = { lat: 48.8566, lng: 2.3522, name: "Siège Social Marius" };
    const employees = [];

    // Génération de 50 employés avec quelques isolés éloignés
    for (let i = 0; i < 50; i++) {
        const isOutlier = i % 10 === 0; // 10% d'employés plus dispersés
        const radius = isOutlier ? 0.35 + Math.random() * 0.4 : 0.08 * (Math.random() + Math.random());
        const angle = Math.random() * Math.PI * 2;
        
        employees.push({
            id: `emp-${i + 1}`,
            lat: company.lat + Math.sin(angle) * radius,
            lng: company.lng + Math.cos(angle) * radius * 1.3
        });
    }

    const coordinates = { company, employees };

    this.triggerNavigation({
        rawData: "demo_csv_content",
        coordinates: coordinates
    }, 'step-geo');
},

triggerNavigation(data, nextStep) {
    const event = new CustomEvent('nextStep', {
        detail: { data, next: nextStep }
    });
    window.dispatchEvent(event);
},

/**
 * Gestion de la navigation inter-étapes
 */
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

/**
 * Déclenchement de la logique métier selon l'étape
 */
triggerModuleLogic(stepId) {
    switch(stepId) {
        case 'step-csv':
            const welcome = document.getElementById('user-welcome');
            if (welcome && this.appState.userName) {
                welcome.innerText = this.appState.userName;
            }
            break;

        case 'step-geo':
            // Simuler la fin du géocodage et passer au module BBOX
            setTimeout(() => {
                this.triggerNavigation({}, 'step-bbox');
            }, 800);
            break;

        case 'step-bbox':
            // Initialisation du module d'optimisation BBOX
            if (this.appState.coordinates) {
                BboxOptimizer.init('bboxMap', this.appState.coordinates, (selectedBboxPayload) => {
                    console.log("[App] BBOX validée par l'utilisateur :", selectedBboxPayload);
                    // Passer à l'étape suivante en stockant l'emprise
                    this.triggerNavigation({ selectedBbox: selectedBboxPayload }, 'step-route');
                });
            }
            break;

        case 'step-route':
            console.log(`[App] Transmissions de la BBOX à RouterAPI pour : ${this.appState.userName}`);
            if (this.appState.selectedBbox && this.appState.coordinates) {
                // Transmettre l'emprise BBOX à router.js (RouterAPI)
                RouterAPI.startRouting(this.appState.selectedBbox, this.appState.coordinates, this.appState.userName)
                    .then(routesResult => {
                        this.triggerNavigation({ routes: routesResult }, 'step-map');
                    });
            }
            break;

        case 'step-map':
            const sess = document.getElementById('session-info');
            if (sess) {
                sess.innerText = this.appState.userName || "Session Marius";
            }
            break;
    }
},

/**
 * Mise à jour de l'interface
 */
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
}


};

document.addEventListener('DOMContentLoaded', () => App.init());
